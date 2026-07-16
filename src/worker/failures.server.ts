import "server-only";

import type { Job } from "bullmq";
import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { SYSTEM_QUEUE_NAME, type OutboxJobData } from "@/infrastructure/queue/contracts";
import { getSystemQueue } from "@/infrastructure/queue/system-queue";
import { getErrorMessage } from "@/shared/errors/error-message";

function finalAttempt(job: Job<OutboxJobData>, attemptNumber: number): boolean {
  const allowed = typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
  return attemptNumber >= allowed;
}

export async function recordWorkerFailure(
  job: Job<OutboxJobData> | undefined,
  error: unknown,
  attemptNumber = job?.attemptsMade ?? 0,
): Promise<void> {
  if (!job?.id || !finalAttempt(job, attemptNumber)) return;
  const prisma = getPrismaClient();
  const message = getErrorMessage(error).slice(0, 8_000);
  const outboxEventId = typeof job.data.eventId === "string" ? job.data.eventId : null;
  await prisma.workerJobFailure.upsert({
    where: { queueName_jobId: { queueName: SYSTEM_QUEUE_NAME, jobId: job.id } },
    create: {
      queueName: SYSTEM_QUEUE_NAME,
      jobId: job.id,
      jobName: job.name,
      outboxEventId,
      attempts: attemptNumber,
      lastError: message,
    },
    update: {
      jobName: job.name,
      outboxEventId,
      attempts: attemptNumber,
      lastError: message,
      failedAt: new Date(),
      replayRequestedAt: null,
      replayRequestedById: null,
      resolvedAt: null,
    },
  });

  const deliveryId = job.data.payload.deliveryId;
  if (typeof deliveryId === "string") {
    await prisma.emailDelivery.updateMany({
      where: { id: deliveryId, status: { not: "sent" } },
      data: { status: "failed", attempts: attemptNumber, lastError: message },
    });
    await prisma.notificationDelivery.updateMany({
      where: { emailDeliveryId: deliveryId, status: { not: "delivered" } },
      data: { status: "failed" },
    });
  }
}

export async function resolveWorkerFailure(jobId: string | undefined): Promise<void> {
  if (!jobId) return;
  await getPrismaClient().workerJobFailure.updateMany({
    where: { queueName: SYSTEM_QUEUE_NAME, jobId, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
}

export async function requestWorkerReplay(failureId: string, actorId: string): Promise<boolean> {
  return getPrismaClient().$transaction(async (transaction) => {
    const failure = await transaction.workerJobFailure.findUnique({ where: { id: failureId } });
    if (!failure || failure.resolvedAt || !failure.outboxEventId) return false;
    const event = await transaction.outboxEvent.findUnique({
      where: { id: failure.outboxEventId },
      select: { id: true },
    });
    if (!event) return false;
    const now = new Date();
    await transaction.workerJobFailure.update({
      where: { id: failure.id },
      data: { replayRequestedAt: now, replayRequestedById: actorId, replayedAt: null },
    });
    await transaction.communityAuditEvent.create({
      data: {
        actorId,
        action: "worker.job.replay.requested",
        metadata: {
          failureId: failure.id,
          outboxEventId: failure.outboxEventId,
          jobId: failure.jobId,
        },
      },
    });
    return true;
  });
}

async function replayFailure(failure: {
  id: string;
  jobId: string;
  outboxEventId: string | null;
}): Promise<boolean> {
  if (!failure.outboxEventId) return false;
  const queued = await getSystemQueue().getJob(failure.jobId);
  if (queued) {
    const state = await queued.getState();
    if (state === "active") return false;
    await queued.remove();
  }
  await getPrismaClient().$transaction(async (transaction) => {
    await transaction.processedJob.deleteMany({
      where: { queueName: SYSTEM_QUEUE_NAME, idempotencyKey: `outbox-${failure.outboxEventId}` },
    });
    await transaction.outboxEvent.update({
      where: { id: failure.outboxEventId! },
      data: {
        publishedAt: null,
        availableAt: new Date(),
        lockedAt: null,
        lockOwner: null,
        lastError: null,
      },
    });
    await transaction.workerJobFailure.update({
      where: { id: failure.id },
      data: { replayedAt: new Date(), replayCount: { increment: 1 }, resolvedAt: null },
    });
  });
  return true;
}

export async function processReplayRequests(limit = 20): Promise<number> {
  const prisma = getPrismaClient();
  const requests = await prisma.workerJobFailure.findMany({
    where: { replayRequestedAt: { not: null }, replayedAt: null, resolvedAt: null },
    orderBy: { replayRequestedAt: "asc" },
    take: limit,
    select: { id: true, jobId: true, outboxEventId: true },
  });
  let replayed = 0;
  for (const request of requests) {
    if (await replayFailure(request)) replayed += 1;
  }
  return replayed;
}

export type WorkerFailurePayload = Prisma.InputJsonObject;
