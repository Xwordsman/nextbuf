import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { createOutboxEvent } from "@/infrastructure/outbox/create-event";

export const COMMUNITY_NOTIFICATION_TOPIC = "nextbuf.notifications.community";

export async function queueReplyNotificationIntent(
  transaction: Prisma.TransactionClient,
  postId: string,
): Promise<void> {
  await createOutboxEvent(transaction, {
    topic: COMMUNITY_NOTIFICATION_TOPIC,
    idempotencyKey: `notification-reply:${postId}`,
    payload: { kind: "reply", postId },
  });
}

export async function queueManagementNotificationIntent(
  transaction: Prisma.TransactionClient,
  input: { auditEventId: string; topicId: string; action: string },
): Promise<void> {
  await createOutboxEvent(transaction, {
    topic: COMMUNITY_NOTIFICATION_TOPIC,
    idempotencyKey: `notification-management:${input.auditEventId}`,
    payload: { kind: "management", ...input },
  });
}
