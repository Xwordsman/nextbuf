import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import {
  requireActiveCommunityActor,
  requireCommunityContentActor,
} from "@/modules/community/authorization.server";
import { syncPostContentReferences } from "@/modules/community/content-references.server";
import { CommunityError } from "@/modules/community/errors";
import { queueManagementNotificationIntent } from "@/modules/notifications/events.server";
import { MAX_ACTIVE_TOPIC_DRAFTS, validateTopicInput } from "@/modules/community/topic-policy";
import {
  isPrivateTopicDraftLineage,
  restoredTopicStatus,
} from "@/modules/community/topic-visibility";
import { MAX_EDITOR_SESSION_REVISION } from "@/shared/community/editor-session";
import { getSiteSettings } from "@/modules/settings/settings.server";

type TopicWriteContext = { userId: string; requestId?: string };

type TopicContentInput = {
  nodeSlug: string;
  title: string;
  body: string;
};

type EditorSessionInput = {
  editorSessionKey?: string;
  editorSessionRevision?: number;
};

type TopicContentWriteInput = TopicContentInput &
  EditorSessionInput & {
    action: "autosave" | "save" | "publish";
  };

type TopicModerationInput = {
  isPinned: boolean;
  isEssence: boolean;
  isClosed: boolean;
  isHidden: boolean;
};

function auditMetadata(value: Record<string, unknown>): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, Prisma.InputJsonValue] => {
      const item = entry[1];
      return item !== undefined;
    }),
  );
}

async function lockUser(transaction: Prisma.TransactionClient, userId: string) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "users" WHERE "id" = CAST(${userId} AS uuid) FOR UPDATE`,
  );
}

async function lockTopic(transaction: Prisma.TransactionClient, number: number) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "community_topics" WHERE "number" = ${number} FOR UPDATE`,
  );
}

async function requirePublishAllowance(
  transaction: Prisma.TransactionClient,
  userId: string,
  now: Date,
) {
  const settings = await getSiteSettings(transaction);
  if (!settings.topicsEnabled) {
    throw new CommunityError("topic_posting_disabled", 409);
  }
  const published = await transaction.communityTopic.count({
    where: {
      authorId: userId,
      publishedAt: { gte: new Date(now.getTime() - 3_600_000) },
    },
  });
  if (published >= settings.maxTopicsPerHour) {
    throw new CommunityError("topic_rate_limited", 429, {
      retryAfter: 3600,
      limit: settings.maxTopicsPerHour,
    });
  }
}

async function resolveWritableNode(transaction: Prisma.TransactionClient, slug: string) {
  const node = await transaction.communityNode.findUnique({ where: { slug } });
  if (!node || node.visibility !== "public" || node.archivedAt) {
    throw new CommunityError("node_unavailable", 409);
  }
  return node;
}

function parseEditorSession(input: EditorSessionInput) {
  const key = input.editorSessionKey;
  const revision = input.editorSessionRevision;
  const hasKey = key !== undefined;
  const hasRevision = revision !== undefined;
  if (!hasKey && !hasRevision) return null;
  if (
    typeof key !== "string" ||
    !key ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    revision > MAX_EDITOR_SESSION_REVISION
  ) {
    throw new CommunityError("invalid_topic", 400);
  }
  return { key, revision };
}

