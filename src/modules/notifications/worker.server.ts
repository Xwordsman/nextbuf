import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { createQueuedEmailDelivery } from "@/infrastructure/mail/queue";
import {
  NOTIFICATION_TYPES,
  type NotificationSnapshot,
  type NotificationType,
} from "@/modules/notifications/contracts";
import { renderNotificationMail } from "@/modules/notifications/mail-template";
import { getAuthEnvironment } from "@/shared/config/runtime-env";

type RecipientReason = { type: NotificationType; priority: number };

function isNotificationType(value: string): value is NotificationType {
  return NOTIFICATION_TYPES.some((type) => type === value);
}

function jsonSnapshot(snapshot: NotificationSnapshot): Prisma.InputJsonObject {
  return {
    actorName: snapshot.actorName,
    actorUsername: snapshot.actorUsername,
    topicNumber: snapshot.topicNumber,
    topicTitle: snapshot.topicTitle,
    ...(snapshot.postPosition === undefined ? {} : { postPosition: snapshot.postPosition }),
    ...(snapshot.action === undefined ? {} : { action: snapshot.action }),
  };
}

function addRecipient(
  recipients: Map<string, RecipientReason>,
  actorId: string,
  recipientId: string | null | undefined,
  type: NotificationType,
  priority: number,
) {
  if (!recipientId || recipientId === actorId) return;
  const current = recipients.get(recipientId);
  if (!current || priority > current.priority) recipients.set(recipientId, { type, priority });
}

async function createNotification(
  transaction: Prisma.TransactionClient,
  input: {
    recipientId: string;
    actorId: string;
    type: NotificationType;
    topicId: string;
    postId?: string;
    dedupeKey: string;
    snapshot: NotificationSnapshot;
  },
) {
  const recipient = await transaction.user.findUnique({
    where: { id: input.recipientId },
    select: { email: true, emailVerified: true, status: true },
  });
  if (!recipient || recipient.status !== "active") return;

  const preference = await transaction.notificationPreference.findUnique({
    where: { userId_type: { userId: input.recipientId, type: input.type } },
  });
  const notification = await transaction.notification.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: {
      recipientId: input.recipientId,
      actorId: input.actorId,
      type: input.type,
      topicId: input.topicId,
      postId: input.postId,
      dedupeKey: input.dedupeKey,
      snapshot: jsonSnapshot(input.snapshot),
    },
    update: {},
  });
  if (
    (await transaction.notificationDelivery.count({ where: { notificationId: notification.id } })) >
    0
  ) {
    return;
  }

  const inAppEnabled = preference?.inAppEnabled ?? true;
  await transaction.notificationDelivery.create({
    data: {
      notificationId: notification.id,
      channel: "in_app",
      status: inAppEnabled ? "delivered" : "skipped",
      skippedReason: inAppEnabled ? null : "preference_disabled",
    },
  });

  const emailEnabled = preference?.emailEnabled ?? false;
  if (!emailEnabled || !recipient.emailVerified) {
    await transaction.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        channel: "email",
        status: "skipped",
        skippedReason: emailEnabled ? "email_unverified" : "preference_disabled",
      },
    });
    return;
  }

  const rendered = renderNotificationMail(input.type, input.snapshot, getAuthEnvironment().APP_URL);
  const email = await createQueuedEmailDelivery(transaction, {
    kind: `notification-${input.type}`,
    recipient: recipient.email,
    ...rendered,
  });
  await transaction.notificationDelivery.create({
    data: {
      notificationId: notification.id,
      channel: "email",
      status: "queued",
      emailDeliveryId: email.id,
    },
  });
}

async function processReply(
  transaction: Prisma.TransactionClient,
  postId: string,
): Promise<Prisma.InputJsonValue> {
  const post = await transaction.communityPost.findUnique({
    where: { id: postId },
    include: {
      author: { select: { id: true, name: true, username: true } },
      topic: {
        select: {
          id: true,
          number: true,
          title: true,
          authorId: true,
          status: true,
          interactionFollows: { select: { userId: true } },
        },
      },
      quotedPost: { select: { authorId: true } },
      mentions: { select: { mentionedUserId: true } },
    },
  });
  if (!post || post.position <= 1 || post.status !== "published") return { skipped: true };
  if (!["published", "closed"].includes(post.topic.status)) return { skipped: true };

  const recipients = new Map<string, RecipientReason>();
  addRecipient(recipients, post.authorId, post.topic.authorId, "reply", 2);
  addRecipient(recipients, post.authorId, post.quotedPost?.authorId, "reply", 2);
  for (const mention of post.mentions) {
    addRecipient(recipients, post.authorId, mention.mentionedUserId, "mention", 3);
  }
  for (const follow of post.topic.interactionFollows) {
    addRecipient(recipients, post.authorId, follow.userId, "followed_topic_reply", 1);
  }

  const snapshot: NotificationSnapshot = {
    actorName: post.author.name,
    actorUsername: post.author.username,
    topicNumber: post.topic.number,
    topicTitle: post.topic.title,
    postPosition: post.position,
  };
  for (const [recipientId, reason] of recipients) {
    await createNotification(transaction, {
      recipientId,
      actorId: post.authorId,
      type: reason.type,
      topicId: post.topic.id,
      postId: post.id,
      dedupeKey: `community-post:${post.id}:${recipientId}`,
      snapshot,
    });
  }
  return { notifications: recipients.size };
}

async function processManagement(
  transaction: Prisma.TransactionClient,
  input: { auditEventId: string; topicId: string; action: string },
): Promise<Prisma.InputJsonValue> {
  const [audit, topic] = await Promise.all([
    transaction.communityAuditEvent.findUnique({
      where: { id: input.auditEventId },
      include: { actor: { select: { id: true, name: true, username: true } } },
    }),
    transaction.communityTopic.findUnique({
      where: { id: input.topicId },
      select: { id: true, number: true, title: true, authorId: true },
    }),
  ]);
  if (!audit?.actor || !topic || audit.actor.id === topic.authorId) return { skipped: true };
  const snapshot: NotificationSnapshot = {
    actorName: audit.actor.name,
    actorUsername: audit.actor.username,
    topicNumber: topic.number,
    topicTitle: topic.title,
    action: input.action,
  };
  await createNotification(transaction, {
    recipientId: topic.authorId,
    actorId: audit.actor.id,
    type: "management",
    topicId: topic.id,
    dedupeKey: `community-management:${audit.id}:${topic.authorId}`,
    snapshot,
  });
  return { notifications: 1 };
}

export async function processCommunityNotification(
  transaction: Prisma.TransactionClient,
  payload: Prisma.InputJsonObject,
) {
  if (payload.kind === "reply" && typeof payload.postId === "string") {
    return processReply(transaction, payload.postId);
  }
  if (
    payload.kind === "management" &&
    typeof payload.auditEventId === "string" &&
    typeof payload.topicId === "string" &&
    typeof payload.action === "string"
  ) {
    return processManagement(transaction, {
      auditEventId: payload.auditEventId,
      topicId: payload.topicId,
      action: payload.action,
    });
  }
  if (typeof payload.type === "string" && !isNotificationType(payload.type)) {
    throw new Error(`Unknown notification type: ${payload.type}`);
  }
  throw new Error("Community notification job payload is invalid");
}
