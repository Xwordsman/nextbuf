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

type ReplyWriteContext = { userId: string; requestId?: string };
type ReplyInput = { body: string; quotedPosition?: number | null };

function auditMetadata(value: Record<string, unknown>): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, Prisma.InputJsonValue] => {
      return entry[1] !== undefined;
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

async function resolveQuotedPost(
  transaction: Prisma.TransactionClient,
  topicId: string,
  position?: number | null,
) {
  if (!position) return null;
  const post = await transaction.communityPost.findUnique({
    where: { topicId_position: { topicId, position } },
    select: { id: true, position: true },
  });
  if (!post) throw new CommunityError("post_not_found", 404);
  return post;
}

async function requireReplyableTopic(
  transaction: Prisma.TransactionClient,
  number: number,
  userId: string,
) {
  const topic = await transaction.communityTopic.findUnique({ where: { number } });
  if (!topic || !["published", "closed"].includes(topic.status)) {
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

export async function createReply(context: ReplyWriteContext, number: number, input: ReplyInput) {
  const body = validateReplyBody(input.body);
  return getPrismaClient().$transaction(async (transaction) => {
    await lockUser(transaction, context.userId);
    await lockTopic(transaction, number);
    const { topic } = await requireReplyableTopic(transaction, number, context.userId);
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
    const quotedPost = await resolveQuotedPost(transaction, topic.id, input.quotedPosition);
    const now = new Date();
    const position = topic.nextPostPosition;
    const post = await transaction.communityPost.create({
      data: {
        topicId: topic.id,
        authorId: context.userId,
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
    const draft = await transaction.communityPostDraft.findUnique({
      where: { topicId_authorId: { topicId: topic.id, authorId: context.userId } },
      select: { id: true },
    });
    if (draft) await deletePostDraftWithReferences(transaction, draft.id);
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
  return getPrismaClient().$transaction(async (transaction) => {
    await lockTopic(transaction, number);
    const { topic } = await requireReplyableTopic(transaction, number, context.userId);
    const existing = await transaction.communityPostDraft.findUnique({
      where: { topicId_authorId: { topicId: topic.id, authorId: context.userId } },
    });
    if (!body) {
      if (existing) await deletePostDraftWithReferences(transaction, existing.id);
      return null;
    }
    const quotedPost = await resolveQuotedPost(transaction, topic.id, input.quotedPosition);
    const draft = await transaction.communityPostDraft.upsert({
      where: { topicId_authorId: { topicId: topic.id, authorId: context.userId } },
      create: {
        topicId: topic.id,
        authorId: context.userId,
        bodySource: body,
        quotedPostId: quotedPost?.id,
      },
      update: { bodySource: body, quotedPostId: quotedPost?.id ?? null },
    });
    await syncDraftAttachmentReferences(transaction, {
      actorId: context.userId,
      draftId: draft.id,
      body,
    });
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
    const quotedPost = await resolveQuotedPost(transaction, topic.id, input.quotedPosition);
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
