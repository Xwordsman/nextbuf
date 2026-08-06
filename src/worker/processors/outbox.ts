import { DelayedError, UnrecoverableError, Worker, type Job } from "bullmq";
import { createBullRedisConnection } from "@/infrastructure/cache/redis";
import { getRedisKeyspaces } from "@/infrastructure/cache/keys";
import { getPrismaClient } from "@/infrastructure/database/client";
import {
  mailOutcomeUnknownError,
  SafeMailError,
  toSafeMailError,
} from "@/infrastructure/mail/errors";
import { isMailDeliveryTopic } from "@/infrastructure/mail/queue";
import {
  claimEmailDelivery,
  type EmailDeliveryAttempt,
  EmailDeliveryAttemptLostError,
  markEmailDeliveryOutcomeUnknown,
  markEmailDeliveryProviderFailure,
  markEmailDeliverySent,
  sendClaimedEmailDelivery,
} from "@/infrastructure/mail/smtp";
import {
  acquireOutboxProcessingLease,
  type OutboxProcessingLease,
  OutboxProcessingLeaseLostError,
} from "@/infrastructure/outbox/processing-lease";
import {
  OUTBOX_JOB_NAME,
  SYSTEM_QUEUE_NAME,
  type OutboxJobData,
} from "@/infrastructure/queue/contracts";
import { runDatabaseJobOnce } from "@/infrastructure/queue/idempotency";
import { getServiceEnvironment } from "@/shared/config/runtime-env";
import { getOutboxHandler } from "@/worker/registry";
import { recordWorkerFailure, resolveWorkerFailure } from "@/worker/failures.server";
import { TRUST_RECALCULATION_TOPIC } from "@/modules/trust/contracts";
import { markTrustRecalculationFailed } from "@/modules/trust/worker.server";

class TerminalMailDeliveryError extends UnrecoverableError {
  readonly report: SafeMailError;
  readonly attempt: EmailDeliveryAttempt;

  constructor(error: unknown, attempt: EmailDeliveryAttempt) {
    const report = toSafeMailError(error);
    super(report.message);
    this.report = report;
    this.attempt = attempt;
    this.stack = undefined;
  }
}

class RetryableMailDeliveryError extends Error {
  readonly report: SafeMailError;
  readonly attempt: EmailDeliveryAttempt;

  constructor(error: unknown, attempt: EmailDeliveryAttempt) {
    const report = toSafeMailError(error);
    super(report.message);
    this.name = "RetryableMailDeliveryError";
    this.report = report;
    this.attempt = attempt;
    this.stack = undefined;
  }
}

function mailDeliveryId(job: Job<OutboxJobData>): string {
  const deliveryId = job.data.payload.deliveryId;
  if (typeof deliveryId !== "string") throw new Error("Email job is missing deliveryId");
  return deliveryId;
}

async function commitMailCompletion(
  job: Job<OutboxJobData>,
  processingLease: OutboxProcessingLease,
  attempt: EmailDeliveryAttempt,
): Promise<void> {
  await getPrismaClient().$transaction(async (transaction) => {
    await markEmailDeliverySent(transaction, attempt);
    await resolveWorkerFailure(job.id, transaction);
    await processingLease.assertCommit(transaction);
    await transaction.outboxEvent.updateMany({
      where: { id: job.data.eventId, processedAt: null },
      data: { processedAt: new Date() },
    });
    const idempotencyKey = `outbox-${job.data.eventId}`;
    const existing = await transaction.processedJob.findUnique({
      where: {
        queueName_idempotencyKey: { queueName: SYSTEM_QUEUE_NAME, idempotencyKey },
      },
      select: { id: true },
    });
    if (!existing) {
      await transaction.processedJob.create({
        data: {
          queueName: SYSTEM_QUEUE_NAME,
          jobName: job.name,
          idempotencyKey,
          result: { deliveryId: attempt.deliveryId },
        },
      });
    }
  });
}

