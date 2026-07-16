import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import {
  getCommunityPermissions,
  type CommunityPermissions,
} from "@/modules/community/authorization.server";
import { ModerationError } from "@/modules/moderation/errors";
import { governanceActorRoles } from "@/modules/moderation/governance.server";

export type ModerationActionName =
  "hide" | "restore" | "close" | "warn" | "node_mute" | "site_mute" | "suspend" | "ban";

type CaseWithTarget = Prisma.ModerationCaseGetPayload<{
  include: {
    topic: { include: { node: true } };
    post: true;
    reportedUser: true;
  };
}>;

async function lockCase(transaction: Prisma.TransactionClient, caseNumber: number): Promise<void> {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "moderation_cases" WHERE "number" = ${caseNumber} FOR UPDATE`,
  );
}

async function getOpenCase(
  transaction: Prisma.TransactionClient,
  caseNumber: number,
): Promise<CaseWithTarget> {
  const moderationCase = await transaction.moderationCase.findUnique({
    where: { number: caseNumber },
    include: { topic: { include: { node: true } }, post: true, reportedUser: true },
  });
  if (!moderationCase) throw new ModerationError("case_not_found", 404);
  if (!["open", "in_review"].includes(moderationCase.status)) {
    throw new ModerationError("case_closed", 409);
  }
  return moderationCase;
}

async function requireCaseModerator(
  transaction: Prisma.TransactionClient,
  actorId: string,
  moderationCase: CaseWithTarget,
): Promise<CommunityPermissions> {
  const permissions = await getCommunityPermissions(
    transaction,
    actorId,
    moderationCase.topic?.nodeId,
  );
  const withinNode = Boolean(moderationCase.topic && permissions.isNodeModerator);
  if (
    !permissions.active ||
    (!permissions.isAdmin && !permissions.isGlobalModerator && !withinNode)
  ) {
    throw new ModerationError("forbidden", 403);
  }
  return permissions;
}

function targetUserId(moderationCase: CaseWithTarget): string | null {
  return (
    moderationCase.reportedUserId ??
    moderationCase.post?.authorId ??
    moderationCase.topic?.authorId ??
    null
  );
}

async function requireTargetHierarchy(
  transaction: Prisma.TransactionClient,
  actor: CommunityPermissions,
  targetId: string,
  nodeId?: string,
): Promise<void> {
  if (actor.isAdmin) return;
  const target = await getCommunityPermissions(transaction, targetId, nodeId);
  if (target.isAdmin || target.isGlobalModerator) throw new ModerationError("forbidden", 403);
  if (!actor.isGlobalModerator && actor.isNodeModerator && target.isNodeModerator) {
    throw new ModerationError("forbidden", 403);
  }
}

async function recordAction(
  transaction: Prisma.TransactionClient,
  input: {
    id?: string;
    caseId: string;
    actorId: string;
    actor: CommunityPermissions;
    action: string;
    targetType: string;
    targetKey: string;
    topicId?: string;
    postId?: string;
    targetUserId?: string;
    nodeId?: string;
    reason: string;
    beforeState: Prisma.InputJsonObject;
    afterState: Prisma.InputJsonObject;
    expiresAt?: Date;
    requestId: string;
  },
) {
  return transaction.moderationAction.create({
    data: {
      id: input.id,
      caseId: input.caseId,
      actorId: input.actorId,
      actorRoles: governanceActorRoles(input.actor),
      action: input.action,
      targetType: input.targetType,
      targetKey: input.targetKey,
      topicId: input.topicId,
      postId: input.postId,
      targetUserId: input.targetUserId,
      nodeId: input.nodeId,
      reason: input.reason,
      beforeState: input.beforeState,
      afterState: input.afterState,
      expiresAt: input.expiresAt,
      requestId: input.requestId,
    },
  });
}

async function applyContentAction(
  transaction: Prisma.TransactionClient,
  moderationCase: CaseWithTarget,
  action: "hide" | "restore" | "close",
) {
  if (action === "close") {
    if (moderationCase.targetType !== "topic" || !moderationCase.topic) {
      throw new ModerationError("invalid_action", 400);
    }
    const before = {
      status: moderationCase.topic.status,
      closedAt: moderationCase.topic.closedAt?.toISOString() ?? null,
    };
    if (!["published", "closed"].includes(moderationCase.topic.status)) {
      throw new ModerationError("invalid_action", 409);
    }
    const closedAt = moderationCase.topic.closedAt ?? new Date();
    await transaction.communityTopic.update({
      where: { id: moderationCase.topic.id },
      data: { status: "closed", closedAt },
    });
    return {
      targetType: "topic",
      targetKey: `topic:${moderationCase.topic.id}`,
      topicId: moderationCase.topic.id,
      nodeId: moderationCase.topic.nodeId,
      targetUserId: moderationCase.topic.authorId,
      before,
      after: { status: "closed", closedAt: closedAt.toISOString() },
    };
  }
  if (moderationCase.targetType === "topic" && moderationCase.topic) {
    const expectedStatus = action === "hide" ? ["published", "closed"] : ["hidden"];
    if (!expectedStatus.includes(moderationCase.topic.status)) {
      throw new ModerationError("invalid_action", 409);
    }
    let status = action === "hide" ? "hidden" : "published";
    if (action === "restore") {
      const latestHide = await transaction.moderationAction.findFirst({
        where: {
          topicId: moderationCase.topic.id,
          targetType: "topic",
          action: "hide",
        },
        orderBy: { createdAt: "desc" },
        select: { beforeState: true },
      });
      const beforeState =
        latestHide?.beforeState &&
        typeof latestHide.beforeState === "object" &&
        !Array.isArray(latestHide.beforeState)
          ? latestHide.beforeState
          : null;
      if (beforeState?.status === "closed") status = "closed";
    }
    await transaction.communityTopic.update({
      where: { id: moderationCase.topic.id },
      data: { status, closedAt: status === "closed" ? moderationCase.topic.closedAt : null },
    });
    await transaction.communityPost.updateMany({
      where: { topicId: moderationCase.topic.id, position: 1 },
      data: { status },
    });
    return {
      targetType: "topic",
      targetKey: `topic:${moderationCase.topic.id}`,
      topicId: moderationCase.topic.id,
      nodeId: moderationCase.topic.nodeId,
      targetUserId: moderationCase.topic.authorId,
      before: { status: moderationCase.topic.status },
      after: { status },
    };
  }
  if (moderationCase.targetType === "post" && moderationCase.post && moderationCase.topic) {
    const expected = action === "hide" ? "published" : "hidden";
    if (moderationCase.post.status !== expected || moderationCase.post.position === 1) {
      throw new ModerationError("invalid_action", 409);
    }
    const status = action === "hide" ? "hidden" : "published";
    await transaction.communityPost.update({
      where: { id: moderationCase.post.id },
      data: { status },
    });
    await transaction.communityTopic.update({
      where: { id: moderationCase.topic.id },
      data: { replyCount: { increment: action === "hide" ? -1 : 1 } },
    });
    return {
      targetType: "post",
      targetKey: `post:${moderationCase.post.id}`,
      topicId: moderationCase.topic.id,
      postId: moderationCase.post.id,
      nodeId: moderationCase.topic.nodeId,
      targetUserId: moderationCase.post.authorId,
      before: { status: moderationCase.post.status },
      after: { status },
    };
  }
  throw new ModerationError("invalid_action", 400);
}

export async function applyModerationAction(input: {
  actorId: string;
  caseNumber: number;
  action: ModerationActionName;
  reason: string;
  endsAt?: Date;
  requestId: string;
}) {
  return getPrismaClient().$transaction(async (transaction) => {
    await lockCase(transaction, input.caseNumber);
    const moderationCase = await getOpenCase(transaction, input.caseNumber);
    const actor = await requireCaseModerator(transaction, input.actorId, moderationCase);
    const affectedUserId = targetUserId(moderationCase);
    if (affectedUserId) {
      await requireTargetHierarchy(
        transaction,
        actor,
        affectedUserId,
        moderationCase.topic?.nodeId,
      );
    }

    if (["hide", "restore", "close"].includes(input.action)) {
      const target = await applyContentAction(
        transaction,
        moderationCase,
        input.action as "hide" | "restore" | "close",
      );
      return recordAction(transaction, {
        caseId: moderationCase.id,
        actorId: input.actorId,
        actor,
        action: input.action,
        targetType: target.targetType,
        targetKey: target.targetKey,
        topicId: target.topicId,
        postId: target.postId,
        nodeId: target.nodeId,
        reason: input.reason,
        beforeState: target.before,
        afterState: target.after,
        requestId: input.requestId,
      });
    }

    if (!affectedUserId) throw new ModerationError("invalid_action", 400);
    if (affectedUserId === input.actorId) throw new ModerationError("forbidden", 403);
    const nodeId = moderationCase.topic?.nodeId;
    if (input.action === "node_mute" && !nodeId) {
      throw new ModerationError("invalid_action", 400);
    }
    if (
      !actor.isAdmin &&
      (input.action === "ban" ||
        (!actor.isGlobalModerator &&
          actor.isNodeModerator &&
          !["warn", "node_mute"].includes(input.action)))
    ) {
      throw new ModerationError("forbidden", 403);
    }
    if (
      !actor.isAdmin &&
      actor.isGlobalModerator &&
      input.action === "suspend" &&
      (!input.endsAt || input.endsAt.getTime() - Date.now() > 30 * 86_400_000)
    ) {
      throw new ModerationError("forbidden", 403);
    }
    if (input.action === "suspend" && !input.endsAt) {
      throw new ModerationError("invalid_action", 400);
    }
    if (input.endsAt && input.endsAt <= new Date()) {
      throw new ModerationError("invalid_action", 400);
    }
    const sanctionType = input.action === "warn" ? "warning" : input.action;
    const targetUser = await transaction.user.findUnique({
      where: { id: affectedUserId },
      select: { status: true },
    });
    if (!targetUser) throw new ModerationError("invalid_action", 400);
    if (sanctionType !== "warning") {
      const now = new Date();
      const duplicate = await transaction.moderationSanction.findFirst({
        where: {
          userId: affectedUserId,
          type: sanctionType,
          nodeId: sanctionType === "node_mute" ? nodeId : null,
          revokedAt: null,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
        select: { id: true },
      });
      if (duplicate) throw new ModerationError("invalid_action", 409);
    }
    const actionId = randomUUID();
    const sanctionId = randomUUID();
    const beforeState = { active: false, userStatus: targetUser.status };
    const afterState = {
      active: true,
      sanctionId,
      type: sanctionType,
      endsAt: input.endsAt?.toISOString() ?? null,
    };
    const action = await recordAction(transaction, {
      id: actionId,
      caseId: moderationCase.id,
      actorId: input.actorId,
      actor,
      action: input.action,
      targetType: "user",
      targetKey: `user:${affectedUserId}`,
      targetUserId: affectedUserId,
      nodeId: input.action === "node_mute" ? nodeId : undefined,
      reason: input.reason,
      beforeState,
      afterState,
      expiresAt: input.endsAt,
      requestId: input.requestId,
    });
    await transaction.moderationSanction.create({
      data: {
        id: sanctionId,
        userId: affectedUserId,
        type: sanctionType,
        nodeId: input.action === "node_mute" ? nodeId : undefined,
        caseId: moderationCase.id,
        actionId,
        reason: input.reason,
        endsAt: input.endsAt,
        createdById: input.actorId,
      },
    });
    if (["suspend", "ban"].includes(input.action)) {
      await transaction.user.update({
        where: { id: affectedUserId },
        data: { status: "suspended" },
      });
    }
    return action;
  });
}

export async function closeModerationCase(input: {
  actorId: string;
  caseNumber: number;
  outcome: "resolved" | "dismissed";
  reason: string;
  requestId: string;
}) {
  return getPrismaClient().$transaction(async (transaction) => {
    await lockCase(transaction, input.caseNumber);
    const moderationCase = await getOpenCase(transaction, input.caseNumber);
    const actor = await requireCaseModerator(transaction, input.actorId, moderationCase);
    const now = new Date();
    const updated = await transaction.moderationCase.update({
      where: { id: moderationCase.id },
      data: {
        status: input.outcome,
        activeTargetKey: null,
        resolvedAt: input.outcome === "resolved" ? now : null,
        dismissedAt: input.outcome === "dismissed" ? now : null,
      },
    });
    await transaction.moderationReport.updateMany({
      where: { caseId: moderationCase.id, status: "open" },
      data: { status: input.outcome, activeTargetKey: null, resolvedAt: now },
    });
    await recordAction(transaction, {
      caseId: moderationCase.id,
      actorId: input.actorId,
      actor,
      action: input.outcome === "resolved" ? "resolve" : "dismiss",
      targetType: "case",
      targetKey: `case:${moderationCase.id}`,
      reason: input.reason,
      beforeState: { status: moderationCase.status },
      afterState: { status: input.outcome },
      requestId: input.requestId,
    });
    return updated;
  });
}

export async function revokeModerationSanction(input: {
  actorId: string;
  sanctionId: string;
  reason: string;
  requestId: string;
}): Promise<void> {
  await getPrismaClient().$transaction(async (transaction) => {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "moderation_sanctions" WHERE "id" = CAST(${input.sanctionId} AS uuid) FOR UPDATE`,
    );
    const sanction = await transaction.moderationSanction.findUnique({
      where: { id: input.sanctionId },
      include: {
        case: { include: { topic: { include: { node: true } }, post: true, reportedUser: true } },
      },
    });
    if (!sanction) throw new ModerationError("sanction_not_found", 404);
    if (sanction.revokedAt) return;
    const actor = await requireCaseModerator(transaction, input.actorId, sanction.case);
    await requireTargetHierarchy(transaction, actor, sanction.userId, sanction.nodeId ?? undefined);
    if (sanction.type === "ban" && !actor.isAdmin) throw new ModerationError("forbidden", 403);
    if (!actor.isGlobalModerator && actor.isNodeModerator && sanction.type !== "node_mute") {
      throw new ModerationError("forbidden", 403);
    }
    const now = new Date();
    await transaction.moderationSanction.update({
      where: { id: sanction.id },
      data: {
        revokedAt: now,
        revokedById: input.actorId,
        revocationReason: input.reason,
      },
    });
    await recordAction(transaction, {
      caseId: sanction.caseId,
      actorId: input.actorId,
      actor,
      action: "revoke_sanction",
      targetType: "sanction",
      targetKey: `sanction:${sanction.id}`,
      targetUserId: sanction.userId,
      nodeId: sanction.nodeId ?? undefined,
      reason: input.reason,
      beforeState: {
        active: true,
        type: sanction.type,
        endsAt: sanction.endsAt?.toISOString() ?? null,
      },
      afterState: { active: false, revokedAt: now.toISOString() },
      requestId: input.requestId,
    });
    if (["suspend", "ban"].includes(sanction.type)) {
      const remaining = await transaction.moderationSanction.count({
        where: {
          userId: sanction.userId,
          type: { in: ["suspend", "ban"] },
          revokedAt: null,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
      });
      if (remaining === 0) {
        await transaction.user.updateMany({
          where: { id: sanction.userId, status: "suspended" },
          data: { status: "active" },
        });
      }
    }
  });
}

export async function restoreExpiredSuspensions(): Promise<number> {
  const now = new Date();
  return getPrismaClient().$executeRaw(
    Prisma.sql`UPDATE "users" AS u
      SET "status" = 'active', "updated_at" = ${now}
      WHERE u."status" = 'suspended'
        AND EXISTS (
          SELECT 1 FROM "moderation_sanctions" AS historical
          WHERE historical."user_id" = u."id" AND historical."type" IN ('suspend', 'ban')
        )
        AND NOT EXISTS (
          SELECT 1 FROM "moderation_sanctions" AS active
          WHERE active."user_id" = u."id"
            AND active."type" IN ('suspend', 'ban')
            AND active."revoked_at" IS NULL
            AND active."starts_at" <= ${now}
            AND (active."ends_at" IS NULL OR active."ends_at" > ${now})
        )`,
  );
}
