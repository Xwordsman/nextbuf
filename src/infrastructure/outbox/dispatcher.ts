import { Prisma, type OutboxEvent } from "@/generated/prisma/client";
import type { JobsOptions } from "bullmq";
import { getPrismaClient } from "@/infrastructure/database/client";
import { isMailDeliveryTopic } from "@/infrastructure/mail/queue";
import { OUTBOX_JOB_NAME, SYSTEM_QUEUE_NAME } from "@/infrastructure/queue/contracts";
import { getSystemQueue } from "@/infrastructure/queue/system-queue";
import { getServiceEnvironment } from "@/shared/config/runtime-env";
import { getErrorMessage } from "@/shared/errors/error-message";

type DispatchResult = {
  dispatched: number;
  failed: number;
};

const OUTBOX_RETRY_BASE_MS = 1_000;
const OUTBOX_RETRY_MAX_MS = 60_000;

function retryAvailableAt(attempts: number, now = new Date()): Date {
  const exponent = Math.max(0, Math.min(attempts - 1, 16));
  const delay = Math.min(OUTBOX_RETRY_BASE_MS * 2 ** exponent, OUTBOX_RETRY_MAX_MS);
  return new Date(now.getTime() + delay);
}

export type OutboxRecoveryResult = {
  alreadyQueued: number;
  checked: number;
  failed: number;
  requeued: number;
};

export function outboxJobPrivacyOptions(
  topic: string,
  completeRetention: number,
  failedRetention: number,
): Pick<JobsOptions, "removeOnComplete" | "removeOnFail" | "stackTraceLimit"> {
  if (isMailDeliveryTopic(topic)) {
    return { removeOnComplete: true, removeOnFail: true, stackTraceLimit: 0 };
  }

  return {
    removeOnComplete: { count: completeRetention },
    removeOnFail: { count: failedRetention },
  };
}

function asJobPayload(event: OutboxEvent): Prisma.InputJsonObject {
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    throw new Error(`Outbox event ${event.id} payload must be a JSON object`);
  }

  return event.payload as Prisma.InputJsonObject;
}

async function enqueueOutboxEvent(event: OutboxEvent): Promise<void> {
  const environment = getServiceEnvironment();
  const queue = getSystemQueue();
  const existing = await queue.getJob(event.id);
  if (existing) {
    const state = await existing.getState();
    if (state === "completed" || state === "failed" || state === "unknown") {
      await existing.remove();
    } else {
      return;
    }
  }

  await queue.add(
    OUTBOX_JOB_NAME,
    {
      eventId: event.id,
      topic: event.topic,
      version: event.version,
      payload: asJobPayload(event),
    },
    {
      jobId: event.id,
      attempts: 5,
      backoff: { type: "exponential", delay: 1_000 },
      ...outboxJobPrivacyOptions(
        event.topic,
        environment.JOB_REMOVE_COMPLETE_AFTER,
        environment.JOB_REMOVE_FAILED_AFTER,
      ),
    },
  );
}

async function claimNextEvent(lockOwner: string): Promise<OutboxEvent | null> {
  const environment = getServiceEnvironment();
  const prisma = getPrismaClient();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - environment.OUTBOX_LOCK_TIMEOUT_MS);

  const claimed = await prisma.$queryRaw<OutboxEvent[]>(Prisma.sql`
    WITH "candidate" AS (
      SELECT "event"."id"
      FROM "outbox_events" AS "event"
      WHERE "event"."published_at" IS NULL
        AND "event"."available_at" <= ${now}
        AND (
          "event"."locked_at" IS NULL
          OR "event"."locked_at" <= ${staleBefore}
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "worker_job_failures" AS "failure"
          WHERE "failure"."queue_name" = ${SYSTEM_QUEUE_NAME}
            AND "failure"."job_id" = "event"."id"::text
            AND "failure"."resolved_at" IS NULL
            AND "failure"."replayed_at" IS NULL
        )
      ORDER BY "event"."available_at" ASC, "event"."occurred_at" ASC
      FOR UPDATE OF "event" SKIP LOCKED
      LIMIT 1
    )
    UPDATE "outbox_events" AS "event"
    SET
      "locked_at" = ${now},
      "lock_owner" = ${lockOwner},
      "attempts" = "event"."attempts" + 1,
      "last_error" = NULL,
      "updated_at" = ${now}
    FROM "candidate"
    WHERE "event"."id" = "candidate"."id"
      AND "event"."published_at" IS NULL
      AND (
        "event"."locked_at" IS NULL
        OR "event"."locked_at" <= ${staleBefore}
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "worker_job_failures" AS "failure"
        WHERE "failure"."queue_name" = ${SYSTEM_QUEUE_NAME}
          AND "failure"."job_id" = "event"."id"::text
          AND "failure"."resolved_at" IS NULL
          AND "failure"."replayed_at" IS NULL
      )
    RETURNING
      "event"."id",
      "event"."topic",
      "event"."version",
      "event"."payload",
      "event"."idempotency_key" AS "idempotencyKey",
      "event"."occurred_at" AS "occurredAt",
      "event"."available_at" AS "availableAt",
      "event"."published_at" AS "publishedAt",
      "event"."processed_at" AS "processedAt",
      "event"."locked_at" AS "lockedAt",
      "event"."lock_owner" AS "lockOwner",
      "event"."attempts",
      "event"."last_error" AS "lastError",
      "event"."created_at" AS "createdAt",
      "event"."updated_at" AS "updatedAt"
  `);

  return claimed[0] ?? null;
}

