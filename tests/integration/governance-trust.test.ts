import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup } from "@/cli/commands/setup";
import { ensureCommunityNodeFixtures } from "../support/community-node-fixtures";
import {
  getCommunityPermissions,
  requireCommunityContentActor,
} from "@/modules/community/authorization.server";
import { createTopic } from "@/modules/community/topics.server";
import { setTopicBookmarked } from "@/modules/interactions/interactions.server";
import {
  applyModerationAction,
  closeModerationCase,
  revokeModerationSanction,
} from "@/modules/moderation/actions.server";
import { createModerationReport } from "@/modules/moderation/reports.server";
import { grantCommunityRole, revokeCommunityRole } from "@/modules/moderation/governance.server";
import {
  activateTrustRule,
  createTrustRuleDraft,
  evaluateTrustUser,
  previewTrustRule,
  setManualTrustLevel,
} from "@/modules/trust/trust.server";
import { processTrustRecalculationChunk } from "@/modules/trust/worker.server";
import { disconnectPrismaClient, getPrismaClient } from "@/infrastructure/database/client";

const emailPrefix = "governance-integration+";
const emailDomain = "@nextbuf.test";

async function actor(name: string, activatedAt = new Date()) {
  const suffix = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  return getPrismaClient().user.create({
    data: {
      name,
      username: `gv_${suffix}`.slice(0, 24),
      email: `${emailPrefix}${suffix}${emailDomain}`,
      emailVerified: true,
      status: "active",
      activatedAt,
    },
  });
}

async function grantRole(
  userId: string,
  role: "admin" | "global_moderator" | "node_moderator",
  nodeId?: string,
) {
  return getPrismaClient().communityRoleAssignment.create({
    data: { userId, role, nodeId, scopeKey: nodeId ?? "site", reason: "integration fixture" },
  });
}

async function completeTrustBatch(batchId: string): Promise<void> {
  const prisma = getPrismaClient();
  for (let chunk = 0; chunk < 100; chunk += 1) {
    await prisma.$transaction((transaction) =>
      processTrustRecalculationChunk(transaction, batchId),
    );
    const batch = await prisma.trustRecalculationBatch.findUniqueOrThrow({
      where: { id: batchId },
      select: { status: true },
    });
    if (batch.status === "completed") return;
  }
  throw new Error(`Trust batch did not complete: ${batchId}`);
}

