import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import {
  requireActiveCommunityActor,
  requireCommunityContentActor,
} from "@/modules/community/authorization.server";
import {
  deletePostDraftWithReferences,
  syncDraftAttachmentReferences,
  syncPostContentReferences,
} from "@/modules/community/content-references.server";
import { validateReplyBody, validateReplyDraft } from "@/modules/community/content-policy";
import { CommunityError } from "@/modules/community/errors";
import { queueReplyNotificationIntent } from "@/modules/notifications/events.server";
import { getSiteSettings } from "@/modules/settings/settings.server";
import {
  MAX_EDITOR_SESSION_REVISION,
  MAX_REPLY_EDITOR_SESSIONS_PER_HOUR,
} from "@/shared/community/editor-session";

type ReplyWriteContext = { userId: string; requestId?: string };
type ReplyInput = {
  body: string;
  quotedPosition?: number | null;
  editorSessionKey?: string;
  editorSessionRevision?: number;
};

function auditMetadata(value: Record<string, unknown>): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, Prisma.InputJsonValue] => {
      return entry[1] !== undefined;
    }),
  );
}

function parseEditorSession(input: ReplyInput) {
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
    throw new CommunityError("invalid_post", 400);
  }
  return { key, revision };
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

async function resolveQuotedPost(
  transaction: Prisma.TransactionClient,
  topicId: string,
  position?: number | null,
  existingQuotedPostId?: string | null,
) {
  if (!position) return null;
  const post = await transaction.communityPost.findFirst({
    where: { topicId, position },
    select: { id: true, position: true, status: true },
  });
  if (!post || (post.status !== "published" && post.id !== existingQuotedPostId)) {
    throw new CommunityError("post_not_found", 404);
  }
  return post;
}

async function requireReplyableTopic(
  transaction: Prisma.TransactionClient,
  topic: { id: string; nodeId: string; status: string },
  userId: string,
) {
  if (!["published", "closed"].includes(topic.status)) {
    throw new CommunityError("topic_not_found", 404);
  }
  const permissions = await requireCommunityContentActor(transaction, userId, topic.nodeId);
  if (topic.status === "closed" && !permissions.canModerate) {
    throw new CommunityError("topic_closed", 409);
  }
  return { topic, permissions };
}