async function processMailOutboxJob(
  job: Job<OutboxJobData>,
  processingLease: OutboxProcessingLease,
): Promise<void> {
  if (job.data.version !== 1) {
    throw new Error(`No mail worker handler registered for ${job.data.topic}@${job.data.version}`);
  }
  const deliveryId = mailDeliveryId(job);
  const idempotencyKey = `outbox-${job.data.eventId}`;
  const existing = await getPrismaClient().processedJob.findUnique({
    where: {
      queueName_idempotencyKey: { queueName: SYSTEM_QUEUE_NAME, idempotencyKey },
    },
    select: { id: true },
  });
  if (existing) {
    await processingLease.assertActive();
    await getPrismaClient().$transaction(async (transaction) => {
      await resolveWorkerFailure(job.id, transaction);
      await processingLease.assertCommit(transaction);
      await transaction.outboxEvent.updateMany({
        where: { id: job.data.eventId, processedAt: null },
        data: { processedAt: new Date() },
      });
    });
    return;
  }

  await processingLease.assertActive();
  const claim = await claimEmailDelivery(deliveryId);
  if (claim.state === "blocked") {
    throw new TerminalMailDeliveryError(claim.error, claim.attempt);
  }
  if (claim.state === "complete") {
    await processingLease.assertActive();
    await getPrismaClient().$transaction(async (transaction) => {
      await resolveWorkerFailure(job.id, transaction);
      await processingLease.assertCommit(transaction);
      await transaction.outboxEvent.updateMany({
        where: { id: job.data.eventId, processedAt: null },
        data: { processedAt: new Date() },
      });
      await transaction.processedJob.upsert({
        where: {
          queueName_idempotencyKey: { queueName: SYSTEM_QUEUE_NAME, idempotencyKey },
        },
        create: {
          queueName: SYSTEM_QUEUE_NAME,
          jobName: job.name,
          idempotencyKey,
          result: { deliveryId },
        },
        update: {},
      });
    });
    return;
  }

  try {
    await sendClaimedEmailDelivery(claim.delivery);
  } catch (error) {
    const report = toSafeMailError(error);
    await markEmailDeliveryProviderFailure(claim.delivery, report);
    await processingLease.assertActive();
    if (report.disposition === "retryable") {
      throw new RetryableMailDeliveryError(report, claim.delivery);
    }
    throw new TerminalMailDeliveryError(report, claim.delivery);
  }

  try {
    await commitMailCompletion(job, processingLease, claim.delivery);
  } catch (error) {
    if (error instanceof EmailDeliveryAttemptLostError) throw error;
    let outcome: Awaited<ReturnType<typeof markEmailDeliveryOutcomeUnknown>>;
    try {
      outcome = await markEmailDeliveryOutcomeUnknown(claim.delivery);
    } catch (transitionError) {
      if (transitionError instanceof EmailDeliveryAttemptLostError) throw transitionError;
      if (error instanceof OutboxProcessingLeaseLostError) throw error;
      throw new TerminalMailDeliveryError(mailOutcomeUnknownError(), claim.delivery);
    }
    if (outcome === "complete") return;
    if (error instanceof OutboxProcessingLeaseLostError) throw error;
    throw new TerminalMailDeliveryError(mailOutcomeUnknownError(), claim.delivery);
  }
}

async function processOutboxJob(job: Job<OutboxJobData>): Promise<void> {
  let lease: Awaited<ReturnType<typeof acquireOutboxProcessingLease>> = null;
  try {
    const processingLease = await acquireOutboxProcessingLease(job.data.eventId);
    lease = processingLease;
    if (!processingLease) {
      await job.moveToDelayed(
        Date.now() + getServiceEnvironment().OUTBOX_LOCK_TIMEOUT_MS,
        job.token,
      );
      throw new DelayedError("Outbox event is already being processed");
    }

    if (isMailDeliveryTopic(job.data.topic)) {
      await processMailOutboxJob(job, processingLease);
    } else {
      const handler = getOutboxHandler(job.data.topic, job.data.version);
      await runDatabaseJobOnce(
        getPrismaClient(),
        {
          queueName: SYSTEM_QUEUE_NAME,
          jobName: job.name,
          idempotencyKey: `outbox-${job.data.eventId}`,
          onCompleted: async (transaction) => {
            await resolveWorkerFailure(job.id, transaction);
            await processingLease.assertCommit(transaction);
            await transaction.outboxEvent.updateMany({
              where: { id: job.data.eventId, processedAt: null },
              data: { processedAt: new Date() },
            });
          },
        },
        async (transaction) => {
          await processingLease.assertActive(transaction);
          return handler(transaction, job.data);
        },
      );
    }
  } catch (error) {
    if (
      error instanceof DelayedError ||
      (error instanceof Error && error.name === "DelayedError")
    ) {
      throw error;
    }
    if (error instanceof OutboxProcessingLeaseLostError) throw error;
    if (error instanceof EmailDeliveryAttemptLostError) throw error;
    const terminalMailFailure = error instanceof TerminalMailDeliveryError;
    const retryableMailFailure = error instanceof RetryableMailDeliveryError;
    const reportedError = terminalMailFailure
      ? error.report
      : retryableMailFailure
        ? error.report
        : isMailDeliveryTopic(job.data.topic)
          ? toSafeMailError(error)
          : error;
    const attempts = job.opts.attempts ?? 1;
    if (
      job.data.topic === TRUST_RECALCULATION_TOPIC &&
      job.attemptsMade + 1 >= attempts &&
      typeof job.data.payload.batchId === "string"
    ) {
      await markTrustRecalculationFailed(job.data.payload.batchId, reportedError);
    }
    await recordWorkerFailure(job, reportedError, job.attemptsMade + 1, {
      terminal: terminalMailFailure,
      mailAttempt: terminalMailFailure || retryableMailFailure ? error.attempt : undefined,
      processingLease: lease ?? undefined,
    });
    throw terminalMailFailure ? error : reportedError;
  } finally {
    await lease?.release();
  }
}

export function createOutboxWorker() {
  const environment = getServiceEnvironment();
  const connection = createBullRedisConnection();
  try {
    const worker = new Worker<OutboxJobData, void, typeof OUTBOX_JOB_NAME>(
      SYSTEM_QUEUE_NAME,
      processOutboxJob,
      {
        connection,
        concurrency: environment.WORKER_CONCURRENCY,
        prefix: getRedisKeyspaces().queue,
      },
    );

    return { worker, connection };
  } catch (error) {
    // The runtime cannot take ownership until both objects are returned. A synchronous BullMQ
    // constructor failure must therefore close the already-created Redis handle here.
    connection.disconnect();
    throw error;
  }
}
