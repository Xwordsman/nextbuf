import "server-only";

import { createHmac, randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { createOutboxEvent } from "@/infrastructure/outbox/create-event";
import { requireActiveCommunityActor } from "@/modules/community/authorization.server";
import { InteractionError } from "@/modules/interactions/errors";
import { getAuthEnvironment } from "@/shared/config/runtime-env";

const publicStatuses = ["published", "closed"];
const viewBucketMinutes = 30;

export const TOPIC_VIEW_AGGREGATE_TOPIC = "nextbuf.interactions.topic-view.aggregate";

type ToggleResult = { active: boolean; count?: number };

async function requirePublicTopic(transaction: Prisma.TransactionClient, number: number) {
  const topic = await transaction.communityTopic.findFirst({
    where: {
      number,
      status: { in: publicStatuses },
      node: { visibility: "public" },
    },
    select: { id: true, bookmarkCount: true, nextPostPosition: true },
  });
  if (!topic) throw new InteractionError("topic_not_found", 404);
  return topic;
}

export async function setPostLiked(
  userId: string,
  postId: string,
  active: boolean,
): Promise<ToggleResult> {
  return getPrismaClient().$transaction(async (transaction) => {
    await requireActiveCommunityActor(transaction, userId);
    const post = await transaction.communityPost.findFirst({
      where: {
        id: postId,
        status: "published",
        topic: {
          status: { in: publicStatuses },
          node: { visibility: "public" },
        },
      },
      select: { id: true, likeCount: true },
    });
    if (!post) throw new InteractionError("post_not_found", 404);

    const changed = active
      ? await transaction.interactionPostLike.createMany({
          data: { userId, postId },
          skipDuplicates: true,
        })
      : await transaction.interactionPostLike.deleteMany({ where: { userId, postId } });
    const updated =
      changed.count === 1
        ? await transaction.communityPost.update({
            where: { id: postId },
            data: { likeCount: active ? { increment: 1 } : { decrement: 1 } },
            select: { likeCount: true },
          })
        : await transaction.communityPost.findUniqueOrThrow({
            where: { id: postId },
            select: { likeCount: true },
          });
    return { active, count: updated.likeCount };
  });
}

export async function setTopicBookmarked(
  userId: string,
  number: number,
  active: boolean,
): Promise<ToggleResult> {
  return getPrismaClient().$transaction(async (transaction) => {
    await requireActiveCommunityActor(transaction, userId);
    const topic = await requirePublicTopic(transaction, number);
    const changed = active
      ? await transaction.interactionTopicBookmark.createMany({
          data: { userId, topicId: topic.id },
          skipDuplicates: true,
        })
      : await transaction.interactionTopicBookmark.deleteMany({
          where: { userId, topicId: topic.id },
        });
    const updated =
      changed.count === 1
        ? await transaction.communityTopic.update({
            where: { id: topic.id },
            data: { bookmarkCount: active ? { increment: 1 } : { decrement: 1 } },
            select: { bookmarkCount: true },
          })
        : await transaction.communityTopic.findUniqueOrThrow({
            where: { id: topic.id },
            select: { bookmarkCount: true },
          });
    return { active, count: updated.bookmarkCount };
  });
}

export async function setTopicFollowed(
  userId: string,
  number: number,
  active: boolean,
): Promise<ToggleResult> {
  return getPrismaClient().$transaction(async (transaction) => {
    await requireActiveCommunityActor(transaction, userId);
    const topic = await requirePublicTopic(transaction, number);
    if (active) {
      await transaction.interactionTopicFollow.createMany({
        data: { userId, topicId: topic.id },
        skipDuplicates: true,
      });
    } else {
      await transaction.interactionTopicFollow.deleteMany({
        where: { userId, topicId: topic.id },
      });
    }
    return { active };
  });
}

export async function setUserFollowed(
  followerId: string,
  username: string,
  active: boolean,
): Promise<ToggleResult> {
  return getPrismaClient().$transaction(async (transaction) => {
    await requireActiveCommunityActor(transaction, followerId);
    const followed = await transaction.user.findFirst({
      where: { username: username.toLowerCase(), status: "active" },
      select: { id: true },
    });
    if (!followed) throw new InteractionError("user_not_found", 404);
    if (followed.id === followerId) throw new InteractionError("cannot_follow_self", 400);
    if (active) {
      await transaction.interactionUserFollow.createMany({
        data: { followerId, followedId: followed.id },
        skipDuplicates: true,
      });
    } else {
      await transaction.interactionUserFollow.deleteMany({
        where: { followerId, followedId: followed.id },
      });
    }
    return { active };
  });
}

export async function markTopicRead(userId: string, number: number, requestedPosition: number) {
  return getPrismaClient().$transaction(async (transaction) => {
    await requireActiveCommunityActor(transaction, userId);
    const topic = await requirePublicTopic(transaction, number);
    const position = Math.max(1, Math.min(requestedPosition, topic.nextPostPosition - 1));
    const now = new Date();
    await transaction.$executeRaw`
      INSERT INTO "interaction_topic_read_states"
        ("user_id", "topic_id", "last_read_position", "last_read_at", "updated_at")
      VALUES (${userId}::uuid, ${topic.id}::uuid, ${position}, ${now}, ${now})
      ON CONFLICT ("user_id", "topic_id") DO UPDATE SET
        "last_read_position" = GREATEST(
          "interaction_topic_read_states"."last_read_position",
          EXCLUDED."last_read_position"
        ),
        "last_read_at" = EXCLUDED."last_read_at",
        "updated_at" = EXCLUDED."updated_at"
    `;
    return { position, readAt: now };
  });
}

function viewBucket(now: Date): Date {
  const bucket = new Date(now);
  bucket.setUTCMinutes(
    Math.floor(bucket.getUTCMinutes() / viewBucketMinutes) * viewBucketMinutes,
    0,
    0,
  );
  return bucket;
}

export async function recordTopicView(input: {
  number: number;
  viewerId?: string;
  anonymousFingerprint: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const viewerKey = input.viewerId
    ? `user:${input.viewerId}`
    : `anonymous:${input.anonymousFingerprint}`;
  const viewerKeyHash = createHmac("sha256", getAuthEnvironment().AUTH_SECRET)
    .update(`nextbuf-topic-view-v1:${viewerKey}`)
    .digest("hex");

  return getPrismaClient().$transaction(async (transaction) => {
    const topic = await requirePublicTopic(transaction, input.number);
    const id = randomUUID();
    const inserted = await transaction.interactionTopicView.createMany({
      data: {
        id,
        topicId: topic.id,
        viewerKeyHash,
        bucketStartedAt: viewBucket(now),
      },
      skipDuplicates: true,
    });
    if (inserted.count === 1) {
      await createOutboxEvent(transaction, {
        topic: TOPIC_VIEW_AGGREGATE_TOPIC,
        idempotencyKey: `interaction-topic-view:${id}`,
        payload: { viewId: id },
      });
    }
    return { accepted: inserted.count === 1 };
  });
}
