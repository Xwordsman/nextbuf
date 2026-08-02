import "server-only";

import { randomUUID } from "node:crypto";
import type { Job } from "bullmq";
import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import {
  type EmailDeliveryAttempt,
  markEmailDeliveryFinalFailure,
} from "@/infrastructure/mail/smtp";
import { logger } from "@/infrastructure/observability/logger";
import { isMailDeliveryTopic } from "@/infrastructure/mail/queue";
import { toSafeMailError } from "@/infrastructure/mail/errors";
import {
  OUTBOX_PROCESSING_OWNER_PREFIX,
  type OutboxProcessingLease,
} from "@/infrastructure/outbox/processing-lease";
import { SYSTEM_QUEUE_NAME, type OutboxJobData } from "@/infrastructure/queue/contracts";
import { getSystemQueue } from "@/infrastructure/queue/system-queue";
import { getServiceEnvironment } from "@/shared/config/runtime-env";
import { getErrorMessage } from "@/shared/errors/error-message";

function finalAttempt(job: Job<OutboxJobData>, attemptNumber: number): boolean {
  const allowed = typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
  return attemptNumber >= allowed;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type FailureInput = {
  queueName: string;
  jobId: string;
  jobName: string;
  outboxEventId: string | null;
  emailDeliveryId?: string;
  attempts: number;
  lastError: string;
};

async function upsertWorkerFailure(
  transaction: Prisma.TransactionClient,
  input: FailureInput,
): Promise<void> {
  await transaction.workerJobFailure.upsert({
    where: { queueName_jobId: { queueName: input.queueName, jobId: input.jobId } },
    create: input,
    update: {
      jobName: input.jobName,
      outboxEventId: input.outboxEventId,
      emailDeliveryId: input.emailDeliveryId ?? null,
      attempts: input.attempts,
      lastError: input.lastError,
      failedAt: new Date(),
      replayRequestedAt: null,
      replayRequestedById: null,
      replayDuplicateRiskAcknowledgedAt: null,
      replayedAt: null,
      resolvedAt: null,
    },
  });
}

export async function recordWorkerFailure(
  job: Job<OutboxJobData> | undefined,
  error: unknown,
  attemptNumber = job?.attemptsMade ?? 0,
  options: {
    terminal?: boolean;
    mailAttempt?: EmailDeliveryAttempt;
    processingLease?: OutboxProcessingLease;
  } = {},
): Promise<void> {
  if (!job?.id || (!options.terminal && !finalAttempt(job, attemptNumber))) return;
  const prisma = getPrismaClient();
  const mailJob = isMailDeliveryTopic(job.data.topic);
  const message = getErrorMessage(mailJob ? toSafeMailError(error) : error).slice(0, 8_000);
  const outboxEventId = typeof job.data.eventId === "string" ? job.data.eventId : null;
  const input = {
    queueName: SYSTEM_QUEUE_NAME,
    jobId: job.id,
    jobName: job.name,
    outboxEventId,
    attempts: attemptNumber,
    lastError: message,
  } satisfies FailureInput;

  if (!mailJob) {
    await prisma.$transaction(async (transaction) => {
      await upsertWorkerFailure(transaction, input);
      if (options.processingLease) {
        await options.processingLease.assertCommit(transaction);
      }
    });
    return;
  }

  const deliveryId = job.data.payload.deliveryId;
  if (typeof deliveryId !== "string" || !uuidPattern.test(deliveryId)) {
    await prisma.$transaction(async (transaction) => {
      await upsertWorkerFailure(transaction, input);
      if (options.processingLease) {
        await options.processingLease.assertCommit(transaction);
      } else if (outboxEventId) {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "outbox_events"
          WHERE "id" = CAST(${outboxEventId} AS uuid)
          FOR UPDATE
        `;
      }
    });
    return;
  }

  await prisma.$transaction(async (transaction) => {
    if (options.mailAttempt) {
      const result = await markEmailDeliveryFinalFailure(
        transaction,
        options.mailAttempt,
        toSafeMailError(error),
      );
      if (result === "missing" || result === "complete") return;
    } else {
      const deliveries = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "email_deliveries"
        WHERE "id" = CAST(${deliveryId} AS uuid)
        FOR KEY SHARE
      `;
      if (deliveries.length === 0) return;
    }

    await upsertWorkerFailure(transaction, { ...input, emailDeliveryId: deliveryId });
    if (options.processingLease) {
      await options.processingLease.assertCommit(transaction);
    } else if (outboxEventId) {
      await transaction.$queryRaw`
        SELECT "id"
        FROM "outbox_events"
        WHERE "id" = CAST(${outboxEventId} AS uuid)
        FOR UPDATE
      `;
    }
  });
}

export async function resolveWorkerFailure(
  jobId: string | undefined,
  transaction?: Prisma.TransactionClient,
): Promise<void> {
  if (!jobId) return;
  await (transaction ?? getPrismaClient()).workerJobFailure.updateMany({
    where: { queueName: SYSTEM_QUEUE_NAME, jobId, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
}

type ReplayFailureSnapshot = {
  id: string;
  jobId: string;
  outboxEventId: string | null;
  emailDeliveryId: string | null;
};

type LockedReplayFailure = ReplayFailureSnapshot & {
  replayDuplicateRiskAcknowledgedAt: Date | null;
};

type LockedOutboxEvent = {
  id: string;
  processingLeaseActive: boolean;
};

function hasEffectiveProcessingLease(event: LockedOutboxEvent): boolean {
  return event.processingLeaseActive;
}

async function lockReplayEmailDelivery(
  transaction: Prisma.TransactionClient,
  deliveryId: string | null,
): Promise<{ id: string; status: string } | null> {
  if (!deliveryId) return null;
  const deliveries = await transaction.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT "id", "status"
    FROM "email_deliveries"
    WHERE "id" = CAST(${deliveryId} AS uuid)
    FOR UPDATE
  `;
  return deliveries[0] ?? null;
}

async function lockReplayFailure(
  transaction: Prisma.TransactionClient,
  failureId: string,
  requested: boolean,
): Promise<LockedReplayFailure | null> {
  const rows = await transaction.$queryRaw<LockedReplayFailure[]>`
    SELECT
      "id",
      "job_id" AS "jobId",
      "outbox_event_id" AS "outboxEventId",
      "email_delivery_id" AS "emailDeliveryId",
      "replay_duplicate_risk_acknowledged_at" AS "replayDuplicateRiskAcknowledgedAt"
    FROM "worker_job_failures"
    WHERE "id" = CAST(${failureId} AS uuid)
      AND "resolved_at" IS NULL
      AND "replayed_at" IS NULL
      AND (${requested} OR "replay_requested_at" IS NULL)
      AND (NOT ${requested} OR "replay_requested_at" IS NOT NULL)
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function lockReplayOutboxEvent(
  transaction: Prisma.TransactionClient,
  eventId: string,
): Promise<LockedOutboxEvent | null> {
  const lockTimeoutMs = getServiceEnvironment().OUTBOX_LOCK_TIMEOUT_MS;
  const rows = await transaction.$queryRaw<LockedOutboxEvent[]>`
    SELECT
      "id",
      COALESCE((
        "lock_owner" LIKE ${`${OUTBOX_PROCESSING_OWNER_PREFIX}%`}
        AND "locked_at" > CURRENT_TIMESTAMP - (CAST(${lockTimeoutMs} AS bigint) * INTERVAL '1 millisecond')
      ), FALSE) AS "processingLeaseActive"
    FROM "outbox_events"
    WHERE "id" = CAST(${eventId} AS uuid)
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

export async function requestWorkerReplay(
  failureId: string,
  actorId: string,
  options: { acknowledgeDuplicateRisk?: boolean } = {},
): Promise<boolean> {
  const snapshot = await getPrismaClient().workerJobFailure.findUnique({
    where: { id: failureId },
    select: { id: true, jobId: true, outboxEventId: true, emailDeliveryId: true },
  });
  if (!snapshot?.outboxEventId) return false;

  return getPrismaClient().$transaction(async (transaction) => {
    const delivery = await lockReplayEmailDelivery(transaction, snapshot.emailDeliveryId);
    if (snapshot.emailDeliveryId && !delivery) return false;
    const failure = await lockReplayFailure(transaction, snapshot.id, false);
    if (
      !failure?.outboxEventId ||
      failure.outboxEventId !== snapshot.outboxEventId ||
      failure.emailDeliveryId !== snapshot.emailDeliveryId
    ) {
      return false;
    }
    const event = await lockReplayOutboxEvent(transaction, failure.outboxEventId);
    const now = new Date();
    if (!event || hasEffectiveProcessingLease(event)) return false;

    const duplicateRisk = delivery?.status === "sending" || delivery?.status === "outcome_unknown";
    const acknowledgesDuplicateRisk = duplicateRisk && options.acknowledgeDuplicateRisk === true;
    if (duplicateRisk && !acknowledgesDuplicateRisk) return false;

    const requested = await transaction.workerJobFailure.updateMany({
      where: {
        id: failure.id,
        resolvedAt: null,
        replayRequestedAt: null,
        replayedAt: null,
      },
      data: {
        replayRequestedAt: now,
        replayRequestedById: actorId,
        replayDuplicateRiskAcknowledgedAt: acknowledgesDuplicateRisk ? now : null,
      },
    });
    if (requested.count !== 1) return false;
    await transaction.communityAuditEvent.create({
      data: {
        actorId,
        action: "worker.job.replay.requested",
        metadata: {
          failureId: failure.id,
          outboxEventId: failure.outboxEventId,
          jobId: failure.jobId,
          acknowledgeDuplicateRisk: acknowledgesDuplicateRisk,
        },
      },
    });
    return true;
  });
}

async function removeReplayQueueJob(jobId: string): Promise<boolean> {
  try {
    const queued = await getSystemQueue().getJob(jobId);
    if (!queued) return true;
    if ((await queued.getState()) === "active") return false;
    await queued.remove();
    return true;
  } catch (error) {
    logger.warn("Worker replay could not remove the previous Redis job", {
      jobId,
      error: getErrorMessage(error),
    });
    return false;
  }
}

async function replayFailure(snapshot: ReplayFailureSnapshot): Promise<boolean> {
  if (!snapshot.outboxEventId) return false;
  // Remove the terminal BullMQ identity before publication is reset. Otherwise
  // a Dispatcher can enqueue the replay and the cleanup can delete that new job.
  if (!(await removeReplayQueueJob(snapshot.jobId))) return false;
  const replayed = await getPrismaClient().$transaction(async (transaction) => {
    const delivery = await lockReplayEmailDelivery(transaction, snapshot.emailDeliveryId);
    if (snapshot.emailDeliveryId && !delivery) return false;
    const failure = await lockReplayFailure(transaction, snapshot.id, true);
    if (
      !failure?.outboxEventId ||
      failure.outboxEventId !== snapshot.outboxEventId ||
      failure.emailDeliveryId !== snapshot.emailDeliveryId
    ) {
      return false;
    }
    const event = await lockReplayOutboxEvent(transaction, failure.outboxEventId);
    const now = new Date();
    if (!event || hasEffectiveProcessingLease(event)) return false;
    if (
      (delivery?.status === "sending" || delivery?.status === "outcome_unknown") &&
      !failure.replayDuplicateRiskAcknowledgedAt
    ) {
      return false;
    }

    if (delivery && delivery.status !== "sent") {
      await transaction.emailDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "pending",
          sentAt: null,
          lastError: null,
          attemptToken: randomUUID(),
          attemptGeneration: { increment: 1 },
        },
      });
      await transaction.notificationDelivery.updateMany({
        where: { emailDeliveryId: delivery.id, status: { not: "delivered" } },
        data: { status: "queued" },
      });
    }

    await transaction.workerJobFailure.update({
      where: { id: failure.id },
      data: { replayedAt: now, replayCount: { increment: 1 }, resolvedAt: null },
    });
    await transaction.outboxEvent.update({
      where: { id: event.id },
      data: {
        publishedAt: null,
        processedAt: null,
        availableAt: now,
        lockedAt: null,
        lockOwner: null,
        lastError: null,
      },
    });
    await transaction.processedJob.deleteMany({
      where: { queueName: SYSTEM_QUEUE_NAME, idempotencyKey: `outbox-${event.id}` },
    });
    return true;
  });
  return replayed;
}

export async function processReplayRequests(limit = 20): Promise<number> {
  const prisma = getPrismaClient();
  const requests = await prisma.workerJobFailure.findMany({
    where: { replayRequestedAt: { not: null }, replayedAt: null, resolvedAt: null },
    orderBy: { replayRequestedAt: "asc" },
    take: limit,
    select: { id: true, jobId: true, outboxEventId: true, emailDeliveryId: true },
  });
  let replayed = 0;
  for (const request of requests) {
    if (await replayFailure(request)) replayed += 1;
  }
  return replayed;
}

export type WorkerFailurePayload = Prisma.InputJsonObject;