async function updateTopicContentInTransaction(
  transaction: Prisma.TransactionClient,
  context: TopicWriteContext,
  number: number,
  input: TopicContentWriteInput,
) {
  await lockTopic(transaction, number);
  const topic = await transaction.communityTopic.findUnique({
    where: { number },
    include: {
      node: { select: { slug: true } },
      posts: { where: { position: 1 }, take: 1 },
    },
  });
  if (!topic || topic.posts.length !== 1) throw new CommunityError("topic_not_found", 404);
  if (isPrivateTopicDraftLineage(topic) && topic.authorId !== context.userId) {
    throw new CommunityError("topic_not_found", 404);
  }
  const editorSession = parseEditorSession(input);
  if (
    input.action === "publish" &&
    topic.authorId === context.userId &&
    topic.editorSessionKey &&
    editorSession?.key === topic.editorSessionKey &&
    topic.status !== "draft"
  ) {
    return topic;
  }
  if (topic.status === "deleted") throw new CommunityError("invalid_topic_state", 409);
  const permissions = await requireActiveCommunityActor(transaction, context.userId, topic.nodeId);
  if (topic.authorId !== context.userId && !permissions.canModerate) {
    throw new CommunityError("forbidden", 403);
  }
  const authorSessionWrite =
    topic.authorId === context.userId && Boolean(topic.editorSessionKey || editorSession);
  if (authorSessionWrite) {
    if (!editorSession) throw new CommunityError("invalid_topic", 400);
    if (topic.editorSessionKey && topic.editorSessionKey !== editorSession.key) {
      throw new CommunityError("editor_session_conflict", 409);
    }
    if (input.action === "autosave" && topic.status !== "draft") return topic;
    if (input.action === "publish" && topic.status !== "draft") return topic;
    const currentRevision = topic.editorSessionRevision ?? 0;
    if (editorSession.revision < currentRevision) {
      throw new CommunityError("editor_session_conflict", 409);
    }
    if (editorSession.revision === currentRevision) {
      const mode = topic.status === "draft" ? "draft" : "publish";
      const content = validateTopicInput(input.title, input.body, mode);
      const post = topic.posts[0];
      const sameSnapshot =
        input.action !== "publish" &&
        topic.node.slug === input.nodeSlug &&
        topic.title === content.title &&
        post?.bodySource === content.body;
      if (sameSnapshot) return topic;
      throw new CommunityError("editor_session_conflict", 409);
    }
  }
  if (input.action === "autosave") {
    if (topic.authorId !== context.userId) throw new CommunityError("forbidden", 403);
    if (topic.status !== "draft") return topic;
  }

  const publishing = input.action === "publish" && topic.status === "draft";
  const mode = topic.status === "draft" && !publishing ? "draft" : "publish";
  const content = validateTopicInput(input.title, input.body, mode);
  const node = await resolveWritableNode(transaction, input.nodeSlug);
  const post = topic.posts[0];
  if (!post) throw new CommunityError("topic_not_found", 404);
  const now = new Date();
  if (publishing) {
    await requireCommunityContentActor(transaction, context.userId, node.id);
    await requirePublishAllowance(transaction, context.userId, now);
  }

  const contentChanged = topic.title !== content.title || post.bodySource !== content.body;
  const nodeChanged = topic.nodeId !== node.id;
  if (
    nodeChanged &&
    topic.authorId !== context.userId &&
    !permissions.isAdmin &&
    !permissions.isGlobalModerator
  ) {
    throw new CommunityError("forbidden", 403);
  }
  if (contentChanged) {
    const nextVersion = post.revisionCount + 1;
    const revision = await transaction.communityPostRevision.create({
      data: {
        postId: post.id,
        editorId: context.userId,
        version: nextVersion,
        title: content.title,
        bodySource: content.body,
        source: publishing ? "publish" : "edit",
      },
    });
    await syncPostContentReferences(transaction, {
      actorId: context.userId,
      postId: post.id,
      revisionId: revision.id,
      body: content.body,
    });
    await transaction.communityPost.update({
      where: { id: post.id },
      data: {
        bodySource: content.body,
        status: publishing ? "published" : post.status,
        revisionCount: nextVersion,
        editedAt: now,
      },
    });
  } else if (publishing) {
    await transaction.communityPost.update({
      where: { id: post.id },
      data: { status: "published" },
    });
  }

  const updated = await transaction.communityTopic.update({
    where: { id: topic.id },
    data: {
      nodeId: node.id,
      title: content.title,
      status: publishing ? "published" : topic.status,
      publishedAt: publishing ? now : topic.publishedAt,
      editedAt: contentChanged ? now : topic.editedAt,
      ...(authorSessionWrite && editorSession
        ? {
            editorSessionKey: topic.editorSessionKey ?? editorSession.key,
            editorSessionRevision: editorSession.revision,
          }
        : {}),
    },
  });
  if (contentChanged || nodeChanged || publishing) {
    await transaction.communityAuditEvent.create({
      data: {
        actorId: context.userId,
        action: publishing ? "topic.published" : "topic.updated",
        topicId: topic.id,
        nodeId: node.id,
        requestId: context.requestId,
        metadata: auditMetadata({
          number,
          contentChanged,
          nodeChanged,
          previousNodeId: topic.nodeId,
        }),
      },
    });
  }
  return updated;
}

