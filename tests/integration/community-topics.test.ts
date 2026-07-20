import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { setup } from "@/cli/commands/setup";
import { disconnectPrismaClient, getPrismaClient } from "@/infrastructure/database/client";
import { readStoredAttachment } from "@/infrastructure/storage/attachment-storage";
import { listAdminAuditEvents } from "@/modules/admin/audit.server";
import { listAdminTopics, getAdminNodes, listAdminReplies } from "@/modules/admin/content.server";
import { getAdminDashboard } from "@/modules/admin/dashboard.server";
import { getAdminUserDetail, listAdminUsers } from "@/modules/admin/users.server";
import { processCommunityAttachment } from "@/modules/community/attachment-worker.server";
import {
  collectCommunityAttachment,
  createCommunityAttachment,
} from "@/modules/community/attachments.server";
import { pruneReplyEditorSessionTombstones } from "@/modules/community/editor-session-maintenance.server";
import { findReplyEditorSessionTarget } from "@/modules/community/editor-session-recovery.server";
import { createCommunityNode, updateCommunityNode } from "@/modules/community/nodes.server";
import {
  getCommunityHomeView,
  getTopicPageView,
  listUserTopics,
} from "@/modules/community/queries.server";
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
import { MAX_REPLY_EDITOR_SESSIONS_PER_HOUR } from "@/shared/community/editor-session";
import { ensureCommunityNodeFixtures } from "../support/community-node-fixtures";

const emailPrefix = "community-integration+";
const emailDomain = "@nextbuf.test";

