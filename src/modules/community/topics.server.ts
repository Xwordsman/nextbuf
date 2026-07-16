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
import { getSiteSettings } from "@/modules/settings/settings.server";

type TopicWriteContext = { userId: string; requestId?: string };

type TopicContentInput = {
  nodeSlug: string;
  title: string;
  body: string;
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

export async function createTopic(
  context: TopicWriteContext,
  input: TopicContentInput & { action: "draft" | "publish" },
) {
  const content = validateTopicInput(input.title, input.body, input.action);
  const prisma = getPrismaClient();

  return prisma.$transaction(async (transaction) => {
    await lockUser(transaction, context.userId);
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
  input: TopicContentInput & { action: "save" | "publish" },
) {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (transaction) => {
    await lockTopic(transaction, number);
    const topic = await transaction.communityTopic.findUnique({
      where: { number },
      include: { posts: { where: { position: 1 }, take: 1 } },
    });
    if (!topic || topic.posts.length !== 1) throw new CommunityError("topic_not_found", 404);
    if (topic.status === "deleted") throw new CommunityError("invalid_topic_state", 409);
    const permissions = await requireActiveCommunityActor(
      transaction,
      context.userId,
      topic.nodeId,
    );
    if (topic.authorId !== context.userId && !permissions.canModerate) {
      throw new CommunityError("forbidden", 403);
    }
    if (topic.status === "draft" && topic.authorId !== context.userId) {
      throw new CommunityError("forbidden", 403);
    }

    const publishing = input.action === "publish" && topic.status === "draft";
    const mode = topic.status === "draft" && !publishing ? "draft" : "publish";
    const content = validateTopicInput(input.title, input.body, mode);
    const node = await resolveWritableNode(transaction, input.nodeSlug);
    const post = topic.posts[0];
    if (!post) throw new CommunityError("topic_not_found", 404);
    const now = new Date();
    if (publishing) {
      await lockUser(transaction, context.userId);
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
  });
}

export async function deleteTopic(context: TopicWriteContext, number: number) {
  return getPrismaClient().$transaction(async (transaction) => {
    await lockTopic(transaction, number);
    const topic = await transaction.communityTopic.findUnique({ where: { number } });
    if (!topic) throw new CommunityError("topic_not_found", 404);
    if (topic.status === "deleted") return topic;
    const permissions = await requireActiveCommunityActor(
      transaction,
      context.userId,
      topic.nodeId,
    );
    if (topic.authorId !== context.userId && !permissions.canModerate) {
      throw new CommunityError("forbidden", 403);
    }
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
    if (topic.status !== "deleted") throw new CommunityError("invalid_topic_state", 409);
    const permissions = await requireActiveCommunityActor(
      transaction,
      context.userId,
      topic.nodeId,
    );
    if (topic.authorId !== context.userId && !permissions.canModerate) {
      throw new CommunityError("forbidden", 403);
    }
    const restoredStatus = topic.deletedFromStatus ?? "draft";
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
