import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type { JobType } from "bullmq";
import { getRedisClient } from "@/infrastructure/cache/redis";
import { getPrismaClient } from "@/infrastructure/database/client";
import { isMailDeliveryTopic } from "@/infrastructure/mail/queue";
import { SYSTEM_QUEUE_NAME } from "@/infrastructure/queue/contracts";
import { getSystemQueue } from "@/infrastructure/queue/system-queue";
import { getServiceEnvironment } from "@/shared/config/runtime-env";

export const MAIL_QUEUE_PRIVACY_MIGRATION_KEY = "worker.mail_queue_privacy.v1";

const CLAIM_LEASE_MS = 120_000;
const CLAIM_HEARTBEAT_MS = Math.floor(CLAIM_LEASE_MS / 3);
const CLAIM_POLL_MS = 250;
const JOB_SCAN_PAGE_SIZE = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JOB_TYPES: JobType[] = [
  "wait",
  "paused",
  "active",
  "delayed",
  "prioritized",
  "waiting-children",
  "completed",
  "failed",
];

type MailQueuePrivacyMigrationResult = {
  alreadyCompleted: boolean;
  removedJobs: number;
  resetOutboxEvents: number;
  trimmedEvents: number;
};

function completedMigration(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).status === "complete"
  );
}

async function tryClaimMigration(owner: string, now: Date): Promise<boolean> {
  const leaseUntil = new Date(now.getTime() + CLAIM_LEASE_MS).toISOString();
  const claimed = await getPrismaClient().$queryRaw<Array<{ key: string }>>(Prisma.sql`
    INSERT INTO "system_state" ("key", "value", "created_at", "updated_at")
    VALUES (
      ${MAIL_QUEUE_PRIVACY_MIGRATION_KEY},
      jsonb_build_object(
        'status', 'running',
        'owner', ${owner}::text,
        'startedAt', ${now.toISOString()}::text,
        'leaseUntil', ${leaseUntil}::text
      ),
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("key") DO UPDATE
    SET
      "value" = EXCLUDED."value",
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "system_state"."value"->>'status' IS DISTINCT FROM 'complete'
      AND (
        "system_state"."value"->>'status' IS DISTINCT FROM 'running'
        OR COALESCE("system_state"."value"->>'leaseUntil', '') <= ${now.toISOString()}
      )
    RETURNING "key"
  `);
  return claimed.length === 1;
}

async function claimMigration(owner: string): Promise<"claimed" | "complete"> {
  for (;;) {
    const state = await getPrismaClient().systemState.findUnique({
      where: { key: MAIL_QUEUE_PRIVACY_MIGRATION_KEY },
      select: { value: true },
    });
    if (completedMigration(state?.value)) return "complete";
    if (await tryClaimMigration(owner, new Date())) return "claimed";
    await new Promise((resolve) => setTimeout(resolve, CLAIM_POLL_MS));
  }
}

async function renewMigrationClaim(owner: string): Promise<boolean> {
  const leaseUntil = new Date(Date.now() + CLAIM_LEASE_MS).toISOString();
  const updated = await getPrismaClient().$executeRaw(Prisma.sql`
    UPDATE "system_state"
    SET
      "value" = jsonb_set("value", '{leaseUntil}', to_jsonb(${leaseUntil}::text)),
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "key" = ${MAIL_QUEUE_PRIVACY_MIGRATION_KEY}
      AND "value"->>'status' = 'running'
      AND "value"->>'owner' = ${owner}
  `);
  return updated === 1;
}

