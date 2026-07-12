import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup } from "@/cli/commands/setup";
import { disconnectPrismaClient, getPrismaClient } from "@/infrastructure/database/client";
import { updateCommunityNode } from "@/modules/community/nodes.server";
import { getCommunityHomeView, getTopicPageView } from "@/modules/community/queries.server";
import {
  createTopic,
  deleteTopic,
  moderateTopic,
  restoreTopic,
  updateTopicContent,
} from "@/modules/community/topics.server";

const emailPrefix = "community-integration+";
const emailDomain = "@nextbuf.test";

async function createActor(name: string) {
  const suffix = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  return getPrismaClient().user.create({
    data: {
      name,
      username: `community_${suffix}`.slice(0, 24),
      email: `${emailPrefix}${suffix}${emailDomain}`,
      emailVerified: true,
      status: "active",
      activatedAt: new Date(),
    },
  });
}

describe("community topics integration", () => {
  beforeAll(async () => {
    await setup();
    const prisma = getPrismaClient();
    const users = await prisma.user.findMany({
      where: { email: { startsWith: emailPrefix, endsWith: emailDomain } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    await prisma.communityAuditEvent.deleteMany({
      where: { actorId: { in: userIds } },
    });
    await prisma.communityRoleAssignment.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.communityTopic.deleteMany({ where: { authorId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  afterAll(async () => {
    await disconnectPrismaClient();
  });

  it("creates the default node catalog", async () => {
    const nodes = await getPrismaClient().communityNode.findMany({
      where: { visibility: "public" },
    });
    expect(nodes.map((node) => node.slug).sort()).toEqual([
      "ai",
      "domain",
      "host",
      "ops",
      "showcase",
      "site",
    ]);
  });

  it("keeps topic, first post, revisions and authorization consistent", async () => {
    const prisma = getPrismaClient();
    const [author, stranger, moderator] = await Promise.all([
      createActor("Author"),
      createActor("Stranger"),
      createActor("Moderator"),
    ]);
    const node = await prisma.communityNode.findUniqueOrThrow({ where: { slug: "site" } });
    await prisma.communityRoleAssignment.create({
      data: {
        userId: moderator.id,
        role: "node_moderator",
        nodeId: node.id,
        scopeKey: node.id,
      },
    });

    const draft = await createTopic(
      { userId: author.id, requestId: "community-integration-create" },
      { nodeSlug: "site", title: "待完成草稿", body: "", action: "draft" },
    );
    await expect(
      prisma.communityPost.findFirst({ where: { topicId: draft.id, position: 1 } }),
    ).resolves.toMatchObject({ status: "draft", revisionCount: 1 });
    await expect(
      prisma.communityPostRevision.count({ where: { post: { topicId: draft.id } } }),
    ).resolves.toBe(1);

    const published = await updateTopicContent(
      { userId: author.id, requestId: "community-integration-publish" },
      draft.number,
      {
        nodeSlug: "site",
        title: "完整的社区主题发布与编辑测试",
        body: "这是一段已经满足发布要求的主题正文，用于验证事务和修订记录。",
        action: "publish",
      },
    );
    expect(published.status).toBe("published");
    await expect(
      updateTopicContent({ userId: stranger.id }, draft.number, {
        nodeSlug: "site",
        title: "陌生用户不能修改这个主题",
        body: "这是一段满足长度要求但没有权限写入的主题正文。",
        action: "save",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    await updateTopicContent({ userId: author.id }, draft.number, {
      nodeSlug: "site",
      title: "完整的社区主题发布与修订测试",
      body: "这是修改后的主题正文，应该创建新的不可变修订版本记录。",
      action: "save",
    });
    await expect(
      prisma.communityPost.findFirstOrThrow({ where: { topicId: draft.id, position: 1 } }),
    ).resolves.toMatchObject({ revisionCount: 3 });
    await expect(
      updateTopicContent({ userId: moderator.id }, draft.number, {
        nodeSlug: "ai",
        title: "节点版主不能把主题移出自己的管理范围",
        body: "这是一段满足发布长度要求的正文，但节点版主不能跨节点移动主题。",
        action: "save",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    await moderateTopic({ userId: moderator.id }, draft.number, {
      isPinned: true,
      isEssence: true,
      isClosed: true,
      isHidden: false,
    });
    await expect(
      prisma.communityTopic.findUniqueOrThrow({ where: { id: draft.id } }),
    ).resolves.toMatchObject({
      status: "closed",
      isPinned: true,
      isEssence: true,
    });
    await moderateTopic({ userId: moderator.id }, draft.number, {
      isPinned: true,
      isEssence: true,
      isClosed: true,
      isHidden: true,
    });
    await expect(
      prisma.communityTopic.findUniqueOrThrow({ where: { id: draft.id } }),
    ).resolves.toMatchObject({ status: "hidden", closedAt: expect.any(Date) });
    await moderateTopic({ userId: moderator.id }, draft.number, {
      isPinned: true,
      isEssence: true,
      isClosed: true,
      isHidden: false,
    });

    await deleteTopic({ userId: author.id }, draft.number);
    await expect(getTopicPageView(draft.number, stranger.id)).resolves.toBeNull();
    await expect(getTopicPageView(draft.number, author.id)).resolves.toMatchObject({
      status: "deleted",
      canRestore: true,
    });
    await restoreTopic({ userId: author.id }, draft.number);
    await expect(
      prisma.communityTopic.findUniqueOrThrow({ where: { id: draft.id } }),
    ).resolves.toMatchObject({
      status: "closed",
      deletedAt: null,
    });
    await expect(
      prisma.communityAuditEvent.count({ where: { topicId: draft.id } }),
    ).resolves.toBeGreaterThanOrEqual(5);
  });

  it("enforces publishing frequency and stable cursor pagination", async () => {
    const prisma = getPrismaClient();
    const rateActor = await createActor("Rate Actor");
    for (let index = 0; index < 3; index += 1) {
      await createTopic(
        { userId: rateActor.id },
        {
          nodeSlug: "ai",
          title: `发布频率验证主题 ${index + 1}`,
          body: "这是一段满足发布长度要求的正文，用于验证每小时发布频率限制。",
          action: "publish",
        },
      );
    }
    await expect(
      createTopic(
        { userId: rateActor.id },
        {
          nodeSlug: "ai",
          title: "第四个主题应被频率限制拒绝",
          body: "这是一段满足发布长度要求的正文，但一小时内不应继续发布。",
          action: "publish",
        },
      ),
    ).rejects.toMatchObject({ code: "topic_rate_limited" });

    const feedActor = await createActor("Feed Actor");
    const node = await prisma.communityNode.findUniqueOrThrow({ where: { slug: "domain" } });
    for (let index = 0; index < 23; index += 1) {
      const topic = await prisma.communityTopic.create({
        data: {
          id: randomUUID(),
          nodeId: node.id,
          authorId: feedActor.id,
          title: `游标分页测试主题 ${String(index + 1).padStart(2, "0")}`,
          status: "published",
          publishedAt: new Date(Date.now() - index * 60_000),
          lastActivityAt: new Date(Date.now() - index * 60_000),
        },
      });
      const post = await prisma.communityPost.create({
        data: {
          id: randomUUID(),
          topicId: topic.id,
          authorId: feedActor.id,
          position: 1,
          status: "published",
          bodySource: "游标分页测试正文。",
        },
      });
      await prisma.communityPostRevision.create({
        data: {
          id: randomUUID(),
          postId: post.id,
          editorId: feedActor.id,
          version: 1,
          title: topic.title,
          bodySource: post.bodySource,
          source: "create",
        },
      });
    }
    const first = await getCommunityHomeView({ nodeSlug: "domain" });
    expect(first.view.topics).toHaveLength(20);
    expect(first.view.pagination.nextCursor).toBeTruthy();
    const second = await getCommunityHomeView({
      nodeSlug: "domain",
      cursor: first.view.pagination.nextCursor ?? undefined,
      direction: "next",
    });
    expect(second.view.topics.length).toBeGreaterThan(0);
    expect(
      new Set([...first.view.topics, ...second.view.topics].map((topic) => topic.id)).size,
    ).toBe(first.view.topics.length + second.view.topics.length);
    expect(second.view.pagination.previousCursor).toBeTruthy();
  });

  it("restricts node visibility and archive changes to administrators", async () => {
    const prisma = getPrismaClient();
    const [admin, ordinary] = await Promise.all([
      createActor("Node Admin"),
      createActor("Node Ordinary"),
    ]);
    await prisma.communityRoleAssignment.create({
      data: { userId: admin.id, role: "admin", scopeKey: "site" },
    });
    const node = await prisma.communityNode.findUniqueOrThrow({ where: { slug: "showcase" } });
    const input = {
      name: node.name,
      description: node.description,
      color: node.color,
      icon: node.icon,
      sortOrder: node.sortOrder,
      visibility: "hidden" as const,
      archived: true,
    };
    await expect(
      updateCommunityNode({ userId: ordinary.id }, node.slug, input),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    await updateCommunityNode({ userId: admin.id }, node.slug, input);
    await expect(getCommunityHomeView({ nodeSlug: node.slug })).rejects.toMatchObject({
      code: "node_unavailable",
    });
    await updateCommunityNode({ userId: admin.id }, node.slug, {
      ...input,
      visibility: "public",
      archived: false,
    });
  });
});