async function createActor(name: string) {
  const suffix = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  const readable = suffix.replaceAll("_", "").slice(0, 5);
  const fingerprint = createHash("sha256").update(name).digest("hex").slice(0, 8);
  return getPrismaClient().user.create({
    data: {
      name,
      username: `community_${readable}_${fingerprint}`,
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

  it("deduplicates concurrent topic editor sessions and ignores late snapshots", async () => {
    const prisma = getPrismaClient();
    const author = await createActor("Idempotent Topic Author");
    const editorSessionKey = randomUUID();
    const initial = {
      nodeSlug: "ai",
      title: "并发自动保存只创建一个主题",
      body: "这是用于验证同一编辑会话首次自动保存并发幂等的一段完整正文。",
      action: "draft" as const,
      editorSessionKey,
      editorSessionRevision: 1,
    };

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => createTopic({ userId: author.id }, initial)),
    );
    expect(new Set(attempts.map((topic) => topic.id)).size).toBe(1);
    expect(new Set(attempts.map((topic) => topic.number)).size).toBe(1);
    await expect(
      prisma.communityTopic.count({ where: { authorId: author.id, editorSessionKey } }),
    ).resolves.toBe(1);
    await expect(
      prisma.communityPostRevision.count({
        where: { post: { topicId: attempts[0]!.id } },
      }),
    ).resolves.toBe(1);

    const latestBody = "这是更高编辑版本保存的最终草稿正文，旧请求后到也不能覆盖它。";
    const latest = await updateTopicContent({ userId: author.id }, attempts[0]!.number, {
      nodeSlug: initial.nodeSlug,
      title: initial.title,
      body: latestBody,
      action: "autosave",
      editorSessionKey,
      editorSessionRevision: 3,
    });
    await expect(
      updateTopicContent({ userId: author.id }, attempts[0]!.number, {
        nodeSlug: initial.nodeSlug,
        title: initial.title,
        body: "这是迟到的旧版本正文，不应覆盖更高版本。",
        action: "autosave",
        editorSessionKey,
        editorSessionRevision: 2,
      }),
    ).rejects.toMatchObject({ code: "editor_session_conflict" });
    await expect(
      prisma.communityPost.findFirstOrThrow({ where: { topicId: latest.id, position: 1 } }),
    ).resolves.toMatchObject({ bodySource: latestBody });

    const published = await updateTopicContent({ userId: author.id }, attempts[0]!.number, {
      nodeSlug: initial.nodeSlug,
      title: initial.title,
      body: latestBody,
      action: "publish",
      editorSessionKey,
      editorSessionRevision: 4,
    });
    expect(published).toMatchObject({ id: latest.id, status: "published" });
    await updateTopicContent({ userId: author.id }, attempts[0]!.number, {
      nodeSlug: initial.nodeSlug,
      title: initial.title,
      body: "即使版本更高，发布后迟到的草稿也不能修改公开正文。",
      action: "autosave",
      editorSessionKey,
      editorSessionRevision: 5,
    });
    await createTopic(
      { userId: author.id },
      {
        ...initial,
        body: latestBody,
        action: "publish",
        editorSessionRevision: 6,
      },
    );
    await expect(
      prisma.communityTopic.findUniqueOrThrow({ where: { id: latest.id } }),
    ).resolves.toMatchObject({
      status: "published",
      editorSessionRevision: 4,
    });
    await expect(
      prisma.communityPost.findFirstOrThrow({ where: { topicId: latest.id, position: 1 } }),
    ).resolves.toMatchObject({ bodySource: latestBody });
    await expect(
      prisma.communityAuditEvent.count({
        where: { topicId: latest.id, action: "topic.draft.created" },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.communityAuditEvent.count({
        where: { topicId: latest.id, action: "topic.published" },
      }),
    ).resolves.toBe(1);

    const otherAuthor = await createActor("Other Idempotent Topic Author");
    await expect(
      createTopic({ userId: otherAuthor.id }, { ...initial, editorSessionRevision: 1 }),
    ).resolves.not.toMatchObject({ id: latest.id });

    await prisma.user.update({ where: { id: author.id }, data: { status: "suspended" } });
    await expect(
      updateTopicContent({ userId: author.id }, attempts[0]!.number, {
        nodeSlug: initial.nodeSlug,
        title: initial.title,
        body: latestBody,
        action: "publish",
        editorSessionKey,
        editorSessionRevision: 7,
      }),
    ).resolves.toMatchObject({ id: latest.id, status: "published" });
  });

  it("enforces editor-session constraints and nullable legacy compatibility in PostgreSQL", async () => {
    const prisma = getPrismaClient();
    const [firstAuthor, secondAuthor] = await Promise.all([
      createActor("Editor Constraint First"),
      createActor("Editor Constraint Second"),
    ]);
    const node = await prisma.communityNode.findUniqueOrThrow({ where: { slug: "ai" } });
    const sharedKey = randomUUID();
    const firstTopic = await prisma.communityTopic.create({
      data: {
        nodeId: node.id,
        authorId: firstAuthor.id,
        editorSessionKey: sharedKey,
        editorSessionRevision: 1,
        title: "编辑会话约束主题一",
      },
    });
    await expect(
      prisma.communityTopic.create({
        data: {
          nodeId: node.id,
          authorId: firstAuthor.id,
          editorSessionKey: sharedKey,
          editorSessionRevision: 1,
          title: "同一作者不能重复使用主题编辑会话",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.communityTopic.create({
        data: {
          nodeId: node.id,
          authorId: secondAuthor.id,
          editorSessionKey: sharedKey,
          editorSessionRevision: 1,
          title: "不同作者可以使用相同随机键",
        },
      }),
    ).resolves.toMatchObject({ authorId: secondAuthor.id });
    await expect(
      Promise.all([
        prisma.communityTopic.create({
          data: { nodeId: node.id, authorId: firstAuthor.id, title: "历史空键主题一" },
        }),
        prisma.communityTopic.create({
          data: { nodeId: node.id, authorId: firstAuthor.id, title: "历史空键主题二" },
        }),
      ]),
    ).resolves.toHaveLength(2);

    await expect(
      prisma.$executeRaw(
        Prisma.sql`INSERT INTO "community_topics" (
          "id", "node_id", "author_id", "editor_session_key", "title", "updated_at"
        ) VALUES (
          CAST(${randomUUID()} AS uuid), CAST(${node.id} AS uuid), CAST(${firstAuthor.id} AS uuid),
          CAST(${randomUUID()} AS uuid), '缺少 revision 的非法主题', CURRENT_TIMESTAMP
        )`,
      ),
    ).rejects.toBeDefined();
    await expect(
      prisma.$executeRaw(
        Prisma.sql`INSERT INTO "community_posts" (
          "id", "topic_id", "author_id", "editor_session_key", "editor_session_revision",
          "position", "status", "body_source", "updated_at"
        ) VALUES (
          CAST(${randomUUID()} AS uuid), CAST(${firstTopic.id} AS uuid),
          CAST(${firstAuthor.id} AS uuid), CAST(${randomUUID()} AS uuid), 1,
          1, 'draft', '首帖不能携带回复编辑会话', CURRENT_TIMESTAMP
        )`,
      ),
    ).rejects.toBeDefined();
    await expect(
      prisma.$executeRaw(
        Prisma.sql`INSERT INTO "community_post_drafts" (
          "id", "topic_id", "author_id", "editor_session_revision", "updated_at"
        ) VALUES (
          CAST(${randomUUID()} AS uuid), CAST(${firstTopic.id} AS uuid),
          CAST(${firstAuthor.id} AS uuid), 1, CURRENT_TIMESTAMP
        )`,
      ),
    ).rejects.toBeDefined();

    const constraints = await prisma.$queryRaw<Array<{ conname: string; convalidated: boolean }>>(
      Prisma.sql`SELECT conname, convalidated
        FROM pg_constraint
        WHERE conname IN (
          'community_topics_editor_session_check',
          'community_posts_editor_session_check',
          'community_post_drafts_editor_session_check',
          'community_reply_editor_sessions_state_check'
        )`,
    );
    expect(constraints).toHaveLength(4);
    expect(constraints.every((constraint) => constraint.convalidated)).toBe(true);
    const indexes = await prisma.$queryRaw<
      Array<{ name: string; indisunique: boolean; indisvalid: boolean; indisready: boolean }>
    >(Prisma.sql`SELECT class.relname AS name, index.indisunique, index.indisvalid, index.indisready
      FROM pg_index AS index
      JOIN pg_class AS class ON class.oid = index.indexrelid
      WHERE class.relname IN (
        'community_topics_author_editor_session_key',
        'community_posts_author_editor_session_key',
        'community_post_drafts_author_editor_session_key',
        'community_reply_editor_sessions_author_key',
        'community_reply_editor_sessions_author_created_idx',
        'community_reply_editor_sessions_state_updated_idx'
      )`);
    expect(indexes).toHaveLength(6);
    expect(indexes.every((index) => index.indisvalid && index.indisready)).toBe(true);
    expect(
      indexes
        .filter((index) => index.indisunique)
        .map((index) => index.name)
        .sort(),
    ).toEqual(
      [
        "community_topics_author_editor_session_key",
        "community_posts_author_editor_session_key",
        "community_post_drafts_author_editor_session_key",
        "community_reply_editor_sessions_author_key",
      ].sort(),
    );
  });

  it("keeps private draft lineages out of every administrator content surface", async () => {
    const prisma = getPrismaClient();
    const [author, admin] = await Promise.all([
      createActor("Private Draft Author"),
      createActor("Private Draft Admin"),
    ]);
    await prisma.communityRoleAssignment.create({
      data: { userId: admin.id, role: "admin", scopeKey: "site" },
    });
    const [dashboardBefore, nodesBefore] = await Promise.all([
      getAdminDashboard(admin.id),
      getAdminNodes(admin.id),
    ]);
    const siteCountBefore = nodesBefore.find((node) => node.slug === "site")?._count.topics;
    const activeDraft = await createTopic(
      { userId: author.id },
      {
        nodeSlug: "site",
        title: "仅作者可见的活动草稿",
        body: "这段私人草稿正文不能出现在后台列表、计数、详情或审计查询中。",
        action: "draft",
      },
    );
    const deletedDraft = await createTopic(
      { userId: author.id },
      {
        nodeSlug: "site",
        title: "仅作者可见的已删除草稿",
        body: "删除草稿后仍然保持私人谱系，管理员和版主不能借删除状态读取。",
        action: "draft",
      },
    );
    await deleteTopic({ userId: author.id }, deletedDraft.number);
    const legacyDeletedDraft = await createTopic(
      { userId: author.id },
      {
        nodeSlug: "site",
        title: "来源状态缺失的历史删除草稿",
        body: "来源状态为空的删除记录恢复时会回到草稿，因此必须继续按私人内容处理。",
        action: "draft",
      },
    );
    await prisma.$transaction([
      prisma.communityPost.updateMany({
        where: { topicId: legacyDeletedDraft.id, position: 1 },
        data: { status: "deleted", deletedAt: new Date() },
      }),
      prisma.communityTopic.update({
        where: { id: legacyDeletedDraft.id },
        data: { status: "deleted", deletedFromStatus: null, deletedAt: new Date() },
      }),
    ]);

    const [listed, searched, forcedDraft, dashboardAfter, nodesAfter, userDetail, users, audits] =
      await Promise.all([
        listAdminTopics(admin.id, {}),
        listAdminTopics(admin.id, { query: "仅作者可见" }),
        listAdminTopics(admin.id, { query: "仅作者可见", status: "draft" }),
        getAdminDashboard(admin.id),
        getAdminNodes(admin.id),
        getAdminUserDetail(admin.id, author.uid),
        listAdminUsers(admin.id, { query: author.username }),
        listAdminAuditEvents(admin.id, {
          source: "community",
          actorUid: author.uid,
          action: "topic",
        }),
      ]);
    expect(listed.topics.map((topic) => topic.id)).not.toContain(activeDraft.id);
    expect(listed.topics.map((topic) => topic.id)).not.toContain(deletedDraft.id);
    expect(listed.topics.map((topic) => topic.id)).not.toContain(legacyDeletedDraft.id);
    expect(searched.topics).toHaveLength(0);
    expect(forcedDraft.topics).toHaveLength(0);
    expect(dashboardAfter.content).toEqual(dashboardBefore.content);
    expect(dashboardAfter.users.active30d).toBe(dashboardBefore.users.active30d);
    expect(nodesAfter.find((node) => node.slug === "site")?._count.topics).toBe(siteCountBefore);
    expect(userDetail._count).toMatchObject({ communityTopics: 0, communityPosts: 0 });
    expect(users.items).toHaveLength(1);
    expect(users.items[0]?._count).toMatchObject({ communityTopics: 0, communityPosts: 0 });
    expect(audits.items).toHaveLength(0);
    await expect(getTopicPageView(activeDraft.number, admin.id)).resolves.toBeNull();
    await expect(getTopicPageView(deletedDraft.number, admin.id)).resolves.toBeNull();
    await expect(getTopicPageView(legacyDeletedDraft.number, admin.id)).resolves.toBeNull();
    const hiddenAsNotFound = { code: "topic_not_found", status: 404 };
    await expect(deleteTopic({ userId: admin.id }, activeDraft.number)).rejects.toMatchObject(
      hiddenAsNotFound,
    );
    await expect(restoreTopic({ userId: admin.id }, activeDraft.number)).rejects.toMatchObject(
      hiddenAsNotFound,
    );
    await expect(
      updateTopicContent({ userId: admin.id }, activeDraft.number, {
        nodeSlug: "site",
        title: "管理员不能探测或修改私人草稿",
        body: "即使管理员提交完整有效内容，也只能得到与主题不存在相同的响应。",
        action: "save",
      }),
    ).rejects.toMatchObject(hiddenAsNotFound);
    await expect(
      moderateTopic({ userId: admin.id }, activeDraft.number, {
        isPinned: false,
        isEssence: false,
        isClosed: false,
        isHidden: false,
      }),
    ).rejects.toMatchObject(hiddenAsNotFound);
    await expect(restoreTopic({ userId: admin.id }, deletedDraft.number)).rejects.toMatchObject({
      code: "topic_not_found",
      status: 404,
    });
    await expect(
      restoreTopic({ userId: admin.id }, legacyDeletedDraft.number),
    ).rejects.toMatchObject(hiddenAsNotFound);
    await expect(getTopicPageView(activeDraft.number, author.id)).resolves.toMatchObject({
      status: "draft",
    });
    await expect(getTopicPageView(deletedDraft.number, author.id)).resolves.toMatchObject({
      status: "deleted",
      canRestore: true,
    });
    await expect(listUserTopics(author.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: activeDraft.id }),
        expect.objectContaining({ id: deletedDraft.id }),
        expect.objectContaining({ id: legacyDeletedDraft.id }),
      ]),
    );

    const published = await createTopic(
      { userId: author.id },
      {
        nodeSlug: "site",
        title: "后台仍可管理的公开主题",
        body: "这是用于确认草稿隐私筛选不会误伤已发布内容的一段完整正文。",
        action: "publish",
      },
    );
    await saveReplyDraft({ userId: admin.id }, published.number, {
      body: "后台回复列表绝不能读取这段真实回复草稿正文",
    });
    await expect(
      listAdminTopics(admin.id, { query: "后台仍可管理的公开主题" }),
    ).resolves.toMatchObject({ topics: [expect.objectContaining({ id: published.id })] });
    await expect(
      listAdminTopics(admin.id, { query: "后台仍可管理的公开主题", status: "draft" }),
    ).resolves.toMatchObject({ topics: [] });

    const [dashboardBeforeDraftPost, detailBeforeDraftPost] = await Promise.all([
      getAdminDashboard(admin.id),
      getAdminUserDetail(admin.id, author.uid),
    ]);
    await prisma.communityPost.create({
      data: {
        topicId: published.id,
        authorId: author.id,
        position: 2,
        status: "draft",
        bodySource: "异常遗留的 Post 草稿不能进入后台回复数量或活跃用户统计。",
      },
    });
    const [dashboardAfterDraftPost, detailAfterDraftPost] = await Promise.all([
      getAdminDashboard(admin.id),
      getAdminUserDetail(admin.id, author.uid),
    ]);
    expect(dashboardAfterDraftPost.content.replies).toBe(dashboardBeforeDraftPost.content.replies);
    expect(dashboardAfterDraftPost.users.active30d).toBe(dashboardBeforeDraftPost.users.active30d);
    expect(detailAfterDraftPost._count.communityPosts).toBe(
      detailBeforeDraftPost._count.communityPosts,
    );
    await expect(
      listAdminReplies(admin.id, {
        query: "后台回复列表绝不能读取这段真实回复草稿正文",
        status: "draft",
      }),
    ).resolves.toMatchObject({ replies: [] });

    await moderateTopic({ userId: admin.id }, published.number, {
      isPinned: false,
      isEssence: false,
      isClosed: true,
      isHidden: false,
    });
    await expect(listAdminTopics(admin.id, { status: "closed" })).resolves.toMatchObject({
      topics: expect.arrayContaining([expect.objectContaining({ id: published.id })]),
    });
    await moderateTopic({ userId: admin.id }, published.number, {
      isPinned: false,
      isEssence: false,
      isClosed: true,
      isHidden: true,
    });
    await expect(listAdminTopics(admin.id, { status: "hidden" })).resolves.toMatchObject({
      topics: expect.arrayContaining([expect.objectContaining({ id: published.id })]),
    });
    await deleteTopic({ userId: admin.id }, published.number);
    await expect(listAdminTopics(admin.id, { status: "deleted" })).resolves.toMatchObject({
      topics: expect.arrayContaining([expect.objectContaining({ id: published.id })]),
    });
    await expect(
      listAdminAuditEvents(admin.id, {
        source: "community",
        actorUid: author.uid,
        action: "topic.published",
      }),
    ).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ targetType: "topic", targetKey: String(published.number) }),
      ]),
    });
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

  it("keeps anomalous draft replies private and redacts unavailable quote sources", async () => {
    const prisma = getPrismaClient();
    const [topicAuthor, replier, viewer, moderator] = await Promise.all([
      createActor("Quote Visibility Topic Author"),
      createActor("Quote Visibility Replier"),
      createActor("Quote Visibility Viewer"),
      createActor("Quote Visibility Moderator"),
    ]);
    const node = await prisma.communityNode.findUniqueOrThrow({ where: { slug: "ai" } });
    await prisma.communityRoleAssignment.create({
      data: {
        userId: moderator.id,
        role: "node_moderator",
        nodeId: node.id,
        scopeKey: node.id,
      },
    });
    const topic = await createTopic(
      { userId: topicAuthor.id },
      {
        nodeSlug: "ai",
        title: "回复引用可见性与异常草稿隔离主题",
        body: "这是一段用于验证隐藏、删除和异常草稿回复不会泄露正文的完整主题正文。",
        action: "publish",
      },
    );
    const sourceBody = "这条公开回复随后会被隐藏，用于验证历史引用只能显示安全占位。";
    const source = await createReply({ userId: replier.id }, topic.number, {
      body: sourceBody,
    });
    const quoting = await createReply({ userId: topicAuthor.id }, topic.number, {
      body: "这条回复保留对第二楼的历史引用。",
      quotedPosition: source.position,
    });

    await prisma.communityPost.update({ where: { id: source.id }, data: { status: "hidden" } });
    await expect(
      createReply({ userId: viewer.id }, topic.number, {
        body: "普通用户不能创建指向隐藏回复的新引用。",
        quotedPosition: source.position,
      }),
    ).rejects.toMatchObject({ code: "post_not_found" });
    await expect(
      updateReply({ userId: topicAuthor.id }, topic.number, quoting.position, {
        body: "编辑既有回复时仍可保留后来被隐藏的历史引用。",
        quotedPosition: source.position,
      }),
    ).resolves.toMatchObject({ quotedPostId: source.id });

    const ordinaryHiddenView = await getTopicPageView(topic.number, viewer.id, 2);
    expect(ordinaryHiddenView?.replies.find(({ id }) => id === source.id)).toMatchObject({
      status: "hidden",
      body: "",
      bodyHtml: "",
    });
    expect(ordinaryHiddenView?.replies.find(({ id }) => id === quoting.id)?.quote).toMatchObject({
      position: source.position,
      excerpt: "该回复已隐藏",
    });

    const moderatorHiddenView = await getTopicPageView(topic.number, moderator.id, 2);
    expect(moderatorHiddenView?.replies.find(({ id }) => id === source.id)).toMatchObject({
      status: "hidden",
      body: sourceBody,
    });
    expect(moderatorHiddenView?.replies.find(({ id }) => id === quoting.id)?.quote).toMatchObject({
      position: source.position,
      excerpt: expect.stringContaining("这条公开回复"),
    });

    await prisma.communityPost.update({ where: { id: source.id }, data: { status: "deleted" } });
    const deletedView = await getTopicPageView(topic.number, viewer.id, 2);
    expect(deletedView?.replies.find(({ id }) => id === quoting.id)?.quote).toMatchObject({
      position: source.position,
      excerpt: "该回复已删除",
    });

    const anomalousDraft = await createReply({ userId: replier.id }, topic.number, {
      body: "这条回复会被直接改成异常草稿状态，公开查询必须完全排除。",
    });
    await prisma.communityPost.update({
      where: { id: anomalousDraft.id },
      data: { status: "draft" },
    });
    await expect(
      createReply({ userId: viewer.id }, topic.number, {
        body: "普通用户不能创建指向异常草稿回复的新引用。",
        quotedPosition: anomalousDraft.position,
      }),
    ).rejects.toMatchObject({ code: "post_not_found" });
    const draftFilteredView = await getTopicPageView(topic.number, viewer.id, 2);
    expect(draftFilteredView?.replies.some(({ id }) => id === anomalousDraft.id)).toBe(false);
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

  it("lets a suspended member clear an owned reply draft after the topic closes", async () => {
    const prisma = getPrismaClient();
    const [author, replier] = await Promise.all([
      createActor("Closed Draft Author"),
      createActor("Suspended Draft Replier"),
    ]);
    const topic = await createTopic(
      { userId: author.id },
      {
        nodeSlug: "site",
        title: "关闭主题后仍可清理本人回复草稿",
        body: "这是一段用于验证主题关闭且账号受限后仍可删除本人私人回复草稿的完整正文。",
        action: "publish",
      },
    );
    const editorSessionKey = randomUUID();
    await saveReplyDraft({ userId: replier.id }, topic.number, {
      body: "这份私人回复草稿必须允许作者在受限后清理。",
      editorSessionKey,
      editorSessionRevision: 1,
    });
    await prisma.$transaction([
      prisma.communityTopic.update({
        where: { id: topic.id },
        data: { status: "closed", closedAt: new Date() },
      }),
      prisma.user.update({ where: { id: replier.id }, data: { status: "suspended" } }),
    ]);

    await expect(
      saveReplyDraft({ userId: replier.id }, topic.number, {
        body: "",
        editorSessionKey,
        editorSessionRevision: 2,
      }),
    ).resolves.toBeNull();
    await expect(
      prisma.communityPostDraft.count({ where: { topicId: topic.id, authorId: replier.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.communityReplyEditorSession.findUniqueOrThrow({
        where: { authorId_key: { authorId: replier.id, key: editorSessionKey } },
      }),
    ).resolves.toMatchObject({ state: "cleared", revision: 2 });
  });

  it("rate limits the sixty-first new reply editor session within one hour", async () => {
    const prisma = getPrismaClient();
    const [author, replier] = await Promise.all([
      createActor("Limit Topic Author"),
      createActor("Limit Replier"),
    ]);
    const topic = await createTopic(
      { userId: author.id },
      {
        nodeSlug: "site",
        title: "回复编辑会话创建频率限制验证主题",
        body: "这是一段用于验证空正文会话也不能无限制造数据库记录的完整主题正文。",
        action: "publish",
      },
    );
    const now = new Date();
    await prisma.communityReplyEditorSession.createMany({
      data: Array.from({ length: MAX_REPLY_EDITOR_SESSIONS_PER_HOUR }, () => ({
        topicId: topic.id,
        authorId: replier.id,
        key: randomUUID(),
        revision: 1,
        state: "cleared",
        createdAt: now,
        updatedAt: now,
      })),
    });

    await expect(
      saveReplyDraft({ userId: replier.id }, topic.number, {
        body: "",
        editorSessionKey: randomUUID(),
        editorSessionRevision: 1,
      }),
    ).rejects.toMatchObject({
      code: "editor_session_rate_limited",
      status: 429,
      details: { limit: 60, retryAfter: 3600 },
    });
    await expect(
      createReply({ userId: replier.id }, topic.number, {
        body: "直接发布也不能绕过回复编辑会话创建频率限制。",
        editorSessionKey: randomUUID(),
        editorSessionRevision: 1,
      }),
    ).rejects.toMatchObject({
      code: "editor_session_rate_limited",
      status: 429,
      details: { limit: 60, retryAfter: 3600 },
    });
    await expect(
      prisma.communityReplyEditorSession.count({ where: { authorId: replier.id } }),
    ).resolves.toBe(MAX_REPLY_EDITOR_SESSIONS_PER_HOUR);
    await expect(
      prisma.communityPost.count({ where: { topicId: topic.id, authorId: replier.id } }),
    ).resolves.toBe(0);
  });

  it("orders reply snapshots and finalizes one idempotent reply position", async () => {
    const prisma = getPrismaClient();
    const [author, replier] = await Promise.all([
      createActor("Reply Session Topic Author"),
      createActor("Reply Session Replier"),
    ]);
    const topic = await createTopic(
      { userId: author.id },
      {
        nodeSlug: "ai",
        title: "回复编辑会话并发幂等验证主题",
        body: "这是用于验证回复草稿版本、重复发布和迟到保存处理的一段完整主题正文。",
        action: "publish",
      },
    );
    const editorSessionKey = randomUUID();
    await saveReplyDraft({ userId: replier.id }, topic.number, {
      body: "第一版回复草稿会被更高版本覆盖。",
      editorSessionKey,
      editorSessionRevision: 1,
    });
    const latestBody = "第三版回复草稿是发布时必须保留的最新正文。";
    await saveReplyDraft({ userId: replier.id }, topic.number, {
      body: latestBody,
      editorSessionKey,
      editorSessionRevision: 3,
    });
    await expect(
      saveReplyDraft({ userId: replier.id }, topic.number, {
        body: "第二版迟到后不能覆盖第三版。",
        editorSessionKey,
        editorSessionRevision: 2,
      }),
    ).rejects.toMatchObject({ code: "editor_session_conflict" });
    await expect(
      prisma.communityPostDraft.findUniqueOrThrow({
        where: { topicId_authorId: { topicId: topic.id, authorId: replier.id } },
      }),
    ).resolves.toMatchObject({ bodySource: latestBody, editorSessionRevision: 3 });
    await expect(getTopicPageView(topic.number, replier.id)).resolves.toMatchObject({
      replyDraft: {
        body: latestBody,
        editorSessionKey,
        editorSessionRevision: 3,
      },
    });

    const replies = await Promise.all(
      Array.from({ length: 6 }, () =>
        createReply({ userId: replier.id }, topic.number, {
          body: latestBody,
          editorSessionKey,
          editorSessionRevision: 4,
        }),
      ),
    );
    expect(new Set(replies.map((reply) => reply.id)).size).toBe(1);
    expect(new Set(replies.map((reply) => reply.position))).toEqual(new Set([2]));
    await expect(
      prisma.communityPost.count({ where: { authorId: replier.id, editorSessionKey } }),
    ).resolves.toBe(1);
    await expect(
      prisma.communityPostDraft.count({ where: { topicId: topic.id, authorId: replier.id } }),
    ).resolves.toBe(0);

    await prisma.$transaction([
      prisma.communityTopic.update({
        where: { id: topic.id },
        data: { status: "closed", closedAt: new Date() },
      }),
      prisma.user.update({ where: { id: replier.id }, data: { status: "suspended" } }),
    ]);
    await expect(
      createReply({ userId: replier.id }, topic.number, {
        body: latestBody,
        editorSessionKey,
        editorSessionRevision: 5,
      }),
    ).resolves.toMatchObject({ id: replies[0]!.id, position: 2 });

    await expect(
      saveReplyDraft({ userId: replier.id }, topic.number, {
        body: "发布后迟到的自动保存不能重新创建草稿。",
        editorSessionKey,
        editorSessionRevision: 6,
      }),
    ).resolves.toBeNull();
    await expect(
      prisma.communityPostDraft.count({ where: { topicId: topic.id, authorId: replier.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.communityReplyEditorSession.findUniqueOrThrow({
        where: { authorId_key: { authorId: replier.id, key: editorSessionKey } },
      }),
    ).resolves.toMatchObject({ state: "published", postId: replies[0]!.id, revision: 4 });
  });

  it("keeps cleared and superseded reply sessions from reviving stale drafts", async () => {
    const prisma = getPrismaClient();
    const [author, replier] = await Promise.all([
      createActor("Reply Clear Topic Author"),
      createActor("Reply Clear Replier"),
    ]);
    const topic = await createTopic(
      { userId: author.id },
      {
        nodeSlug: "ai",
        title: "回复草稿清空和会话替换验证主题",
        body: "这是一段用于验证清空草稿后迟到请求不会复活内容的完整主题正文。",
        action: "publish",
      },
    );
    const firstKey = randomUUID();
    await saveReplyDraft({ userId: replier.id }, topic.number, {
      body: "这份草稿随后会被明确清空。",
      editorSessionKey: firstKey,
      editorSessionRevision: 1,
    });
    const conflictingKey = randomUUID();
    await expect(
      saveReplyDraft({ userId: replier.id }, topic.number, {
        body: "另一编辑会话不能覆盖仍有正文的草稿。",
        editorSessionKey: conflictingKey,
        editorSessionRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "editor_session_conflict" });
    await saveReplyDraft({ userId: replier.id }, topic.number, {
      body: "",
      editorSessionKey: firstKey,
      editorSessionRevision: 2,
    });
    await expect(
      prisma.communityPostDraft.count({ where: { topicId: topic.id, authorId: replier.id } }),
    ).resolves.toBe(0);
    await expect(
      saveReplyDraft({ userId: replier.id }, topic.number, {
        body: "迟到的第一版不能在清空后重新出现。",
        editorSessionKey: firstKey,
        editorSessionRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "editor_session_conflict" });

    const secondKey = randomUUID();
    await saveReplyDraft({ userId: replier.id }, topic.number, {
      body: "清空后可以由新的编辑会话开始一份新草稿。",
      editorSessionKey: secondKey,
      editorSessionRevision: 1,
    });
    await expect(
      prisma.communityReplyEditorSession.findUniqueOrThrow({
        where: { authorId_key: { authorId: replier.id, key: firstKey } },
      }),
    ).resolves.toMatchObject({ state: "superseded", revision: 2 });
    await expect(findReplyEditorSessionTarget(replier.id, topic.number, firstKey)).resolves.toEqual(
      {
        kind: "superseded",
        editorSessionRevision: 2,
      },
    );
    await expect(
      saveReplyDraft({ userId: replier.id }, topic.number, {
        body: "被替换的旧会话即使版本号更大也不能复活。",
        editorSessionKey: firstKey,
        editorSessionRevision: 3,
      }),
    ).rejects.toMatchObject({ code: "editor_session_conflict" });
    const published = await createReply({ userId: replier.id }, topic.number, {
      body: "清空后可以由新的编辑会话发布一条新回复。",
      editorSessionKey: secondKey,
      editorSessionRevision: 2,
    });
    await expect(
      saveReplyDraft({ userId: replier.id }, topic.number, {
        body: "发布后的迟到保存不能重新创建草稿。",
        editorSessionKey: secondKey,
        editorSessionRevision: 3,
      }),
    ).resolves.toBeNull();
    await expect(
      prisma.communityReplyEditorSession.findUniqueOrThrow({
        where: { authorId_key: { authorId: replier.id, key: secondKey } },
      }),
    ).resolves.toMatchObject({ state: "published", postId: published.id, revision: 2 });
  });

  it("rejects conflicting active and cleared payloads at the same reply revision", async () => {
    const prisma = getPrismaClient();
    const [author, activeFirstReplier, clearedFirstReplier] = await Promise.all([
      createActor("Same Revision Topic Author"),
      createActor("Same Revision Active First"),
      createActor("Same Revision Cleared First"),
    ]);
    const topic = await createTopic(
      { userId: author.id },
      {
        nodeSlug: "ai",
        title: "同一回复编辑版本冲突验证主题",
        body: "这是一段用于验证同一版本不同快照无论到达顺序如何都不能互相覆盖的完整正文。",
        action: "publish",
      },
    );

    const activeFirstKey = randomUUID();
    const activeBody = "同一版本先到达的有效正文必须保留，清空请求不能覆盖它。";
    await saveReplyDraft({ userId: activeFirstReplier.id }, topic.number, {
      body: activeBody,
      editorSessionKey: activeFirstKey,
      editorSessionRevision: 1,
    });
    await expect(
      saveReplyDraft({ userId: activeFirstReplier.id }, topic.number, {
        body: "",
        editorSessionKey: activeFirstKey,
        editorSessionRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "editor_session_conflict" });
    await expect(
      prisma.communityPostDraft.findUniqueOrThrow({
        where: { topicId_authorId: { topicId: topic.id, authorId: activeFirstReplier.id } },
      }),
    ).resolves.toMatchObject({ bodySource: activeBody, editorSessionRevision: 1 });
    await expect(
      prisma.communityReplyEditorSession.findUniqueOrThrow({
        where: { authorId_key: { authorId: activeFirstReplier.id, key: activeFirstKey } },
      }),
    ).resolves.toMatchObject({ state: "active", revision: 1 });

    const clearedFirstKey = randomUUID();
    await saveReplyDraft({ userId: clearedFirstReplier.id }, topic.number, {
      body: "",
      editorSessionKey: clearedFirstKey,
      editorSessionRevision: 1,
    });
    await expect(
      saveReplyDraft({ userId: clearedFirstReplier.id }, topic.number, {
        body: "同一版本先到达清空状态后，迟到的正文不能复活草稿。",
        editorSessionKey: clearedFirstKey,
        editorSessionRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "editor_session_conflict" });
    await expect(
      prisma.communityPostDraft.count({
        where: { topicId: topic.id, authorId: clearedFirstReplier.id },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.communityReplyEditorSession.findUniqueOrThrow({
        where: { authorId_key: { authorId: clearedFirstReplier.id, key: clearedFirstKey } },
      }),
    ).resolves.toMatchObject({ state: "cleared", revision: 1 });
  });

  it("prunes only reply editor tombstones older than thirty days", async () => {
    const prisma = getPrismaClient();
    const [author, replier] = await Promise.all([
      createActor("Prune Topic Author"),
      createActor("Prune Replier"),
    ]);
    const topic = await createTopic(
      { userId: author.id },
      {
        nodeSlug: "ai",
        title: "回复编辑会话终态保留与清理验证主题",
        body: "这是一段用于验证 Worker 只清理过期清空和已替换终态的完整主题正文。",
        action: "publish",
      },
    );
    const publishedKey = randomUUID();
    await createReply({ userId: replier.id }, topic.number, {
      body: "这条已发布回复即使会话很旧也不能被维护函数删除。",
      editorSessionKey: publishedKey,
      editorSessionRevision: 1,
    });
    const activeKey = randomUUID();
    await saveReplyDraft({ userId: replier.id }, topic.number, {
      body: "这份活动草稿即使会话很旧也不能被维护函数删除。",
      editorSessionKey: activeKey,
      editorSessionRevision: 1,
    });

    const now = new Date("2026-07-20T12:00:00.000Z");
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1_000;
    const expiredAt = new Date(now.getTime() - thirtyDaysMs - 1);
    const retentionBoundary = new Date(now.getTime() - thirtyDaysMs);
    const expiredClearedKey = randomUUID();
    const expiredSupersededKey = randomUUID();
    const retainedClearedKey = randomUUID();
    const retainedSupersededKey = randomUUID();
    await prisma.communityReplyEditorSession.createMany({
      data: [
        {
          topicId: topic.id,
          authorId: replier.id,
          key: expiredClearedKey,
          revision: 1,
          state: "cleared",
          createdAt: expiredAt,
          updatedAt: expiredAt,
        },
        {
          topicId: topic.id,
          authorId: replier.id,
          key: expiredSupersededKey,
          revision: 1,
          state: "superseded",
          createdAt: expiredAt,
          updatedAt: expiredAt,
        },
        {
          topicId: topic.id,
          authorId: replier.id,
          key: retainedClearedKey,
          revision: 1,
          state: "cleared",
          createdAt: retentionBoundary,
          updatedAt: retentionBoundary,
        },
        {
          topicId: topic.id,
          authorId: replier.id,
          key: retainedSupersededKey,
          revision: 1,
          state: "superseded",
          createdAt: retentionBoundary,
          updatedAt: retentionBoundary,
        },
      ],
    });
    await prisma.communityReplyEditorSession.updateMany({
      where: { authorId: replier.id, key: { in: [activeKey, publishedKey] } },
      data: { updatedAt: expiredAt },
    });

    await expect(pruneReplyEditorSessionTombstones(now)).resolves.toBe(2);
    const retained = await prisma.communityReplyEditorSession.findMany({
      where: { authorId: replier.id },
      select: { key: true, state: true },
    });
    expect(retained).toHaveLength(4);
    expect(retained).toEqual(
      expect.arrayContaining([
        { key: activeKey, state: "active" },
        { key: publishedKey, state: "published" },
        { key: retainedClearedKey, state: "cleared" },
        { key: retainedSupersededKey, state: "superseded" },
      ]),
    );
    expect(retained.some(({ key }) => key === expiredClearedKey)).toBe(false);
    expect(retained.some(({ key }) => key === expiredSupersededKey)).toBe(false);
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
