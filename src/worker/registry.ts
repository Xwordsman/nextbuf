import type { Prisma } from "@/generated/prisma/client";
import { RUNTIME_PROBE_TOPIC, type OutboxJobData } from "@/infrastructure/queue/contracts";
import { IDENTITY_EMAIL_TOPIC, MAIL_DELIVERY_TOPIC } from "@/infrastructure/mail/queue";
import { sendEmailDelivery } from "@/infrastructure/mail/smtp";
import {
  ATTACHMENT_COLLECT_TOPIC,
  ATTACHMENT_PROCESS_TOPIC,
  collectCommunityAttachment,
} from "@/modules/community/attachments.server";
import { processCommunityAttachment } from "@/modules/community/attachment-worker.server";
import { TOPIC_VIEW_AGGREGATE_TOPIC } from "@/modules/interactions/interactions.server";
import { aggregateTopicView } from "@/modules/interactions/view-worker.server";
import { TRUST_RECALCULATION_TOPIC } from "@/modules/trust/contracts";
import { processTrustRecalculationChunk } from "@/modules/trust/worker.server";
import { COMMUNITY_NOTIFICATION_TOPIC } from "@/modules/notifications/events.server";
import { processCommunityNotification } from "@/modules/notifications/worker.server";

type OutboxHandler = (
  transaction: Prisma.TransactionClient,
  job: OutboxJobData,
) => Promise<Prisma.InputJsonValue | undefined>;

const handlers = new Map<string, OutboxHandler>();

function handlerKey(topic: string, version: number): string {
  return `${topic}@${version}`;
}

handlers.set(handlerKey(RUNTIME_PROBE_TOPIC, 1), async (transaction, job) => {
  const processedAt = new Date().toISOString();
  await transaction.systemState.upsert({
    where: { key: "runtime.last_probe" },
    create: {
      key: "runtime.last_probe",
      value: { eventId: job.eventId, payload: job.payload, processedAt },
    },
    update: {
      value: { eventId: job.eventId, payload: job.payload, processedAt },
    },
  });

  return { eventId: job.eventId, processedAt };
});

handlers.set(handlerKey(IDENTITY_EMAIL_TOPIC, 1), async (transaction, job) => {
  const deliveryId = job.payload.deliveryId;
  if (typeof deliveryId !== "string") {
    throw new Error("Identity email job is missing deliveryId");
  }

  await sendEmailDelivery(transaction, deliveryId);
  return { deliveryId };
});

handlers.set(handlerKey(MAIL_DELIVERY_TOPIC, 1), async (transaction, job) => {
  const deliveryId = job.payload.deliveryId;
  if (typeof deliveryId !== "string") throw new Error("Email job is missing deliveryId");
  await sendEmailDelivery(transaction, deliveryId);
  return { deliveryId };
});

handlers.set(handlerKey(COMMUNITY_NOTIFICATION_TOPIC, 1), async (transaction, job) =>
  processCommunityNotification(transaction, job.payload),
);

function attachmentId(job: OutboxJobData): string {
  const value = job.payload.attachmentId;
  if (typeof value !== "string") throw new Error("Attachment job is missing attachmentId");
  return value;
}

handlers.set(handlerKey(ATTACHMENT_PROCESS_TOPIC, 1), async (transaction, job) =>
  processCommunityAttachment(transaction, attachmentId(job)),
);

handlers.set(handlerKey(ATTACHMENT_COLLECT_TOPIC, 1), async (transaction, job) =>
  collectCommunityAttachment(transaction, attachmentId(job)),
);

handlers.set(handlerKey(TOPIC_VIEW_AGGREGATE_TOPIC, 1), async (transaction, job) => {
  const viewId = job.payload.viewId;
  if (typeof viewId !== "string") throw new Error("Topic view job is missing viewId");
  return aggregateTopicView(transaction, viewId);
});

handlers.set(handlerKey(TRUST_RECALCULATION_TOPIC, 1), async (transaction, job) => {
  const batchId = job.payload.batchId;
  if (typeof batchId !== "string") throw new Error("Trust job is missing batchId");
  return processTrustRecalculationChunk(transaction, batchId);
});

export function getOutboxHandler(topic: string, version: number): OutboxHandler {
  const handler = handlers.get(handlerKey(topic, version));

  if (!handler) {
    throw new Error(`No worker handler registered for ${topic}@${version}`);
  }

  return handler;
}
