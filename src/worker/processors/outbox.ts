import { Worker, type Job } from "bullmq";
import { createBullRedisConnection } from "@/infrastructure/cache/redis";
import { getRedisKeyspaces } from "@/infrastructure/cache/keys";
import { getPrismaClient } from "@/infrastructure/database/client";
import {
  OUTBOX_JOB_NAME,
  SYSTEM_QUEUE_NAME,
  type OutboxJobData,
} from "@/infrastructure/queue/contracts";
import { runDatabaseJobOnce } from "@/infrastructure/queue/idempotency";
import { getServiceEnvironment } from "@/shared/config/runtime-env";
import { getOutboxHandler } from "@/worker/registry";
import { recordWorkerFailure, resolveWorkerFailure } from "@/worker/failures.server";

async function processOutboxJob(job: Job<OutboxJobData>): Promise<void> {
  try {
    const handler = getOutboxHandler(job.data.topic, job.data.version);
    await runDatabaseJobOnce(
      getPrismaClient(),
      {
        queueName: SYSTEM_QUEUE_NAME,
        jobName: job.name,
        idempotencyKey: `outbox-${job.data.eventId}`,
      },
      (transaction) => handler(transaction, job.data),
    );
    await resolveWorkerFailure(job.id);
  } catch (error) {
    await recordWorkerFailure(job, error, job.attemptsMade + 1);
    throw error;
  }
}

export function createOutboxWorker() {
  const environment = getServiceEnvironment();
  const connection = createBullRedisConnection();
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
}
