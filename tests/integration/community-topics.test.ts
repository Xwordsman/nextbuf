import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup } from "@/cli/commands/setup";
import { disconnectPrismaClient, getPrismaClient } from "@/infrastructure/database/client";
import { readStoredAttachment } from "@/infrastructure/storage/attachment-storage";
import { processCommunityAttachment } from "@/modules/community/attachment-worker.server";
import {
  collectCommunityAttachment,
  createCommunityAttachment,
} from "@/modules/community/attachments.server";
import { createCommunityNode, updateCommunityNode } from "@/modules/community/nodes.server";
import { getCommunityHomeView, getTopicPageView } from "@/modules/community/queries.server";
import {
  createTopic,
  deleteTopic,
  moderateTopic,
  restoreTopic,
  updateTopicContent,
} from "@/modules/community/topics.server";
import {
  createReply,
  deleteReply,
  restoreReply,
  saveReplyDraft,
  updateReply,
} from "@/modules/community/replies.server";
import { ensureCommunityNodeFixtures } from "../support/community-node-fixtures";

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
    await prisma.communityAttachment.deleteMany({ where: { uploaderId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.communityNode.deleteMany({ where: { slug: "integration-created" } });
    await ensureCommunityNodeFixtures();
  });

  afterAll(async () => {
    await disconnectPrismaClient();
  });

  it("allows only administrators to create unique audited nodes", async () => {
    const prisma = getPrismaClient();
    const [admin, ordinary] = await Promise.all([
      createActor("Create Node Admin"),
      createActor("Create Node Ordinary"),
    ]);
    await prisma.communityRoleAssignment.create({
      data: { userId: admin.id, role: "admin", scopeKey: "site" },
    });
    const input = {
      slug: "integration-created",
      name: "集成测试节点",
      description: "由管理员显式创建",
      color: "#334455",
      icon: "grid",
      sortOrder: 70,
      visibility: "public" as const,
    };
    await expect(createCommunityNode({ userId: ordinary.id }, input)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      createCommunityNode({ userId: admin.id, requestId: "node-create-test" }, input),
    ).resolves.toMatchObject({ slug: input.slug, name: input.name });
    await expect(createCommunityNode({ userId: admin.id }, input)).rejects.toMatchObject({
      code: "node_conflict",
    });
    await expect(
      prisma.communityAuditEvent.count({
        where: { action: "node.created", node: { slug: input.slug } },
      }),
    ).resolves.toBe(1);
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

  it("allocates stable floors and counts under concurrent replies", async () => {
    const prisma = getPrismaClient();
    const [topicAuthor, replier, mentioned] = await Promise.all([
      createActor("Reply Topic Author"),
      createActor("Concurrent Replier"),
      createActor("Mention Target"),
    ]);
    const topic = await createTopic(
      { userId: topicAuthor.id },
      {
        nodeSlug: "ai",
        title: "并发回复楼层与计数验证主题",
        body: "这是用于验证并发回复楼层分配、引用、提及和删除恢复的一段主题正文。",
        action: "publish",
      },
    );

    const concurrent = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        createReply({ userId: replier.id }, topic.number, {
          body: `这是第 ${index + 1} 条并发回复，正文长度满足发布要求。`,
        }),
      ),
    );
    expect(concurrent.map(({ position }) => position).sort((a, b) => a - b)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    await expect(
      prisma.communityTopic.findUniqueOrThrow({ where: { id: topic.id } }),
    ).resolves.toMatchObject({
      replyCount: 8,
      nextPostPosition: 10,
    });

    const quoted = await createReply({ userId: topicAuthor.id }, topic.number, {
      body: `引用并提及 @${mentioned.username}，验证提及事实会被解析并持久化。`,
      quotedPosition: 2,
    });
    expect(quoted.position).toBe(10);
    await expect(
      prisma.communityPostMention.findUnique({
        where: {
          postId_mentionedUserId: { postId: quoted.id, mentionedUserId: mentioned.id },
        },
      }),
    ).resolves.toBeTruthy();
    await updateReply({ userId: topicAuthor.id }, topic.number, quoted.position, {
      body: `修改后的回复仍然提及 @${mentioned.username}，并保留对第二楼的引用关系。`,
      quotedPosition: 2,
    });
    await expect(
      prisma.communityPost.findUniqueOrThrow({ where: { id: quoted.id } }),
    ).resolves.toMatchObject({
      revisionCount: 2,
      quotedPostId: concurrent.find(({ position }) => position === 2)?.id,
    });
    const quotedView = await getTopicPageView(topic.number, topicAuthor.id, 2);
    expect(quotedView?.replies.find(({ id }) => id === quoted.id)?.quote).toMatchObject({
      position: 2,
      authorName: replier.name,
      excerpt: expect.stringContaining("这是第"),
    });

    await deleteReply({ userId: topicAuthor.id }, topic.number, quoted.position);
    const deletedView = await getTopicPageView(topic.number, topicAuthor.id, 2);
    expect(deletedView?.replies.find(({ position }) => position === quoted.position)).toMatchObject(
      {
        status: "deleted",
        body: "",
        canRestore: true,
      },
    );
    await restoreReply({ userId: topicAuthor.id }, topic.number, quoted.position);
    await expect(
      prisma.communityTopic.findUniqueOrThrow({ where: { id: topic.id } }),
    ).resolves.toMatchObject({
      replyCount: 9,
      nextPostPosition: 11,
    });
  });

  it("autosaves one reply draft and enforces closed-topic permissions", async () => {
    const prisma = getPrismaClient();
    const [author, member, moderator] = await Promise.all([
      createActor("Draft Topic Author"),
      createActor("Draft Member"),
      createActor("Draft Moderator"),
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
    const topic = await createTopic(
      { userId: author.id },
      {
        nodeSlug: "site",
        title: "回复草稿和关闭权限验证主题",
        body: "这是用于验证回复草稿覆盖保存以及主题关闭后权限限制的一段正文。",
        action: "publish",
      },
    );
    await saveReplyDraft({ userId: member.id }, topic.number, { body: "第一次自动保存的回复草稿" });
    await saveReplyDraft({ userId: member.id }, topic.number, {
      body: "第二次自动保存会覆盖同一份回复草稿",
    });
    await expect(
      prisma.communityPostDraft.findMany({ where: { topicId: topic.id, authorId: member.id } }),
    ).resolves.toMatchObject([{ bodySource: "第二次自动保存会覆盖同一份回复草稿" }]);
    await moderateTopic({ userId: moderator.id }, topic.number, {
      isPinned: false,
      isEssence: false,
      isClosed: true,
      isHidden: false,
    });
    await expect(
      createReply({ userId: member.id }, topic.number, {
        body: "普通成员不能回复已经关闭的主题。",
      }),
    ).rejects.toMatchObject({ code: "topic_closed" });
    await expect(
      createReply({ userId: moderator.id }, topic.number, {
        body: "节点版主可以在关闭主题后继续回复。",
      }),
    ).resolves.toMatchObject({ position: 2 });
  });

  it("tracks attachment processing failures and immutable revision references", async () => {
    const prisma = getPrismaClient();
    const author = await createActor("Attachment Author");
    const textAttachment = await createCommunityAttachment({
      uploaderId: author.id,
      bytes: new TextEncoder().encode("NextBuf attachment integration fixture"),
      declaredType: "text/plain",
      originalName: "fixture.txt",
    });
    await prisma.$transaction((transaction) =>
      processCommunityAttachment(transaction, textAttachment.id),
    );
    const topic = await createTopic(
      { userId: author.id },
      {
        nodeSlug: "showcase",
        title: "附件处理和修订引用验证主题",
        body: `这是包含附件引用的主题正文。[fixture.txt](/api/media/attachments/${textAttachment.id})`,
        action: "publish",
      },
    );
    await updateTopicContent({ userId: author.id }, topic.number, {
      nodeSlug: "showcase",
      title: "附件处理和修订引用验证主题",
      body: "修改后的主题正文不再直接显示附件，但历史修订仍然保留附件引用。",
      action: "save",
    });
    await expect(
      prisma.communityRevisionAttachment.count({ where: { attachmentId: textAttachment.id } }),
    ).resolves.toBe(1);
    await expect(
      prisma.$transaction((transaction) =>
        collectCommunityAttachment(transaction, textAttachment.id),
      ),
    ).resolves.toMatchObject({ status: "retained" });

    const validImageBytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#2563eb" },
    })
      .png()
      .toBuffer();
    const validImage = await createCommunityAttachment({
      uploaderId: author.id,
      bytes: validImageBytes,
      declaredType: "image/png",
      originalName: "valid.png",
    });
    await expect(
      prisma.$transaction((transaction) => processCommunityAttachment(transaction, validImage.id)),
    ).resolves.toMatchObject({ status: "ready" });
    await expect(
      prisma.communityAttachment.findUniqueOrThrow({ where: { id: validImage.id } }),
    ).resolves.toMatchObject({
      status: "ready",
      processedType: "image/webp",
      width: 2,
      height: 2,
      processedKey: expect.stringContaining("attachments/processed/"),
    });

    const invalidImage = await createCommunityAttachment({
      uploaderId: author.id,
      bytes: Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0,
        0, 1, 0, 0, 0, 1,
      ]),
      declaredType: "image/png",
      originalName: "broken.png",
    });
    await expect(
      prisma.$transaction((transaction) =>
        processCommunityAttachment(transaction, invalidImage.id),
      ),
    ).resolves.toMatchObject({ status: "failed" });
    const failed = await prisma.communityAttachment.findUniqueOrThrow({
      where: { id: invalidImage.id },
    });
    expect(failed.processingError).toBeTruthy();
    await expect(
      readStoredAttachment(failed.storageDriver as "local" | "s3", failed.storageKey),
    ).resolves.toBeTruthy();
  });
});