export async function createTopic(
  context: TopicWriteContext,
  input: TopicContentInput & EditorSessionInput & { action: "draft" | "publish" },
) {
  const content = validateTopicInput(input.title, input.body, input.action);
  const editorSession = parseEditorSession(input);
  const prisma = getPrismaClient();

  return prisma.$transaction(async (transaction) => {
    await lockUser(transaction, context.userId);
    if (editorSession) {
      const existing = await transaction.communityTopic.findUnique({
        where: {
          authorId_editorSessionKey: {
            authorId: context.userId,
            editorSessionKey: editorSession.key,
          },
        },
        include: {
          node: { select: { slug: true } },
          posts: { where: { position: 1 }, take: 1, select: { bodySource: true } },
        },
      });
      if (existing) {
        if (existing.status !== "draft") return existing;
        const currentRevision = existing.editorSessionRevision ?? 0;
        if (editorSession.revision < currentRevision) {
          throw new CommunityError("editor_session_conflict", 409);
        }
        if (editorSession.revision === currentRevision) {
          const post = existing.posts[0];
          const sameSnapshot =
            input.action === "draft" &&
            existing.node.slug === input.nodeSlug &&
            existing.title === content.title &&
            post?.bodySource === content.body;
          if (sameSnapshot) return existing;
          throw new CommunityError("editor_session_conflict", 409);
        }
        return updateTopicContentInTransaction(transaction, context, existing.number, {
          nodeSlug: input.nodeSlug,
          title: input.title,
          body: input.body,
          action: input.action === "publish" ? "publish" : "autosave",
          editorSessionKey: editorSession.key,
          editorSessionRevision: editorSession.revision,
        });
      }
    }
    const node = await resolveWritableNode(transaction, input.nodeSlug);
    await requireCommunityContentActor(transaction, context.userId, node.id);
    const now = new Date();

    if (input.action === "publish") {
      await requirePublishAllowance(transaction, context.userId, now);
    } else {
      const drafts = await transaction.communityTopic.count({
        where: { authorId: context.userId, status: "draft" },
      });
      if (drafts >= MAX_ACTIVE_TOPIC_DRAFTS) {
        throw new CommunityError("draft_limit_reached", 409);
      }
    }

    const topicStatus = input.action === "publish" ? "published" : "draft";
    const topic = await transaction.communityTopic.create({
      data: {
        nodeId: node.id,
        authorId: context.userId,
        editorSessionKey: editorSession?.key,
        editorSessionRevision: editorSession?.revision,
        title: content.title,
        status: topicStatus,
        publishedAt: input.action === "publish" ? now : null,
        lastActivityAt: now,
      },
    });
    const post = await transaction.communityPost.create({
      data: {
        topicId: topic.id,
        authorId: context.userId,
        position: 1,
        status: topicStatus,
        bodySource: content.body,
      },
    });
    const revision = await transaction.communityPostRevision.create({
      data: {
        postId: post.id,
        editorId: context.userId,
        version: 1,
        title: content.title,
        bodySource: content.body,
        source: "create",
      },
    });
    await syncPostContentReferences(transaction, {
      actorId: context.userId,
      postId: post.id,
      revisionId: revision.id,
      body: content.body,
    });
    await transaction.communityAuditEvent.create({
      data: {
        actorId: context.userId,
        action: input.action === "publish" ? "topic.published" : "topic.draft.created",
        topicId: topic.id,
        nodeId: node.id,
        requestId: context.requestId,
        metadata: auditMetadata({ number: topic.number, linkCount: content.linkCount }),
      },
    });
    return topic;
  });
}

export async function updateTopicContent(
  context: TopicWriteContext,
  number: number,
  input: TopicContentInput & EditorSessionInput & { action: "autosave" | "save" | "publish" },
) {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (transaction) => {
    await lockUser(transaction, context.userId);
    return updateTopicContentInTransaction(transaction, context, number, input);
  });
}

export async function deleteTopic(context: TopicWriteContext, number: number) {
  return getPrismaClient().$transaction(async (transaction) => {
    await lockTopic(transaction, number);
    const topic = await transaction.communityTopic.findUnique({ where: { number } });
    if (!topic) throw new CommunityError("topic_not_found", 404);
    if (isPrivateTopicDraftLineage(topic) && topic.authorId !== context.userId) {
      throw new CommunityError("topic_not_found", 404);
    }
    const permissions = await requireActiveCommunityActor(
      transaction,
      context.userId,
      topic.nodeId,
    );
    if (topic.authorId !== context.userId && !permissions.canModerate) {
      throw new CommunityError("forbidden", 403);
    }
    if (topic.status === "deleted") return topic;
    const now = new Date();
    await transaction.communityPost.updateMany({
      where: { topicId: topic.id, position: 1 },
      data: { status: "deleted", deletedAt: now },
    });
    const deleted = await transaction.communityTopic.update({
      where: { id: topic.id },
      data: { status: "deleted", deletedFromStatus: topic.status, deletedAt: now },
    });
    await transaction.communityAuditEvent.create({
      data: {
        actorId: context.userId,
        action: "topic.deleted",
        topicId: topic.id,
        nodeId: topic.nodeId,
        requestId: context.requestId,
        metadata: auditMetadata({ number, previousStatus: topic.status }),
      },
    });
    return deleted;
  });
}