async function latestReplyActivity(
  transaction: Prisma.TransactionClient,
  topicId: string,
  fallback: Date,
) {
  const latest = await transaction.communityPost.findFirst({
    where: { topicId, position: { gt: 1 }, status: "published" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return latest?.createdAt ?? fallback;
}

async function requireReplyEditorSessionAllowance(
  transaction: Prisma.TransactionClient,
  userId: string,
  now: Date,
) {
  const recentSessions = await transaction.communityReplyEditorSession.count({
    where: {
      authorId: userId,
      createdAt: { gte: new Date(now.getTime() - 3_600_000) },
    },
  });
  if (recentSessions >= MAX_REPLY_EDITOR_SESSIONS_PER_HOUR) {
    throw new CommunityError("editor_session_rate_limited", 429, {
      retryAfter: 3600,
      limit: MAX_REPLY_EDITOR_SESSIONS_PER_HOUR,
    });
  }
}

export async function createReply(context: ReplyWriteContext, number: number, input: ReplyInput) {
  const body = validateReplyBody(input.body);
  const editorSession = parseEditorSession(input);
  return getPrismaClient().$transaction(async (transaction) => {
    await lockUser(transaction, context.userId);
    await lockTopic(transaction, number);
    const topic = await transaction.communityTopic.findUnique({ where: { number } });
    if (!topic) throw new CommunityError("topic_not_found", 404);
    const persistedSession = editorSession
      ? await transaction.communityReplyEditorSession.findUnique({
          where: {
            authorId_key: {
              authorId: context.userId,
              key: editorSession.key,
            },
          },
          include: { post: true },
        })
      : null;
    if (persistedSession) {
      if (persistedSession.topicId !== topic.id) {
        throw new CommunityError("editor_session_conflict", 409);
      }
      if (persistedSession.state === "published") {
        if (!persistedSession.post || persistedSession.post.position === 1) {
          throw new CommunityError("editor_session_conflict", 409);
        }
        return persistedSession.post;
      }
      if (persistedSession.state === "superseded") {
        throw new CommunityError("editor_session_conflict", 409);
      }
    }
    if (editorSession && !persistedSession) {
      const existingPost = await transaction.communityPost.findUnique({
        where: {
          authorId_editorSessionKey: {
            authorId: context.userId,
            editorSessionKey: editorSession.key,
          },
        },
      });
      if (existingPost) {
        if (existingPost.topicId !== topic.id || existingPost.position === 1) {
          throw new CommunityError("editor_session_conflict", 409);
        }
        await transaction.communityReplyEditorSession.create({
          data: {
            topicId: topic.id,
            authorId: context.userId,
            key: editorSession.key,
            revision: existingPost.editorSessionRevision ?? editorSession.revision,
            state: "published",
            postId: existingPost.id,
          },
        });
        return existingPost;
      }
      await requireReplyEditorSessionAllowance(transaction, context.userId, new Date());
    }
    await requireReplyableTopic(transaction, topic, context.userId);
    const settings = await getSiteSettings(transaction);
    if (!settings.repliesEnabled) throw new CommunityError("reply_posting_disabled", 409);
    const recentReplies = await transaction.communityPost.count({
      where: {
        authorId: context.userId,
        position: { gt: 1 },
        createdAt: { gte: new Date(Date.now() - 3_600_000) },
      },
    });
    if (recentReplies >= settings.maxRepliesPerHour) {
      throw new CommunityError("reply_rate_limited", 429, {
        retryAfter: 3600,
        limit: settings.maxRepliesPerHour,
      });
    }
    const draft = await transaction.communityPostDraft.findUnique({
      where: { topicId_authorId: { topicId: topic.id, authorId: context.userId } },
      select: {
        id: true,
        bodySource: true,
        quotedPostId: true,
        editorSessionKey: true,
        editorSessionRevision: true,
      },
    });
    const quotedPost = await resolveQuotedPost(
      transaction,
      topic.id,
      input.quotedPosition,
      draft?.quotedPostId,
    );
    if (!editorSession && draft?.editorSessionKey) {
      throw new CommunityError("editor_session_conflict", 409);
    }
    if (
      editorSession &&
      draft?.editorSessionKey &&
      draft.editorSessionKey !== editorSession.key &&
      draft.bodySource.length > 0
    ) {
      throw new CommunityError("editor_session_conflict", 409);
    }
    if (editorSession) {
      const currentRevision = Math.max(
        persistedSession?.revision ?? 0,
        draft?.editorSessionKey === editorSession.key ? (draft.editorSessionRevision ?? 0) : 0,
      );
      if (editorSession.revision <= currentRevision) {
        throw new CommunityError("editor_session_conflict", 409);
      }
      await transaction.communityReplyEditorSession.updateMany({
        where: {
          topicId: topic.id,
          authorId: context.userId,
          key: { not: editorSession.key },
          state: { in: ["active", "cleared"] },
        },
        data: { state: "superseded" },
      });
    }
    const now = new Date();
    const position = topic.nextPostPosition;
    const post = await transaction.communityPost.create({
      data: {
        topicId: topic.id,
        authorId: context.userId,
        editorSessionKey: editorSession?.key,
        editorSessionRevision: editorSession?.revision,
        position,
        status: "published",
        bodySource: body,
        quotedPostId: quotedPost?.id,
      },
    });
    const revision = await transaction.communityPostRevision.create({
      data: {
        postId: post.id,
        editorId: context.userId,
        version: 1,
        title: null,
        bodySource: body,
        source: "create",
      },
    });
    await syncPostContentReferences(transaction, {
      actorId: context.userId,
      postId: post.id,
      revisionId: revision.id,
      body,
    });
    if (draft) await deletePostDraftWithReferences(transaction, draft.id);
    if (editorSession) {
      await transaction.communityReplyEditorSession.upsert({
        where: {
          authorId_key: {
            authorId: context.userId,
            key: editorSession.key,
          },
        },
        create: {
          topicId: topic.id,
          authorId: context.userId,
          key: editorSession.key,
          revision: editorSession.revision,
          state: "published",
          postId: post.id,
        },
        update: {
          revision: editorSession.revision,
          state: "published",
          postId: post.id,
        },
      });
    }
    await transaction.communityTopic.update({
      where: { id: topic.id },
      data: {
        nextPostPosition: { increment: 1 },
        replyCount: { increment: 1 },
        lastActivityAt: now,
      },
    });
    await transaction.communityAuditEvent.create({
      data: {
        actorId: context.userId,
        action: "reply.created",
        topicId: topic.id,
        postId: post.id,
        nodeId: topic.nodeId,
        requestId: context.requestId,
        metadata: auditMetadata({ number, position, quotedPosition: quotedPost?.position }),
      },
    });
    await queueReplyNotificationIntent(transaction, post.id);
    return post;
  });
}

export async function saveReplyDraft(
  context: ReplyWriteContext,
  number: number,
  input: ReplyInput,
) {
  const body = validateReplyDraft(input.body);
  const editorSession = parseEditorSession(input);
  return getPrismaClient().$transaction(async (transaction) => {
    await lockUser(transaction, context.userId);
    await lockTopic(transaction, number);
    const topic = await transaction.communityTopic.findUnique({ where: { number } });
    if (!topic) throw new CommunityError("topic_not_found", 404);
    const persistedSession = editorSession
      ? await transaction.communityReplyEditorSession.findUnique({
          where: {
            authorId_key: {
              authorId: context.userId,
              key: editorSession.key,
            },
          },
        })
      : null;
    if (persistedSession) {
      if (persistedSession.topicId !== topic.id || persistedSession.state === "superseded") {
        throw new CommunityError("editor_session_conflict", 409);
      }
      if (persistedSession.state === "published") return null;
    }
    if (editorSession && !persistedSession) {
      const finalized = await transaction.communityPost.findUnique({
        where: {
          authorId_editorSessionKey: {
            authorId: context.userId,
            editorSessionKey: editorSession.key,
          },
        },
        select: { id: true, topicId: true, position: true },
      });
      if (finalized) {
        if (finalized.topicId !== topic.id || finalized.position === 1) {
          throw new CommunityError("editor_session_conflict", 409);
        }
        await transaction.communityReplyEditorSession.create({
          data: {
            topicId: topic.id,
            authorId: context.userId,
            key: editorSession.key,
            revision: editorSession.revision,
            state: "published",
            postId: finalized.id,
          },
        });
        return null;
      }
    }
    const existing = await transaction.communityPostDraft.findUnique({
      where: { topicId_authorId: { topicId: topic.id, authorId: context.userId } },
    });
    if (!editorSession && existing?.editorSessionKey) {
      throw new CommunityError("editor_session_conflict", 409);
    }
    if (
      editorSession &&
      existing?.editorSessionKey &&
      existing.editorSessionKey !== editorSession.key &&
      existing.bodySource.length > 0
    ) {
      throw new CommunityError("editor_session_conflict", 409);
    }
    const clearingOwnedState = !body && Boolean(existing || persistedSession);
    if (!clearingOwnedState) {
      await requireReplyableTopic(transaction, topic, context.userId);
    }
    if (editorSession && !persistedSession && existing?.editorSessionKey !== editorSession.key) {
      await requireReplyEditorSessionAllowance(transaction, context.userId, new Date());
    }
    if (editorSession) {
      const currentRevision = Math.max(
        persistedSession?.revision ?? 0,
        existing?.editorSessionKey === editorSession.key
          ? (existing.editorSessionRevision ?? 0)
          : 0,
      );
      if (editorSession.revision < currentRevision) {
        throw new CommunityError("editor_session_conflict", 409);
      }
      if (editorSession.revision === currentRevision && !body) {
        if (persistedSession?.state === "cleared") return null;
        throw new CommunityError("editor_session_conflict", 409);
      }
    }
    if (!body) {
      if (!editorSession) {
        if (existing) await deletePostDraftWithReferences(transaction, existing.id);
        return null;
      }
      if (existing) await deletePostDraftWithReferences(transaction, existing.id);
      await transaction.communityReplyEditorSession.updateMany({
        where: {
          topicId: topic.id,
          authorId: context.userId,
          key: { not: editorSession.key },
          state: { in: ["active", "cleared"] },
        },
        data: { state: "superseded" },
      });
      await transaction.communityReplyEditorSession.upsert({
        where: {
          authorId_key: {
            authorId: context.userId,
            key: editorSession.key,
          },
        },
        create: {
          topicId: topic.id,
          authorId: context.userId,
          key: editorSession.key,
          revision: editorSession.revision,
          state: "cleared",
        },
        update: {
          revision: editorSession.revision,
          state: "cleared",
          postId: null,
        },
      });
      return null;
    }
    const quotedPost = await resolveQuotedPost(
      transaction,
      topic.id,
      input.quotedPosition,
      existing?.quotedPostId,
    );
    if (
      editorSession &&
      persistedSession &&
      editorSession.revision === persistedSession.revision &&
      (persistedSession.state === "cleared" || !existing)
    ) {
      throw new CommunityError("editor_session_conflict", 409);
    }
    if (
      editorSession &&
      existing?.editorSessionKey === editorSession.key &&
      editorSession.revision === (existing.editorSessionRevision ?? 0)
    ) {
      if (existing.bodySource === body && existing.quotedPostId === (quotedPost?.id ?? null)) {
        return existing;
      }
      throw new CommunityError("editor_session_conflict", 409);
    }
    if (editorSession) {
      await transaction.communityReplyEditorSession.updateMany({
        where: {
          topicId: topic.id,
          authorId: context.userId,
          key: { not: editorSession.key },
          state: { in: ["active", "cleared"] },
        },
        data: { state: "superseded" },
      });
    }
    const draft = await transaction.communityPostDraft.upsert({
      where: { topicId_authorId: { topicId: topic.id, authorId: context.userId } },
      create: {
        topicId: topic.id,
        authorId: context.userId,
        editorSessionKey: editorSession?.key,
        editorSessionRevision: editorSession?.revision,
        bodySource: body,
        quotedPostId: quotedPost?.id,
      },
      update: {
        bodySource: body,
        quotedPostId: quotedPost?.id ?? null,
        ...(editorSession
          ? {
              editorSessionKey: editorSession.key,
              editorSessionRevision: editorSession.revision,
            }
          : {}),
      },
    });
    await syncDraftAttachmentReferences(transaction, {
      actorId: context.userId,
      draftId: draft.id,
      body,
    });
    if (editorSession) {
      await transaction.communityReplyEditorSession.upsert({
        where: {
          authorId_key: {
            authorId: context.userId,
            key: editorSession.key,
          },
        },
        create: {
          topicId: topic.id,
          authorId: context.userId,
          key: editorSession.key,
          revision: editorSession.revision,
          state: "active",
        },
        update: {
          revision: editorSession.revision,
          state: "active",
          postId: null,
        },
      });
    }
    return draft;
  });
}

async function resolveWritableReply(
  transaction: Prisma.TransactionClient,
  context: ReplyWriteContext,
  number: number,
  position: number,
) {
  await lockTopic(transaction, number);
  const topic = await transaction.communityTopic.findUnique({ where: { number } });
  if (!topic || !["published", "closed", "hidden"].includes(topic.status)) {
    throw new CommunityError("topic_not_found", 404);
  }
  const post = await transaction.communityPost.findUnique({
    where: { topicId_position: { topicId: topic.id, position } },
  });
  if (!post || post.position === 1) throw new CommunityError("post_not_found", 404);
  const permissions = await requireActiveCommunityActor(transaction, context.userId, topic.nodeId);
  if (post.authorId !== context.userId && !permissions.canModerate) {
    throw new CommunityError("forbidden", 403);
  }
  if (topic.status === "hidden" && !permissions.canModerate) {
    throw new CommunityError("topic_not_found", 404);
  }
  return { topic, post };
}

export async function updateReply(
  context: ReplyWriteContext,
  number: number,
  position: number,
  input: ReplyInput,
) {
  const body = validateReplyBody(input.body);
  return getPrismaClient().$transaction(async (transaction) => {
    const { topic, post } = await resolveWritableReply(transaction, context, number, position);
    if (post.status === "deleted") throw new CommunityError("invalid_topic_state", 409);
    const quotedPost = await resolveQuotedPost(
      transaction,
      topic.id,
      input.quotedPosition,
      post.quotedPostId,
    );
    if (quotedPost?.id === post.id) throw new CommunityError("invalid_post", 400);
    if (post.bodySource === body && post.quotedPostId === (quotedPost?.id ?? null)) return post;
    const now = new Date();
    const nextVersion = post.revisionCount + 1;
    const revision = await transaction.communityPostRevision.create({
      data: {
        postId: post.id,
        editorId: context.userId,
        version: nextVersion,
        title: null,
        bodySource: body,
        source: "edit",
      },
    });
    const updated = await transaction.communityPost.update({
      where: { id: post.id },
      data: {
        bodySource: body,
        quotedPostId: quotedPost?.id ?? null,
        revisionCount: nextVersion,
        editedAt: now,
      },
    });
    await syncPostContentReferences(transaction, {
      actorId: context.userId,
      postId: post.id,
      revisionId: revision.id,
      body,
    });
    await transaction.communityAuditEvent.create({
      data: {
        actorId: context.userId,
        action: "reply.updated",
        topicId: topic.id,
        postId: post.id,
        nodeId: topic.nodeId,
        requestId: context.requestId,
        metadata: auditMetadata({ number, position, version: nextVersion }),
      },
    });
    return updated;
  });
}

export async function deleteReply(context: ReplyWriteContext, number: number, position: number) {
  return getPrismaClient().$transaction(async (transaction) => {
    const { topic, post } = await resolveWritableReply(transaction, context, number, position);
    if (post.status === "deleted") return post;
    const deleted = await transaction.communityPost.update({
      where: { id: post.id },
      data: { status: "deleted", deletedAt: new Date(), deletedById: context.userId },
    });
    const lastActivityAt = await latestReplyActivity(
      transaction,
      topic.id,
      topic.publishedAt ?? topic.createdAt,
    );
    await transaction.communityTopic.update({
      where: { id: topic.id },
      data: { replyCount: { decrement: 1 }, lastActivityAt },
    });
    await transaction.communityAuditEvent.create({
      data: {
        actorId: context.userId,
        action: "reply.deleted",
        topicId: topic.id,
        postId: post.id,
        nodeId: topic.nodeId,
        requestId: context.requestId,
        metadata: auditMetadata({ number, position }),
      },
    });
    return deleted;
  });
}

export async function restoreReply(context: ReplyWriteContext, number: number, position: number) {
  return getPrismaClient().$transaction(async (transaction) => {
    const { topic, post } = await resolveWritableReply(transaction, context, number, position);
    if (post.status !== "deleted") throw new CommunityError("invalid_topic_state", 409);
    const restored = await transaction.communityPost.update({
      where: { id: post.id },
      data: { status: "published", deletedAt: null, deletedById: null, deletedReason: null },
    });
    const lastActivityAt = await latestReplyActivity(
      transaction,
      topic.id,
      topic.publishedAt ?? topic.createdAt,
    );
    await transaction.communityTopic.update({
      where: { id: topic.id },
      data: { replyCount: { increment: 1 }, lastActivityAt },
    });
    await transaction.communityAuditEvent.create({
      data: {
        actorId: context.userId,
        action: "reply.restored",
        topicId: topic.id,
        postId: post.id,
        nodeId: topic.nodeId,
        requestId: context.requestId,
        metadata: auditMetadata({ number, position }),
      },
    });
    return restored;
  });
}