async function resetRemovedMailOutboxEvents(eventIds: string[]): Promise<number> {
  const uniqueIds = [...new Set(eventIds.filter((eventId) => UUID_PATTERN.test(eventId)))];
  let reset = 0;

  for (let offset = 0; offset < uniqueIds.length; offset += JOB_SCAN_PAGE_SIZE) {
    const batch = uniqueIds.slice(offset, offset + JOB_SCAN_PAGE_SIZE);
    const rows = await getPrismaClient().$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "outbox_events" AS "event"
      SET
        "published_at" = NULL,
        "processed_at" = NULL,
        "available_at" = LEAST("event"."available_at", CURRENT_TIMESTAMP),
        "locked_at" = NULL,
        "lock_owner" = NULL,
        "last_error" = NULL,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "event"."id" IN (
        ${Prisma.join(batch.map((eventId) => Prisma.sql`${eventId}::uuid`))}
      )
        AND NOT EXISTS (
          SELECT 1
          FROM "processed_jobs" AS "processed"
          WHERE "processed"."queue_name" = ${SYSTEM_QUEUE_NAME}
            AND "processed"."idempotency_key" = 'outbox-' || "event"."id"::text
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "worker_job_failures" AS "failure"
          WHERE "failure"."queue_name" = ${SYSTEM_QUEUE_NAME}
            AND "failure"."job_id" = "event"."id"::text
            AND "failure"."resolved_at" IS NULL
        )
      RETURNING "event"."id"
    `);
    reset += rows.length;
  }

  return reset;
}

async function removeLegacyMailJobs(): Promise<{
  removedJobs: number;
  resetOutboxEvents: number;
}> {
  const queue = getSystemQueue();
  const removedJobIds = new Set<string>();
  let resetOutboxEvents = 0;

  const removeJob = async (jobId: string): Promise<void> => {
    const deadline = Date.now() + getServiceEnvironment().OUTBOX_LOCK_TIMEOUT_MS * 2;
    for (;;) {
      const current = await queue.getJob(jobId);
      if (!current) return;
      try {
        await current.remove();
        return;
      } catch (error) {
        if (
          (await current.getState().catch(() => "unknown")) !== "active" ||
          Date.now() >= deadline
        ) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, CLAIM_POLL_MS));
      }
    }
  };

  for (;;) {
    const removedEventIds: string[] = [];
    let removedInPass = 0;

    for (const type of JOB_TYPES) {
      let start = 0;
      for (;;) {
        const jobs = await queue.getJobs(type, start, start + JOB_SCAN_PAGE_SIZE - 1, true);
        if (jobs.length === 0) break;

        let retained = 0;
        for (const job of jobs) {
          const topic = job.data?.topic;
          if (typeof topic === "string" && !isMailDeliveryTopic(topic)) {
            retained += 1;
            continue;
          }

          if (!job.id) throw new Error("BullMQ job is missing its identifier");
          await removeJob(job.id);
          removedInPass += 1;
          removedJobIds.add(job.id);
          if (typeof job.data.eventId === "string") removedEventIds.push(job.data.eventId);
        }
        start += retained;
      }
    }

    resetOutboxEvents += await resetRemovedMailOutboxEvents(removedEventIds);
    if (removedInPass === 0) break;
  }

  return { removedJobs: removedJobIds.size, resetOutboxEvents };
}

async function markMigrationRequired(owner: string): Promise<void> {
  await getPrismaClient().$executeRaw(Prisma.sql`
    UPDATE "system_state"
    SET
      "value" = jsonb_build_object(
        'status', 'required',
        'lastFailedAt', ${new Date().toISOString()}::text
      ),
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "key" = ${MAIL_QUEUE_PRIVACY_MIGRATION_KEY}
      AND "value"->>'owner' = ${owner}
  `);
}

async function markMigrationComplete(
  owner: string,
  result: Omit<MailQueuePrivacyMigrationResult, "alreadyCompleted">,
): Promise<void> {
  const updated = await getPrismaClient().$executeRaw(Prisma.sql`
    UPDATE "system_state"
    SET
      "value" = jsonb_build_object(
        'status', 'complete',
        'completedAt', ${new Date().toISOString()}::text,
        'removedJobs', ${result.removedJobs}::integer,
        'resetOutboxEvents', ${result.resetOutboxEvents}::integer,
        'trimmedEvents', ${result.trimmedEvents}::integer
      ),
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "key" = ${MAIL_QUEUE_PRIVACY_MIGRATION_KEY}
      AND "value"->>'owner' = ${owner}
  `);
  if (updated !== 1) throw new Error("Mail queue privacy migration lease was lost");
}

export async function ensureMailQueuePrivacyMigration(
  owner = `mail-privacy:${process.pid}:${randomUUID()}`,
): Promise<MailQueuePrivacyMigrationResult> {
  if ((await claimMigration(owner)) === "complete") {
    return { alreadyCompleted: true, removedJobs: 0, resetOutboxEvents: 0, trimmedEvents: 0 };
  }

  const queue = getSystemQueue();
  let leaseLost = false;
  let heartbeatWork = Promise.resolve();
  const heartbeat = setInterval(() => {
    heartbeatWork = heartbeatWork
      .then(async () => {
        if (!(await renewMigrationClaim(owner))) leaseLost = true;
      })
      .catch(() => {
        leaseLost = true;
      });
  }, CLAIM_HEARTBEAT_MS);
  heartbeat.unref();
  try {
    const removed = await removeLegacyMailJobs();
    let trimmedEvents = await queue.trimEvents(0);
    const eventsKey = queue.keys.events;
    if (!eventsKey) throw new Error("BullMQ events key is unavailable");
    const redis = getRedisClient();
    const remainingEvents = await redis.xlen(eventsKey);
    if (remainingEvents > 0) {
      await redis.del(eventsKey);
      trimmedEvents += remainingEvents;
    }

    clearInterval(heartbeat);
    await heartbeatWork;
    if (leaseLost) throw new Error("Mail queue privacy migration lease was lost");
    const result = { ...removed, trimmedEvents };
    await markMigrationComplete(owner, result);
    return { alreadyCompleted: false, ...result };
  } catch (error) {
    clearInterval(heartbeat);
    await heartbeatWork;
    await markMigrationRequired(owner).catch(() => undefined);
    throw error;
  } finally {
    clearInterval(heartbeat);
    await heartbeatWork;
  }
}