describe("governance, sanctions and trust integration", () => {
  beforeAll(async () => {
    await setup();
    await ensureCommunityNodeFixtures();
    const prisma = getPrismaClient();
    const existing = await prisma.user.findMany({
      where: { email: { startsWith: emailPrefix, endsWith: emailDomain } },
      select: { id: true },
    });
    const userIds = existing.map(({ id }) => id);
    if (userIds.length > 0) {
      const cases = await prisma.moderationCase.findMany({
        where: {
          OR: [
            { createdById: { in: userIds } },
            { reportedUserId: { in: userIds } },
            { reports: { some: { reporterId: { in: userIds } } } },
          ],
        },
        select: { id: true },
      });
      const caseIds = cases.map(({ id }) => id);
      await prisma.moderationSanction.deleteMany({ where: { caseId: { in: caseIds } } });
      await prisma.moderationAction.deleteMany({ where: { caseId: { in: caseIds } } });
      await prisma.moderationReport.deleteMany({ where: { caseId: { in: caseIds } } });
      await prisma.moderationCase.deleteMany({ where: { id: { in: caseIds } } });
      await prisma.governanceAuditEvent.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.communityRoleAssignment.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.communityTopic.deleteMany({ where: { authorId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  afterAll(async () => {
    await disconnectPrismaClient();
  });

  it("aggregates reports and prevents duplicate unresolved reports", async () => {
    const [author, firstReporter, secondReporter] = await Promise.all([
      actor("Report Author"),
      actor("Report First"),
      actor("Report Second"),
    ]);
    const topic = await createTopic(
      { userId: author.id },
      {
        nodeSlug: "ai",
        title: "治理举报聚合与重复提交约束测试主题",
        body: "这段正文用于验证两个用户对同一主题的举报会进入同一个案件，并保留独立举报来源。",
        action: "publish",
      },
    );
    const first = await createModerationReport({
      reporterId: firstReporter.id,
      target: { type: "topic", number: topic.number },
      reason: "spam",
      details: "疑似批量广告。",
    });
    const second = await createModerationReport({
      reporterId: secondReporter.id,
      target: { type: "topic", number: topic.number },
      reason: "abuse",
      details: "同时包含恶意内容。",
    });
    expect(second.caseNumber).toBe(first.caseNumber);
    await expect(
      createModerationReport({
        reporterId: firstReporter.id,
        target: { type: "topic", number: topic.number },
        reason: "other",
        details: "重复举报。",
      }),
    ).rejects.toMatchObject({ code: "duplicate_report" });
    await expect(
      getPrismaClient().moderationCase.findUniqueOrThrow({
        where: { number: first.caseNumber },
        include: { _count: { select: { reports: true } } },
      }),
    ).resolves.toMatchObject({ _count: { reports: 2 }, priorityScore: 2 });

    const rateTargets = await Promise.all(
      Array.from({ length: 10 }, (_, index) => actor(`Rate Target ${index}`)),
    );
    for (const target of rateTargets.slice(0, 9)) {
      await createModerationReport({
        reporterId: firstReporter.id,
        target: { type: "user", username: target.username },
        reason: "other",
        details: "用于验证每日举报上限。",
      });
    }
    await expect(
      createModerationReport({
        reporterId: firstReporter.id,
        target: { type: "user", username: rateTargets[9]!.username },
        reason: "other",
        details: "第十一条举报应被拒绝。",
      }),
    ).rejects.toMatchObject({ code: "report_rate_limited" });
  });

  it("enforces node mutes and suspensions from PostgreSQL without blocking ordinary interactions", async () => {
    const prisma = getPrismaClient();
    const [author, reporter, moderator, admin] = await Promise.all([
      actor("Sanction Author"),
      actor("Sanction Reporter"),
      actor("Node Moderator"),
      actor("Governance Admin"),
    ]);
    const node = await prisma.communityNode.findUniqueOrThrow({ where: { slug: "host" } });
    await Promise.all([
      grantRole(moderator.id, "node_moderator", node.id),
      grantRole(admin.id, "admin"),
    ]);
    const topic = await createTopic(
      { userId: author.id },
      {
        nodeSlug: node.slug,
        title: "节点禁言与账号暂停即时授权测试主题",
        body: "这段正文用于验证制裁直接读取 PostgreSQL，并区分内容创建与收藏等普通互动。",
        action: "publish",
      },
    );
    const report = await createModerationReport({
      reporterId: reporter.id,
      target: { type: "topic", number: topic.number },
      reason: "abuse",
      details: "需要节点版主检查。",
    });
    await applyModerationAction({
      actorId: moderator.id,
      caseNumber: report.caseNumber,
      action: "hide",
      reason: "先隐藏内容以完成节点复核",
      requestId: "integration-hide-topic",
    });
    await expect(
      prisma.communityTopic.findUniqueOrThrow({ where: { id: topic.id } }),
    ).resolves.toMatchObject({
      status: "hidden",
    });
    await applyModerationAction({
      actorId: moderator.id,
      caseNumber: report.caseNumber,
      action: "restore",
      reason: "内容证据已保留，恢复主题展示",
      requestId: "integration-restore-topic",
    });
    await applyModerationAction({
      actorId: moderator.id,
      caseNumber: report.caseNumber,
      action: "node_mute",
      reason: "节点内重复发布违规内容",
      endsAt: new Date(Date.now() + 86_400_000),
      requestId: "integration-node-mute",
    });
    await expect(
      prisma.$transaction((transaction) =>
        requireCommunityContentActor(transaction, author.id, node.id),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(setTopicBookmarked(author.id, topic.number, true)).resolves.toMatchObject({
      active: true,
      count: 1,
    });
    await expect(
      applyModerationAction({
        actorId: moderator.id,
        caseNumber: report.caseNumber,
        action: "site_mute",
        reason: "节点版主不能执行全站禁言",
        endsAt: new Date(Date.now() + 86_400_000),
        requestId: "integration-forbidden-site-mute",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    await applyModerationAction({
      actorId: admin.id,
      caseNumber: report.caseNumber,
      action: "suspend",
      reason: "临时暂停账号以完成安全复核",
      endsAt: new Date(Date.now() + 86_400_000),
      requestId: "integration-suspend",
    });
    await expect(getCommunityPermissions(prisma, author.id, node.id)).resolves.toMatchObject({
      active: false,
      suspended: true,
    });
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: author.id } }),
    ).resolves.toMatchObject({
      status: "suspended",
    });
    const suspension = await prisma.moderationSanction.findFirstOrThrow({
      where: { userId: author.id, type: "suspend", revokedAt: null },
    });
    await revokeModerationSanction({
      actorId: admin.id,
      sanctionId: suspension.id,
      reason: "复核完成，撤销临时暂停",
      requestId: "integration-revoke-suspend",
    });
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: author.id } }),
    ).resolves.toMatchObject({
      status: "active",
    });
    await closeModerationCase({
      actorId: admin.id,
      caseNumber: report.caseNumber,
      outcome: "resolved",
      reason: "处置和复核均已完成",
      requestId: "integration-resolve-case",
    });
    await expect(
      prisma.moderationAction.findMany({ where: { caseId: suspension.caseId } }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "suspend", requestId: "integration-suspend" }),
        expect.objectContaining({
          action: "revoke_sanction",
          requestId: "integration-revoke-suspend",
        }),
        expect.objectContaining({ action: "resolve", requestId: "integration-resolve-case" }),
      ]),
    );
  });

  it("previews rule changes, recalculates trust and keeps TL4 independent from roles", async () => {
    const prisma = getPrismaClient();
    const [member, contentAuthor, admin] = await Promise.all([
      actor("Trust Member", new Date(Date.now() - 10 * 86_400_000)),
      actor("Trust Content Author"),
      actor("Trust Admin"),
    ]);
    await grantRole(admin.id, "admin");
    const delegatedRole = await grantCommunityRole({
      actorId: admin.id,
      targetUserId: contentAuthor.id,
      role: "global_moderator",
      reason: "验证受审计角色授予流程",
      requestId: "integration-role-grant",
    });
    await expect(getCommunityPermissions(prisma, contentAuthor.id)).resolves.toMatchObject({
      isGlobalModerator: true,
    });
    await revokeCommunityRole({
      actorId: admin.id,
      assignmentId: delegatedRole.id,
      reason: "验证受审计角色撤销流程",
      requestId: "integration-role-revoke",
    });
    await expect(getCommunityPermissions(prisma, contentAuthor.id)).resolves.toMatchObject({
      isGlobalModerator: false,
    });
    const topics = [];
    for (const slug of ["ai", "site", "domain"] as const) {
      topics.push(
        await createTopic(
          { userId: slug === "ai" ? member.id : contentAuthor.id },
          {
            nodeSlug: slug,
            title: `信任等级指标读取测试主题 ${slug}`,
            body: "这段正文用于建立真实发帖与阅读事实，信任指标不从缓存或演示数据计算。",
            action: "publish",
          },
        ),
      );
    }
    for (const topic of topics) {
      await prisma.interactionTopicReadState.create({
        data: { userId: member.id, topicId: topic.id, lastReadPosition: 1, lastReadAt: new Date() },
      });
    }
    const activeRule = await prisma.trustRuleVersion.findFirstOrThrow({
      where: { status: "active" },
    });
    await prisma.$transaction((transaction) =>
      evaluateTrustUser(transaction, {
        userId: member.id,
        rule: activeRule,
        mode: "apply",
        source: "automatic",
        now: new Date(),
      }),
    );
    await expect(
      prisma.trustUserState.findUniqueOrThrow({ where: { userId: member.id } }),
    ).resolves.toMatchObject({
      currentLevel: 1,
      automatedLevel: 1,
    });

    const draft = await createTrustRuleDraft({
      actorId: admin.id,
      config: activeRule.config,
      reason: "验证规则预览和分块应用流程",
      requestId: "integration-rule-draft",
    });
    const preview = await previewTrustRule({
      actorId: admin.id,
      ruleId: draft.id,
      reason: "先预估规则对全体用户的影响",
      requestId: "integration-rule-preview",
    });
    await completeTrustBatch(preview.id);
    await expect(
      prisma.trustRecalculationBatch.findUniqueOrThrow({ where: { id: preview.id } }),
    ).resolves.toMatchObject({
      status: "completed",
      processedUsers: expect.any(Number),
    });
    const activated = await activateTrustRule({
      actorId: admin.id,
      ruleId: draft.id,
      reason: "预估完成后激活新规则",
      requestId: "integration-rule-activate",
    });
    await completeTrustBatch(activated.batch.id);
    await setManualTrustLevel({
      actorId: admin.id,
      userId: member.id,
      level: 4,
      reason: "人工确认 TL4 以验证独立授权",
      requestId: "integration-tl4-grant",
    });
    const permissions = await getCommunityPermissions(prisma, member.id);
    expect(permissions.isAdmin).toBe(false);
    expect(permissions.isGlobalModerator).toBe(false);
    await expect(
      prisma.trustUserState.findUniqueOrThrow({ where: { userId: member.id } }),
    ).resolves.toMatchObject({
      currentLevel: 4,
      manualLevel: 4,
    });
    await setManualTrustLevel({
      actorId: admin.id,
      userId: member.id,
      level: null,
      reason: "撤销人工 TL4 并回到自动等级",
      requestId: "integration-tl4-revoke",
    });
    await expect(
      prisma.trustUserState.findUniqueOrThrow({ where: { userId: member.id } }),
    ).resolves.toMatchObject({
      currentLevel: 1,
      manualLevel: null,
    });
  });
});
