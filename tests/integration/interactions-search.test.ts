import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup } from "@/cli/commands/setup";
import { disconnectPrismaClient, getPrismaClient } from "@/infrastructure/database/client";
import { searchContent } from "@/infrastructure/search/index.server";
import { createReply } from "@/modules/community/replies.server";
import { createTopic, deleteTopic } from "@/modules/community/topics.server";
import { listHotTopicIds } from "@/modules/interactions/discovery.server";
import {
  markTopicRead,
  recordTopicView,
  setPostLiked,
  setTopicBookmarked,
  setTopicFollowed,
  setUserFollowed,
} from "@/modules/interactions/interactions.server";
import {
  listBookmarkedTopics,
  listFollowedTopics,
  listFollowedUsers,
  listParticipatedTopics,
} from "@/modules/interactions/queries.server";
import { aggregateTopicView } from "@/modules/interactions/view-worker.server";

const emailPrefix = "interactions-integration+";
const emailDomain = "@nextbuf.test";

async function createActor(name: string) {
  const suffix = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  return getPrismaClient().user.create({
    data: {
      name,
      username: `ix_${suffix}`.slice(0, 24),
      email: `${emailPrefix}${suffix}${emailDomain}`,
      emailVerified: true,
      status: "active",
      activatedAt: new Date(),
    },
  });
}