export async function dispatchOutboxBatch(lockOwner: string): Promise<DispatchResult> {
  const environment = getServiceEnvironment();
  const prisma = getPrismaClient();
  const result: DispatchResult = { dispatched: 0, failed: 0 };

  for (let index = 0; index < environment.OUTBOX_BATCH_SIZE; index += 1) {
    const event = await claimNextEvent(lockOwner);

    if (!event) {
      break;
    }

    try {
      await enqueueOutboxEvent(event);

      await prisma.outboxEvent.updateMany({
        where: { id: event.id, publishedAt: null },
        data: {
          publishedAt: new Date(),
          lastError: null,
        },
      });
      await prisma.outboxEvent.updateMany({
        where: { id: event.id, lockOwner },
        data: { lockedAt: null, lockOwner: null },
      });
      result.dispatched += 1;
    } catch (error) {
      await prisma.outboxEvent.updateMany({
        where: { id: event.id, lockOwner },
        data: {
          availableAt: retryAvailableAt(event.attempts),
          lockedAt: null,
          lockOwner: null,
          lastError: getErrorMessage(error).slice(0, 4_000),
        },
      });
      result.failed += 1;
    }
  }

  return result;
}

async function claimRecoverableEvents(lockOwner: string, now: Date): Promise<OutboxEvent[]> {
  const environment = getServiceEnvironment();
  const prisma = getPrismaClient();
  const recoverBefore = new Date(now.getTime() - environment.OUTBOX_RECOVERY_AFTER_MS);
  const staleBefore = new Date(now.getTime() - environment.OUTBOX_LOCK_TIMEOUT_MS);
  const recoveryOwner = `outbox-recovery:${lockOwner}`.slice(0, 160);

  return prisma.$queryRaw<OutboxEvent[]>(Prisma.sql`
    WITH "candidates" AS (
      SELECT "event"."id"
      FROM "outbox_events" AS "event"
      WHERE "event"."published_at" IS NOT NULL
        AND "event"."published_at" <= ${recoverBefore}
        AND "event"."processed_at" IS NULL
        AND (
          "event"."locked_at" IS NULL
          OR "event"."locked_at" <= ${staleBefore}
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "worker_job_failures" AS "failure"
          WHERE "failure"."queue_name" = ${SYSTEM_QUEUE_NAME}
            AND "failure"."job_id" = "event"."id"::text
            AND "failure"."resolved_at" IS NULL
            AND "failure"."replayed_at" IS NULL
        )
      ORDER BY "event"."published_at" ASC, "event"."occurred_at" ASC
      FOR UPDATE OF "event" SKIP LOCKED
      LIMIT ${environment.OUTBOX_BATCH_SIZE}
    )
    UPDATE "outbox_events" AS "event"
    SET
      "locked_at" = ${now},
      "lock_owner" = ${recoveryOwner},
      "attempts" = "event"."attempts" + 1,
      "last_error" = NULL,
      "updated_at" = ${now}
    FROM "candidates"
    WHERE "event"."id" = "candidates"."id"
    RETURNING
      "event"."id",
      "event"."topic",
      "event"."version",
      "event"."payload",
      "event"."idempotency_key" AS "idempotencyKey",
      "event"."occurred_at" AS "occurredAt",
      "event"."available_at" AS "availableAt",
      "event"."published_at" AS "publishedAt",
      "event"."processed_at" AS "processedAt",
      "event"."locked_at" AS "lockedAt",
      "event"."lock_owner" AS "lockOwner",
      "event"."attempts",
      "event"."last_error" AS "lastError",
      "event"."created_at" AS "createdAt",
      "event"."updated_at" AS "updatedAt"
  `);
}

export async function recoverPublishedOutboxBatch(
  lockOwner: string,
  now = new Date(),
): Promise<OutboxRecoveryResult> {
  const prisma = getPrismaClient();
  const queue = getSystemQueue();
  const events = await claimRecoverableEvents(lockOwner, now);
  const result: OutboxRecoveryResult = {
    alreadyQueued: 0,
    checked: events.length,
    failed: 0,
    requeued: 0,
  };

  for (const event of events) {
    try {
      const existing = await queue.getJob(event.id);
      if (existing) {
        const state = await existing.getState();
        if (state === "completed" || state === "failed" || state === "unknown") {
          await existing.remove();
          await enqueueOutboxEvent(event);
          result.requeued += 1;
        } else {
          result.alreadyQueued += 1;
        }
      } else {
        await enqueueOutboxEvent(event);
        result.requeued += 1;
      }

      await prisma.outboxEvent.updateMany({
        where: { id: event.id, publishedAt: { not: null } },
        data: { publishedAt: now, lastError: null },
      });
      await prisma.outboxEvent.updateMany({
        where: { id: event.id, lockOwner: event.lockOwner },
        data: { lockedAt: null, lockOwner: null },
      });
    } catch (error) {
      await prisma.outboxEvent.updateMany({
        where: { id: event.id, lockOwner: event.lockOwner },
        data: {
          publishedAt: null,
          availableAt: retryAvailableAt(event.attempts),
          lockedAt: null,
          lockOwner: null,
          lastError: getErrorMessage(error).slice(0, 4_000),
        },
      });
      result.failed += 1;
    }
  }

  return result;
}