export async function restoreTopic(context: TopicWriteContext, number: number) {
  return getPrismaClient().$transaction(async (transaction) => {
    await lockTopic(transaction, number);
    const topic = await transaction.communityTopic.findUnique({
      where: { number },
      include: { node: true },
    });
    if (!topic) throw new CommunityError("topic_not_found", 404);
    if (isPrivateTopicDraftLineage(topic) && topic.authorId !== context.userId) {
      throw new CommunityError("topic_not_found", 404);
    }
    if (topic.status !== "deleted") throw new CommunityError("invalid_topic_state", 409);
    const permissions = await requireActiveCommunityActor(
      transaction,
      context.userId,
      topic.nodeId,
    );
    if (topic.authorId !== context.userId && !permissions.canModerate) {
      throw new CommunityError("forbidden", 403);
    }
    const restoredStatus = restoredTopicStatus(topic.deletedFromStatus);
    if (
      restoredStatus !== "draft" &&
      (topic.node.visibility !== "public" || topic.node.archivedAt)
    ) {
      throw new CommunityError("node_unavailable", 409);
    }
    const postStatus =
      restoredStatus === "draft" ? "draft" : restoredStatus === "hidden" ? "hidden" : "published";
    await transaction.communityPost.updateMany({
      where: { topicId: topic.id, position: 1 },
      data: { status: postStatus, deletedAt: null },
    });
    const restored = await transaction.communityTopic.update({
      where: { id: topic.id },
      data: { status: restoredStatus, deletedFromStatus: null, deletedAt: null },
    });
    await transaction.communityAuditEvent.create({
      data: {
        actorId: context.userId,
        action: "topic.restored",
        topicId: topic.id,
        nodeId: topic.nodeId,
        requestId: context.requestId,
        metadata: auditMetadata({ number, restoredStatus }),
      },
    });
    return restored;
  });
}

export async function moderateTopic(
  context: TopicWriteContext,
  number: number,
  input: TopicModerationInput,
) {
  return getPrismaClient().$transaction(async (transaction) => {
    await lockTopic(transaction, number);
    const topic = await transaction.communityTopic.findUnique({ where: { number } });
    if (!topic) throw new CommunityError("topic_not_found", 404);
    if (isPrivateTopicDraftLineage(topic) && topic.authorId !== context.userId) {
      throw new CommunityError("topic_not_found", 404);
    }
    if (["draft", "deleted"].includes(topic.status)) {
      throw new CommunityError("invalid_topic_state", 409);
    }
    const permissions = await requireActiveCommunityActor(
      transaction,
      context.userId,
      topic.nodeId,
    );
    if (!permissions.canModerate) throw new CommunityError("forbidden", 403);

    const now = new Date();
    const nextStatus = input.isHidden ? "hidden" : input.isClosed ? "closed" : "published";
    await transaction.communityPost.updateMany({
      where: { topicId: topic.id, position: 1 },
      data: { status: nextStatus === "hidden" ? "hidden" : "published" },
    });
    const updated = await transaction.communityTopic.update({
      where: { id: topic.id },
      data: {
        status: nextStatus,
        isPinned: input.isPinned,
        isEssence: input.isEssence,
        closedAt: input.isClosed ? (topic.closedAt ?? now) : null,
      },
    });
    const audit = await transaction.communityAuditEvent.create({
      data: {
        actorId: context.userId,
        action: "topic.moderated",
        topicId: topic.id,
        nodeId: topic.nodeId,
        requestId: context.requestId,
        metadata: auditMetadata({
          number,
          previousStatus: topic.status,
          nextStatus,
          isPinned: input.isPinned,
          isEssence: input.isEssence,
        }),
      },
    });
    await queueManagementNotificationIntent(transaction, {
      auditEventId: audit.id,
      topicId: topic.id,
      action: "topic.moderated",
    });
    return updated;
  });
}