describe("interactions, search and discovery integration", () => {
  beforeAll(async () => {
    await setup();
    const prisma = getPrismaClient();
    const users = await prisma.user.findMany({
      where: { email: { startsWith: emailPrefix, endsWith: emailDomain } },
      select: { id: true },
    });
    const ids = users.map(({ id }) => id);
    await prisma.communityTopic.deleteMany({ where: { authorId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.outboxEvent.deleteMany({
      where: { idempotencyKey: { startsWith: "interaction-topic-view:" } },
    });
  });

  afterAll(async () => {
    await disconnectPrismaClient();
  });

  it("keeps likes, bookmarks and follows idempotent under repeated requests", async () => {
    const prisma = getPrismaClient();
    const [author, member, target] = await Promise.all([
      createActor("Interaction Author"),
      createActor("Interaction Member"),
      createActor("Interaction Target"),
    ]);
    const topic = await createTopic(
      { userId: author.id },
      {
        nodeSlug: "ai",
        title: "NebulaSignal 互动唯一约束与搜索验证主题",
        body: "NebulaSignal 正文用于验证 PostgreSQL 全文检索、互动事实和热门排序。",
        action: "publish",
      },
    );
    const firstPost = await prisma.communityPost.findFirstOrThrow({
      where: { topicId: topic.id, position: 1 },
    });

    await Promise.all(Array.from({ length: 5 }, () => setPostLiked(member.id, firstPost.id, true)));
    await expect(
      prisma.interactionPostLike.count({ where: { postId: firstPost.id, userId: member.id } }),
    ).resolves.toBe(1);
    await expect(
      prisma.communityPost.findUniqueOrThrow({ where: { id: firstPost.id } }),
    ).resolves.toMatchObject({ likeCount: 1 });
    await Promise.all([
      setPostLiked(member.id, firstPost.id, false),
      setPostLiked(member.id, firstPost.id, false),
    ]);
    await expect(
      prisma.communityPost.findUniqueOrThrow({ where: { id: firstPost.id } }),
    ).resolves.toMatchObject({ likeCount: 0 });

    await Promise.all([
      setTopicBookmarked(member.id, topic.number, true),
      setTopicBookmarked(member.id, topic.number, true),
      setTopicFollowed(member.id, topic.number, true),
      setTopicFollowed(member.id, topic.number, true),
      setUserFollowed(member.id, target.username, true),
      setUserFollowed(member.id, target.username, true),
    ]);
    await expect(
      prisma.communityTopic.findUniqueOrThrow({ where: { id: topic.id } }),
    ).resolves.toMatchObject({ bookmarkCount: 1 });
    await expect(listBookmarkedTopics(member.id)).resolves.toHaveLength(1);
    await expect(listFollowedTopics(member.id)).resolves.toHaveLength(1);
    await expect(listFollowedUsers(member.id)).resolves.toHaveLength(1);
    await expect(setUserFollowed(member.id, member.username, true)).rejects.toMatchObject({
      code: "cannot_follow_self",
    });

    const reply = await createReply({ userId: member.id }, topic.number, {
      body: "这是由独立参与者发布的回复，用于验证阅读楼层和热门参与信号。",
    });
    await markTopicRead(member.id, topic.number, reply.position);
    await markTopicRead(member.id, topic.number, 1);
    await expect(
      prisma.interactionTopicReadState.findUniqueOrThrow({
        where: { userId_topicId: { userId: member.id, topicId: topic.id } },
      }),
    ).resolves.toMatchObject({ lastReadPosition: reply.position });
    await expect(listParticipatedTopics(member.id)).resolves.toContainEqual(
      expect.objectContaining({ id: topic.id }),
    );
  });

  it("deduplicates view buckets and aggregates each accepted view once", async () => {
    const prisma = getPrismaClient();
    const author = await createActor("View Author");
    const topic = await createTopic(
      { userId: author.id },
      {
        nodeSlug: "host",
        title: "反滥用浏览聚合验证主题",
        body: "这段正文用于验证同一匿名访问者在三十分钟窗口内只计入一次浏览。",
        action: "publish",
      },
    );
    const now = new Date("2026-07-16T08:05:00.000Z");
    const first = await recordTopicView({
      number: topic.number,
      anonymousFingerprint: "203.0.113.8|integration-browser",
      now,
    });
    const duplicate = await recordTopicView({
      number: topic.number,
      anonymousFingerprint: "203.0.113.8|integration-browser",
      now: new Date(now.getTime() + 10 * 60_000),
    });
    expect(first.accepted).toBe(true);
    expect(duplicate.accepted).toBe(false);

    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { idempotencyKey: { startsWith: "interaction-topic-view:" } },
      orderBy: { createdAt: "desc" },
    });
    const viewId = (event.payload as { viewId?: unknown }).viewId;
    expect(typeof viewId).toBe("string");
    await prisma.$transaction((transaction) => aggregateTopicView(transaction, String(viewId)));
    await prisma.$transaction((transaction) => aggregateTopicView(transaction, String(viewId)));
    await expect(
      prisma.communityTopic.findUniqueOrThrow({ where: { id: topic.id } }),
    ).resolves.toMatchObject({ viewCount: 1 });

    await expect(
      recordTopicView({
        number: topic.number,
        anonymousFingerprint: "203.0.113.8|integration-browser",
        now: new Date(now.getTime() + 31 * 60_000),
      }),
    ).resolves.toMatchObject({ accepted: true });
  });

  it("searches public content and excludes soft-deleted topics", async () => {
    const author = await createActor("Search Author");
    await createTopic(
      { userId: author.id },
      {
        nodeSlug: "ai",
        title: "NebulaSignal PostgreSQL 搜索可见主题",
        body: "NebulaSignal 正文用于独立验证标题和 Markdown 源内容搜索。",
        action: "publish",
      },
    );
    const deleted = await createTopic(
      { userId: author.id },
      {
        nodeSlug: "domain",
        title: "DeletedQuasar 不应出现在搜索结果",
        body: "DeletedQuasar 只用于验证软删除内容不会通过搜索泄露。",
        action: "publish",
      },
    );
    await deleteTopic({ userId: author.id }, deleted.number);

    const topics = await searchContent({ query: "NebulaSignal", category: "topics" });
    expect(topics.topics).toContainEqual(
      expect.objectContaining({ title: expect.stringContaining("NebulaSignal") }),
    );
    const removed = await searchContent({ query: "DeletedQuasar", category: "topics" });
    expect(removed.topics).toHaveLength(0);
    const members = await searchContent({ query: "ix_search", category: "members" });
    expect(members.members).toContainEqual(
      expect.objectContaining({ username: expect.stringContaining("ix_search") }),
    );
    const nodes = await searchContent({ query: "人工智能", category: "nodes" });
    expect(nodes.nodes).toContainEqual(expect.objectContaining({ slug: "ai" }));
  });

  it("ranks recent independent participation ahead of old capped views", async () => {
    const prisma = getPrismaClient();
    const [author, participant] = await Promise.all([
      createActor("Hot Author"),
      createActor("Hot Participant"),
    ]);
    const recent = await createTopic(
      { userId: author.id },
      {
        nodeSlug: "showcase",
        title: "近期独立参与热门算法主题",
        body: "近期主题通过真实独立回复形成参与信号，不依赖管理员写入热门分数。",
        action: "publish",
      },
    );
    await createReply({ userId: participant.id }, recent.number, {
      body: "独立参与者的真实回复会进入热门算法，但每项信号都有上限。",
    });
    const old = await createTopic(
      { userId: author.id },
      {
        nodeSlug: "showcase",
        title: "旧浏览量热门算法对照主题",
        body: "旧主题即使达到浏览量信号上限，也会受到明确的时间衰减。",
        action: "publish",
      },
    );
    await prisma.communityTopic.update({
      where: { id: old.id },
      data: { publishedAt: new Date(Date.now() - 10 * 86_400_000), viewCount: 50_000 },
    });
    const ranked = await listHotTopicIds({
      nodeId: (await prisma.communityNode.findUniqueOrThrow({ where: { slug: "showcase" } })).id,
      asOf: new Date(),
      limit: 100,
    });
    expect(ranked.findIndex(({ id }) => id === recent.id)).toBeLessThan(
      ranked.findIndex(({ id }) => id === old.id),
    );
  });
});
