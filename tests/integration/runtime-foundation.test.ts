import type IORedis from "ioredis";
import { Worker } from "bullmq";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { doctor } from "@/cli/commands/doctor";
import { setup } from "@/cli/commands/setup";
import {
  createBullRedisConnection,
  getRedisClient,
  disconnectRedisClient,
} from "@/infrastructure/cache/redis";
import { getRedisKeyspaces } from "@/infrastructure/cache/keys";
import { disconnectPrismaClient, getPrismaClient } from "@/infrastructure/database/client";
import { Prisma } from "@/generated/prisma/client";
import { checkDatabaseHealth } from "@/infrastructure/database/health";
import { IDENTITY_EMAIL_TOPIC } from "@/infrastructure/mail/queue";
import { createOutboxEvent } from "@/infrastructure/outbox/create-event";
import { getOperationalCapacity } from "@/infrastructure/operations/capacity.server";
import {
  dispatchOutboxBatch,
  recoverPublishedOutboxBatch,
} from "@/infrastructure/outbox/dispatcher";
import { acquireOutboxProcessingLease } from "@/infrastructure/outbox/processing-lease";
import {
  ensureMailQueuePrivacyMigration,
  MAIL_QUEUE_PRIVACY_MIGRATION_KEY,
} from "@/infrastructure/queue/mail-privacy-migration";
import {
  OUTBOX_JOB_NAME,
  RUNTIME_PROBE_TOPIC,
  SYSTEM_QUEUE_NAME,
  type OutboxJobData,
} from "@/infrastructure/queue/contracts";
import { closeSystemQueue, getSystemQueue } from "@/infrastructure/queue/system-queue";
import { WORKER_MAINTENANCE_TASK } from "@/worker/contracts";
import { createOutboxWorker } from "@/worker/processors/outbox";
import { ensureWorkerScheduledTasks, runScheduledTasks } from "@/worker/scheduler.server";

async function waitFor(assertion: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await assertion()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

async function closeWorker(worker: ReturnType<typeof createOutboxWorker>): Promise<void> {
  await worker.worker.close();
  if (worker.connection.status !== "end") {
    await worker.connection.quit();
  }
}

describe("PostgreSQL, Redis, Outbox and Worker integration", () => {
  let redis: IORedis;

  beforeAll(async () => {
    await setup();
    await setup();

    const prisma = getPrismaClient();
    redis = getRedisClient();
    await redis.flushdb();
    await prisma.processedJob.deleteMany();
    await prisma.outboxEvent.deleteMany();
    await prisma.workerHeartbeat.deleteMany();
    await prisma.systemState.deleteMany({ where: { key: { startsWith: "test." } } });
  });

  afterAll(async () => {
    await closeSystemQueue();
    await disconnectRedisClient();
    await disconnectPrismaClient();
  });

  it("reports the PostgreSQL 18 migration as ready", async () => {
    await expect(checkDatabaseHealth()).resolves.toMatchObject({ ok: true });
  });

  it("keeps public foreign keys backed by valid leading-column indexes", async () => {
    const missing = await getPrismaClient().$queryRaw<
      Array<{ tableName: string; constraintName: string }>
    >(
      Prisma.sql`
        SELECT
          "constraint"."conrelid"::regclass::text AS "tableName",
          "constraint"."conname" AS "constraintName"
        FROM "pg_constraint" AS "constraint"
        JOIN "pg_namespace" AS "namespace"
          ON "namespace"."oid" = "constraint"."connamespace"
        WHERE "constraint"."contype" = 'f'
          AND "namespace"."nspname" = 'public'
          AND cardinality("constraint"."conkey") = 1
          AND NOT EXISTS (
            SELECT 1
            FROM "pg_index" AS "index"
            WHERE "index"."indrelid" = "constraint"."conrelid"
              AND "index"."indisvalid"
              AND "index"."indisready"
              AND split_part("index"."indkey"::text, ' ', 1)::smallint = "constraint"."conkey"[1]
          )
        ORDER BY "tableName", "constraintName"
      `,
    );
    expect(missing).toEqual([]);
  });

  it("keeps the pending Outbox recovery index valid and partial", async () => {
    const indexes = await getPrismaClient().$queryRaw<
      Array<{ indisready: boolean; indisvalid: boolean; predicate: string | null }>
    >(Prisma.sql`
      SELECT
        "index"."indisready",
        "index"."indisvalid",
        pg_get_expr("index"."indpred", "index"."indrelid") AS "predicate"
      FROM "pg_index" AS "index"
      INNER JOIN "pg_class" AS "class" ON "class"."oid" = "index"."indexrelid"
      WHERE "class"."relname" = 'outbox_events_recovery_pending_idx'
    `);

    expect(indexes).toHaveLength(1);
    expect(indexes[0]).toMatchObject({ indisready: true, indisvalid: true });
    expect(indexes[0]?.predicate).toContain("processed_at IS NULL");
    expect(indexes[0]?.predicate).toContain("published_at IS NOT NULL");
  });

  it("reports database, Redis, queue and configured capacity without secrets", async () => {
    const capacity = await getOperationalCapacity();
    expect(capacity.database).toMatchObject({
      configuredPoolSizePerProcess: 10,
      statementTimeoutMs: 15_000,
    });
    expect(capacity.database.sizeBytes).toBeGreaterThan(0);
    expect(capacity.database.maxConnections).toBeGreaterThan(0);
    expect(capacity.redis.usedMemoryBytes).toBeGreaterThan(0);
    expect(capacity.worker).toMatchObject({ concurrencyPerProcess: 5, outboxBatchSize: 50 });
    expect(JSON.stringify(capacity)).not.toContain("nextbuf_test");
  });

  it("persists an Outbox intent and consumes it exactly once", async () => {
    const prisma = getPrismaClient();
    const worker = createOutboxWorker();
    await worker.worker.waitUntilReady();

    const event = await prisma.$transaction(async (transaction) => {
      await transaction.systemState.create({
        data: { key: "test.business_fact", value: { durable: true } },
      });

      return createOutboxEvent(transaction, {
        topic: RUNTIME_PROBE_TOPIC,
        idempotencyKey: "test-runtime-probe-1",
        payload: { source: "integration-test" },
      });
    });

    await expect(dispatchOutboxBatch("integration-dispatcher")).resolves.toEqual({
      dispatched: 1,
      failed: 0,
    });
    await expect(dispatchOutboxBatch("integration-dispatcher")).resolves.toEqual({
      dispatched: 0,
      failed: 0,
    });

    await waitFor(async () => {
      const processed = await prisma.processedJob.count({
        where: { idempotencyKey: `outbox-${event.id}` },
      });
      return processed === 1;
    });

    expect(
      await prisma.processedJob.count({ where: { idempotencyKey: `outbox-${event.id}` } }),
    ).toBe(1);
    expect(await prisma.outboxEvent.findUnique({ where: { id: event.id } })).toMatchObject({
      attempts: 1,
      lockOwner: null,
      processedAt: expect.any(Date),
    });

    await redis.flushdb();
    await expect(
      prisma.systemState.findUnique({ where: { key: "test.business_fact" } }),
    ).resolves.toMatchObject({ value: { durable: true } });

    await closeWorker(worker);
  });

  it("does not revisit durable completed Outbox history during recovery", async () => {
    const prisma = getPrismaClient();
    const completedAt = new Date(Date.now() - 10_000);
    const event = await createOutboxEvent(prisma, {
      topic: RUNTIME_PROBE_TOPIC,
      idempotencyKey: "test-runtime-durable-outbox-completion",
      payload: { source: "durable-outbox-completion-test" },
    });

    try {
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { publishedAt: completedAt, processedAt: completedAt },
      });

      await expect(
        recoverPublishedOutboxBatch("completed-history-recovery", new Date()),
      ).resolves.toEqual({ alreadyQueued: 0, checked: 0, failed: 0, requeued: 0 });
      await expect(getSystemQueue().getJob(event.id)).resolves.toBeUndefined();
      await expect(
        prisma.processedJob.count({
          where: { queueName: SYSTEM_QUEUE_NAME, idempotencyKey: `outbox-${event.id}` },
        }),
      ).resolves.toBe(0);
    } finally {
      await prisma.outboxEvent.deleteMany({ where: { id: event.id } });
    }
  });

  it("fills a missing completion marker from an existing ProcessedJob without rerunning work", async () => {
    const prisma = getPrismaClient();
    const queue = getSystemQueue();
    const probeKey = "runtime.last_probe";
    const previousProbe = await prisma.systemState.findUnique({ where: { key: probeKey } });
    await prisma.systemState.upsert({
      where: { key: probeKey },
      create: { key: probeKey, value: { source: "existing-processed-job-baseline" } },
      update: { value: { source: "existing-processed-job-baseline" } },
    });
    const event = await createOutboxEvent(prisma, {
      topic: RUNTIME_PROBE_TOPIC,
      idempotencyKey: "test-runtime-existing-processed-job",
      payload: { source: "handler-must-not-run" },
    });
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { publishedAt: new Date(Date.now() - 10_000) },
    });
    await prisma.processedJob.create({
      data: {
        queueName: SYSTEM_QUEUE_NAME,
        jobName: OUTBOX_JOB_NAME,
        idempotencyKey: `outbox-${event.id}`,
      },
    });
    const worker = createOutboxWorker();

    try {
      await worker.worker.waitUntilReady();
      await expect(
        recoverPublishedOutboxBatch("existing-processed-job-recovery", new Date()),
      ).resolves.toEqual({ alreadyQueued: 0, checked: 1, failed: 0, requeued: 1 });
      await waitFor(async () => {
        const current = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
        return current.processedAt !== null;
      });

      await expect(
        prisma.systemState.findUniqueOrThrow({ where: { key: probeKey } }),
      ).resolves.toMatchObject({ value: { source: "existing-processed-job-baseline" } });
      await expect(
        prisma.processedJob.count({
          where: { queueName: SYSTEM_QUEUE_NAME, idempotencyKey: `outbox-${event.id}` },
        }),
      ).resolves.toBe(1);
      await expect(
        recoverPublishedOutboxBatch(
          "existing-processed-job-completed-recovery",
          new Date(Date.now() + 10_000),
        ),
      ).resolves.toEqual({ alreadyQueued: 0, checked: 0, failed: 0, requeued: 0 });
    } finally {
      await closeWorker(worker);
      await (await queue.getJob(event.id))?.remove();
      await prisma.processedJob.deleteMany({
        where: { queueName: SYSTEM_QUEUE_NAME, idempotencyKey: `outbox-${event.id}` },
      });
      await prisma.outboxEvent.deleteMany({ where: { id: event.id } });
      if (previousProbe) {
        const previousValue = previousProbe.value === null ? Prisma.JsonNull : previousProbe.value;
        await prisma.systemState.upsert({
          where: { key: probeKey },
          create: { key: probeKey, value: previousValue },
          update: { value: previousValue },
        });
      } else {
        await prisma.systemState.deleteMany({ where: { key: probeKey } });
      }
    }
  });

  it("automatically recovers a published but unprocessed Outbox event after Redis is cleared", async () => {
    const prisma = getPrismaClient();
    const event = await createOutboxEvent(prisma, {
      topic: RUNTIME_PROBE_TOPIC,
      idempotencyKey: "test-runtime-redis-loss-recovery",
      payload: { source: "redis-loss-recovery-test" },
    });

    await expect(dispatchOutboxBatch("redis-loss-publisher")).resolves.toEqual({
      dispatched: 1,
      failed: 0,
    });
    await expect(
      prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
    ).resolves.toEqual(expect.objectContaining({ publishedAt: expect.any(Date), lockOwner: null }));
    await expect(
      prisma.processedJob.count({ where: { idempotencyKey: `outbox-${event.id}` } }),
    ).resolves.toBe(0);
    await expect(getSystemQueue().getJob(event.id)).resolves.toBeDefined();

    await redis.flushdb();
    await expect(getSystemQueue().getJob(event.id)).resolves.toBeUndefined();
    const activeProcessing = await acquireOutboxProcessingLease(event.id);
    expect(activeProcessing).not.toBeNull();
    await expect(acquireOutboxProcessingLease(event.id)).resolves.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    await ensureWorkerScheduledTasks();
    await prisma.workerScheduledTask.updateMany({
      data: {
        nextRunAt: new Date(Date.now() + 86_400_000),
        lockedAt: null,
        lockOwner: null,
      },
    });
    await prisma.workerScheduledTask.update({
      where: { name: WORKER_MAINTENANCE_TASK },
      data: { nextRunAt: new Date(0) },
    });
    await expect(runScheduledTasks("redis-loss-while-active-worker")).resolves.toBe(1);
    await expect(
      prisma.processedJob.count({ where: { idempotencyKey: `outbox-${event.id}` } }),
    ).resolves.toBe(0);
    await expect(getSystemQueue().getJob(event.id)).resolves.toBeUndefined();

    await activeProcessing?.release();
    await prisma.workerScheduledTask.update({
      where: { name: WORKER_MAINTENANCE_TASK },
      data: { nextRunAt: new Date(0) },
    });

    const worker = createOutboxWorker();
    await worker.worker.waitUntilReady();
    await expect(runScheduledTasks("redis-loss-recovery-worker")).resolves.toBe(1);
    await waitFor(async () => {
      return (
        (await prisma.processedJob.count({
          where: { idempotencyKey: `outbox-${event.id}` },
        })) === 1
      );
    });

    await expect(
      prisma.systemState.findUniqueOrThrow({
        where: { key: `worker.last_task.${WORKER_MAINTENANCE_TASK}` },
      }),
    ).resolves.toMatchObject({
      value: {
        outboxRecovery: { alreadyQueued: 0, checked: 1, failed: 0, requeued: 1 },
      },
    });
    await expect(
      prisma.processedJob.count({ where: { idempotencyKey: `outbox-${event.id}` } }),
    ).resolves.toBe(1);
    await expect(
      prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
    ).resolves.toEqual(
      expect.objectContaining({
        attempts: 2,
        lockOwner: null,
        processedAt: expect.any(Date),
        publishedAt: expect.any(Date),
      }),
    );

    await closeWorker(worker);
  });

  it("replaces a terminal Redis job when PostgreSQL has no completed processing fact", async () => {
    const prisma = getPrismaClient();
    const event = await createOutboxEvent(prisma, {
      topic: RUNTIME_PROBE_TOPIC,
      idempotencyKey: "test-runtime-terminal-job-recovery",
      payload: { source: "terminal-job-recovery-test" },
    });
    const connection = createBullRedisConnection();
    const incompleteWorker = new Worker(SYSTEM_QUEUE_NAME, async () => undefined, {
      connection,
      prefix: getRedisKeyspaces().queue,
    });

    try {
      await incompleteWorker.waitUntilReady();
      await expect(dispatchOutboxBatch("terminal-job-publisher")).resolves.toMatchObject({
        dispatched: 1,
        failed: 0,
      });
      await waitFor(async () => {
        const job = await getSystemQueue().getJob(event.id);
        return (await job?.getState()) === "completed";
      });
      await incompleteWorker.close();
      if (connection.status !== "end") await connection.quit();

      await expect(
        recoverPublishedOutboxBatch("terminal-job-recovery", new Date(Date.now() + 2_000)),
      ).resolves.toEqual({ alreadyQueued: 0, checked: 1, failed: 0, requeued: 1 });
      await expect((await getSystemQueue().getJob(event.id))?.getState()).resolves.toBe("waiting");

      const worker = createOutboxWorker();
      await worker.worker.waitUntilReady();
      await waitFor(async () =>
        Boolean(
          await prisma.processedJob.findUnique({
            where: {
              queueName_idempotencyKey: {
                queueName: SYSTEM_QUEUE_NAME,
                idempotencyKey: `outbox-${event.id}`,
              },
            },
          }),
        ),
      );
      await closeWorker(worker);
    } finally {
      await incompleteWorker.close().catch(() => undefined);
      if (connection.status !== "end") await connection.quit().catch(() => undefined);
      await (await getSystemQueue().getJob(event.id))?.remove();
      await prisma.processedJob.deleteMany({
        where: { queueName: SYSTEM_QUEUE_NAME, idempotencyKey: `outbox-${event.id}` },
      });
      await prisma.outboxEvent.deleteMany({ where: { id: event.id } });
    }
  });

  it("replaces a terminal Redis job during ordinary dispatch after replay resets publication", async () => {
    const prisma = getPrismaClient();
    const event = await createOutboxEvent(prisma, {
      topic: RUNTIME_PROBE_TOPIC,
      idempotencyKey: "test-runtime-terminal-job-replay-dispatch",
      payload: { source: "terminal-job-replay-dispatch-test" },
    });
    const connection = createBullRedisConnection();
    const incompleteWorker = new Worker(SYSTEM_QUEUE_NAME, async () => undefined, {
      connection,
      prefix: getRedisKeyspaces().queue,
    });

    try {
      await incompleteWorker.waitUntilReady();
      await expect(dispatchOutboxBatch("terminal-job-replay-first-publisher")).resolves.toEqual({
        dispatched: 1,
        failed: 0,
      });
      await waitFor(async () => {
        const job = await getSystemQueue().getJob(event.id);
        return (await job?.getState()) === "completed";
      });
      await incompleteWorker.close();
      if (connection.status !== "end") await connection.quit();

      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { publishedAt: null, processedAt: null, availableAt: new Date() },
      });
      await expect(dispatchOutboxBatch("terminal-job-replay-second-publisher")).resolves.toEqual({
        dispatched: 1,
        failed: 0,
      });
      await expect((await getSystemQueue().getJob(event.id))?.getState()).resolves.toBe("waiting");
    } finally {
      await incompleteWorker.close().catch(() => undefined);
      if (connection.status !== "end") await connection.quit().catch(() => undefined);
      await (await getSystemQueue().getJob(event.id))?.remove();
      await prisma.processedJob.deleteMany({
        where: { queueName: SYSTEM_QUEUE_NAME, idempotencyKey: `outbox-${event.id}` },
      });
      await prisma.outboxEvent.deleteMany({ where: { id: event.id } });
    }
  });

  it("does not requeue a final failed job when publication confirmation was interrupted", async () => {
    const prisma = getPrismaClient();
    const queue = getSystemQueue();
    const event = await createOutboxEvent(prisma, {
      topic: "nextbuf.test.interrupted-publication-final-failure",
      idempotencyKey: "test-runtime-interrupted-publication-final-failure",
      payload: { source: "interrupted-publication-final-failure-test" },
      availableAt: new Date(0),
    });
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { attempts: 1, lockedAt: new Date(), lockOwner: "interrupted-dispatcher" },
    });
    const worker = createOutboxWorker();
    let workerClosed = false;

    try {
      await worker.worker.waitUntilReady();
      await queue.add(
        OUTBOX_JOB_NAME,
        {
          eventId: event.id,
          topic: event.topic,
          version: event.version,
          payload: event.payload as Prisma.InputJsonObject,
        },
        { attempts: 1, jobId: event.id, removeOnComplete: false, removeOnFail: false },
      );
      await waitFor(async () => {
        const job = await queue.getJob(event.id);
        return (await job?.getState()) === "failed";
      });
      await waitFor(async () =>
        Boolean(
          await prisma.workerJobFailure.findUnique({
            where: { queueName_jobId: { queueName: SYSTEM_QUEUE_NAME, jobId: event.id } },
          }),
        ),
      );
      await closeWorker(worker);
      workerClosed = true;

      await expect(
        prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
      ).resolves.toMatchObject({
        attempts: 1,
        lockedAt: null,
        lockOwner: null,
        publishedAt: null,
      });
      await expect(dispatchOutboxBatch("interrupted-publication-final-failure")).resolves.toEqual({
        dispatched: 0,
        failed: 0,
      });
      await expect(
        prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
      ).resolves.toMatchObject({
        attempts: 1,
        lockedAt: null,
        lockOwner: null,
        publishedAt: null,
      });
      await expect((await queue.getJob(event.id))?.getState()).resolves.toBe("failed");
      await expect(
        prisma.workerJobFailure.findUniqueOrThrow({
          where: { queueName_jobId: { queueName: SYSTEM_QUEUE_NAME, jobId: event.id } },
        }),
      ).resolves.toMatchObject({ replayedAt: null, resolvedAt: null });
    } finally {
      if (!workerClosed) await closeWorker(worker);
      await (await queue.getJob(event.id))?.remove();
      await prisma.workerJobFailure.deleteMany({
        where: { queueName: SYSTEM_QUEUE_NAME, jobId: event.id },
      });
      await prisma.outboxEvent.deleteMany({ where: { id: event.id } });
    }
  });

  it("delays a duplicate delivery until the PostgreSQL processing lease is released", async () => {
    const prisma = getPrismaClient();
    const event = await createOutboxEvent(prisma, {
      topic: RUNTIME_PROBE_TOPIC,
      idempotencyKey: "test-runtime-processing-lease-contention",
      payload: { source: "processing-lease-contention-test" },
    });
    await expect(dispatchOutboxBatch("processing-lease-publisher")).resolves.toMatchObject({
      dispatched: 1,
      failed: 0,
    });
    const heldLease = await acquireOutboxProcessingLease(event.id);
    expect(heldLease).not.toBeNull();
    const worker = createOutboxWorker();

    try {
      await worker.worker.waitUntilReady();
      await waitFor(async () => {
        const job = await getSystemQueue().getJob(event.id);
        return (await job?.getState()) === "delayed";
      });
      await expect(
        prisma.processedJob.count({
          where: { queueName: SYSTEM_QUEUE_NAME, idempotencyKey: `outbox-${event.id}` },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.workerJobFailure.count({
          where: { queueName: SYSTEM_QUEUE_NAME, jobId: event.id, resolvedAt: null },
        }),
      ).resolves.toBe(0);

      await heldLease?.release();
      await waitFor(async () =>
        Boolean(
          await prisma.processedJob.findUnique({
            where: {
              queueName_idempotencyKey: {
                queueName: SYSTEM_QUEUE_NAME,
                idempotencyKey: `outbox-${event.id}`,
              },
            },
          }),
        ),
      );
    } finally {
      await heldLease?.release();
      await closeWorker(worker);
      await (await getSystemQueue().getJob(event.id))?.remove();
      await prisma.workerJobFailure.deleteMany({
        where: { queueName: SYSTEM_QUEUE_NAME, jobId: event.id },
      });
      await prisma.processedJob.deleteMany({
        where: { queueName: SYSTEM_QUEUE_NAME, idempotencyKey: `outbox-${event.id}` },
      });
      await prisma.outboxEvent.deleteMany({ where: { id: event.id } });
    }
  });

  it("fences a handler that loses its processing lease without recording a false failure", async () => {
    const prisma = getPrismaClient();
    const queue = getSystemQueue();
    const probeKey = "runtime.last_probe";
    await prisma.systemState.upsert({
      where: { key: probeKey },
      create: { key: probeKey, value: { source: "lease-fence-baseline" } },
      update: { value: { source: "lease-fence-baseline" } },
    });

    let signalBlockerLocked!: () => void;
    let releaseBlocker!: () => void;
    const blockerLocked = new Promise<void>((resolve) => {
      signalBlockerLocked = resolve;
    });
    const blockerRelease = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const blocker = prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw(
          Prisma.sql`SELECT "key" FROM "system_state" WHERE "key" = ${probeKey} FOR UPDATE`,
        );
        signalBlockerLocked();
        await blockerRelease;
      },
      { timeout: 15_000 },
    );
    await blockerLocked;

    const event = await createOutboxEvent(prisma, {
      topic: RUNTIME_PROBE_TOPIC,
      idempotencyKey: "test-runtime-processing-lease-fence",
      payload: { source: "processing-lease-fence-test" },
    });
    const worker = createOutboxWorker();

    try {
      await worker.worker.waitUntilReady();
      await queue.add(
        OUTBOX_JOB_NAME,
        {
          eventId: event.id,
          topic: event.topic,
          version: event.version,
          payload: event.payload as Prisma.InputJsonObject,
        },
        { attempts: 1, jobId: event.id, removeOnComplete: false, removeOnFail: false },
      );
      await waitFor(async () => {
        const current = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
        return current.lockOwner?.startsWith("outbox-processing:") === true;
      });
      await waitFor(async () => {
        const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>(Prisma.sql`
          SELECT EXISTS (
            SELECT 1
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND wait_event_type = 'Lock'
              AND query ILIKE '%system_state%'
          ) AS "waiting"
        `);
        return rows[0]?.waiting === true;
      });

      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          lockOwner: "outbox-processing:forced-takeover",
          lockedAt: new Date(Date.now() + 60_000),
        },
      });
      releaseBlocker();
      await blocker;

      await waitFor(async () => {
        const job = await queue.getJob(event.id);
        return (await job?.getState()) === "failed";
      });
      await expect(
        prisma.processedJob.count({
          where: { queueName: SYSTEM_QUEUE_NAME, idempotencyKey: `outbox-${event.id}` },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.systemState.findUniqueOrThrow({ where: { key: probeKey } }),
      ).resolves.toMatchObject({ value: { source: "lease-fence-baseline" } });
      await expect(
        prisma.workerJobFailure.findUnique({
          where: { queueName_jobId: { queueName: SYSTEM_QUEUE_NAME, jobId: event.id } },
        }),
      ).resolves.toBeNull();
    } finally {
      releaseBlocker();
      await blocker.catch(() => undefined);
      await closeWorker(worker);
      await (await queue.getJob(event.id))?.remove();
      await prisma.workerJobFailure.deleteMany({
        where: { queueName: SYSTEM_QUEUE_NAME, jobId: event.id },
      });
      await prisma.processedJob.deleteMany({
        where: { queueName: SYSTEM_QUEUE_NAME, idempotencyKey: `outbox-${event.id}` },
      });
      await prisma.outboxEvent.deleteMany({ where: { id: event.id } });
    }
  });

  it("keeps failure resolution atomic with handler completion and durable Outbox markers", async () => {
    const prisma = getPrismaClient();
    const queue = getSystemQueue();
    const probeKey = "runtime.last_probe";
    const previousProbe = await prisma.systemState.findUnique({ where: { key: probeKey } });
    await prisma.systemState.upsert({
      where: { key: probeKey },
      create: { key: probeKey, value: { source: "failure-resolution-atomicity-baseline" } },
      update: { value: { source: "failure-resolution-atomicity-baseline" } },
    });
    const event = await createOutboxEvent(prisma, {
      topic: RUNTIME_PROBE_TOPIC,
      idempotencyKey: "test-runtime-failure-resolution-atomicity",
      payload: { source: "failure-resolution-must-roll-back" },
    });
    await prisma.workerJobFailure.create({
      data: {
        queueName: SYSTEM_QUEUE_NAME,
        jobId: event.id,
        jobName: OUTBOX_JOB_NAME,
        outboxEventId: event.id,
        attempts: 1,
        lastError: "force-resolution-failure",
      },
    });
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS "nextbuf_test_reject_worker_failure_resolution" ON "worker_job_failures"',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS "nextbuf_test_reject_worker_failure_resolution"()',
    );
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "nextbuf_test_reject_worker_failure_resolution"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF OLD."last_error" = 'force-resolution-failure'
          AND OLD."resolved_at" IS NULL
          AND NEW."resolved_at" IS NOT NULL THEN
          RAISE EXCEPTION 'forced worker failure resolution error';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "nextbuf_test_reject_worker_failure_resolution"
      BEFORE UPDATE ON "worker_job_failures"
      FOR EACH ROW
      EXECUTE FUNCTION "nextbuf_test_reject_worker_failure_resolution"()
    `);
    const worker = createOutboxWorker();

    try {
      await worker.worker.waitUntilReady();
      await queue.add(
        OUTBOX_JOB_NAME,
        {
          eventId: event.id,
          topic: event.topic,
          version: event.version,
          payload: event.payload as Prisma.InputJsonObject,
        },
        { attempts: 1, jobId: event.id, removeOnComplete: false, removeOnFail: false },
      );
      await waitFor(async () => (await (await queue.getJob(event.id))?.getState()) === "failed");

      await expect(
        prisma.processedJob.count({
          where: { queueName: SYSTEM_QUEUE_NAME, idempotencyKey: `outbox-${event.id}` },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
      ).resolves.toMatchObject({
        processedAt: null,
        lockOwner: null,
      });
      await expect(
        prisma.systemState.findUniqueOrThrow({ where: { key: probeKey } }),
      ).resolves.toMatchObject({ value: { source: "failure-resolution-atomicity-baseline" } });
      await expect(
        prisma.workerJobFailure.findUniqueOrThrow({
          where: { queueName_jobId: { queueName: SYSTEM_QUEUE_NAME, jobId: event.id } },
        }),
      ).resolves.toMatchObject({
        resolvedAt: null,
        lastError: expect.stringContaining("forced worker failure resolution error"),
      });
    } finally {
      await closeWorker(worker);
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS "nextbuf_test_reject_worker_failure_resolution" ON "worker_job_failures"',
      );
      await prisma.$executeRawUnsafe(
        'DROP FUNCTION IF EXISTS "nextbuf_test_reject_worker_failure_resolution"()',
      );
      await (await queue.getJob(event.id))?.remove();
      await prisma.workerJobFailure.deleteMany({
        where: { queueName: SYSTEM_QUEUE_NAME, jobId: event.id },
      });
      await prisma.processedJob.deleteMany({
        where: { queueName: SYSTEM_QUEUE_NAME, idempotencyKey: `outbox-${event.id}` },
      });
      await prisma.outboxEvent.deleteMany({ where: { id: event.id } });
      if (previousProbe) {
        const previousValue = previousProbe.value === null ? Prisma.JsonNull : previousProbe.value;
        await prisma.systemState.upsert({
          where: { key: probeKey },
          create: { key: probeKey, value: previousValue },
          update: { value: previousValue },
        });
      } else {
        await prisma.systemState.deleteMany({ where: { key: probeKey } });
      }
    }
  });

  it("backs off a poison Outbox event so it cannot monopolize the dispatch batch", async () => {
    const prisma = getPrismaClient();
    const poison = await prisma.outboxEvent.create({
      data: {
        topic: RUNTIME_PROBE_TOPIC,
        idempotencyKey: "test-runtime-poison-outbox-event",
        payload: ["not-an-object"],
      },
    });
    const valid = await createOutboxEvent(prisma, {
      topic: RUNTIME_PROBE_TOPIC,
      idempotencyKey: "test-runtime-after-poison-outbox-event",
      payload: { source: "after-poison-outbox-event" },
    });

    try {
      await expect(dispatchOutboxBatch("poison-outbox-publisher")).resolves.toEqual({
        dispatched: 1,
        failed: 1,
      });
      await expect(
        prisma.outboxEvent.findUniqueOrThrow({ where: { id: poison.id } }),
      ).resolves.toEqual(
        expect.objectContaining({
          attempts: 1,
          availableAt: expect.any(Date),
          lastError: expect.stringContaining("payload must be a JSON object"),
          publishedAt: null,
        }),
      );
      const poisonAfterFailure = await prisma.outboxEvent.findUniqueOrThrow({
        where: { id: poison.id },
      });
      expect(poisonAfterFailure.availableAt.getTime()).toBeGreaterThan(Date.now());
      await expect(dispatchOutboxBatch("poison-outbox-immediate-retry")).resolves.toEqual({
        dispatched: 0,
        failed: 0,
      });
    } finally {
      await (await getSystemQueue().getJob(valid.id))?.remove();
      await prisma.outboxEvent.deleteMany({ where: { id: { in: [poison.id, valid.id] } } });
    }
  });

  it("removes legacy mail queue state once without deleting ordinary or modern jobs", async () => {
    const prisma = getPrismaClient();
    const queue = getSystemQueue();
    const eventsKey = queue.keys.events;
    if (!eventsKey) throw new Error("BullMQ events key is unavailable");

    await prisma.systemState.deleteMany({ where: { key: MAIL_QUEUE_PRIVACY_MIGRATION_KEY } });
    const legacyMailEvent = await createOutboxEvent(prisma, {
      topic: IDENTITY_EMAIL_TOPIC,
      idempotencyKey: "test-mail-privacy-legacy",
      payload: { deliveryId: "30000000-0000-4000-8000-000000000001" },
    });
    const ordinaryEvent = await createOutboxEvent(prisma, {
      topic: RUNTIME_PROBE_TOPIC,
      idempotencyKey: "test-mail-privacy-ordinary",
      payload: { source: "mail-privacy-migration-test" },
    });
    const malformedJobId = "30000000-0000-4000-8000-000000000003";
    let modernMailEventId: string | undefined;

    try {
      await expect(dispatchOutboxBatch("mail-privacy-legacy-publisher")).resolves.toMatchObject({
        dispatched: 2,
        failed: 0,
      });
      await queue.add(
        OUTBOX_JOB_NAME,
        {
          eventId: "30000000-0000-4000-8000-000000000004",
          version: 1,
          payload: {},
        } as OutboxJobData,
        { jobId: malformedJobId },
      );
      await redis.xadd(
        eventsKey,
        "*",
        "event",
        "failed",
        "failedReason",
        "raw SMTP rejection for legacy-mail-secret@nextbuf.test",
      );

      await expect(ensureMailQueuePrivacyMigration("mail-privacy-integration")).resolves.toEqual({
        alreadyCompleted: false,
        removedJobs: 2,
        resetOutboxEvents: 1,
        trimmedEvents: expect.any(Number),
      });
      await expect(queue.getJob(legacyMailEvent.id)).resolves.toBeUndefined();
      await expect(queue.getJob(malformedJobId)).resolves.toBeUndefined();
      await expect(queue.getJob(ordinaryEvent.id)).resolves.toBeDefined();
      await expect(
        prisma.outboxEvent.findUniqueOrThrow({ where: { id: legacyMailEvent.id } }),
      ).resolves.toMatchObject({
        publishedAt: null,
        processedAt: null,
        lockedAt: null,
        lockOwner: null,
      });
      await expect(
        prisma.outboxEvent.findUniqueOrThrow({ where: { id: ordinaryEvent.id } }),
      ).resolves.toEqual(expect.objectContaining({ publishedAt: expect.any(Date) }));
      expect(JSON.stringify(await redis.xrange(eventsKey, "-", "+"))).not.toContain(
        "legacy-mail-secret@nextbuf.test",
      );
      await expect(
        prisma.systemState.findUniqueOrThrow({ where: { key: MAIL_QUEUE_PRIVACY_MIGRATION_KEY } }),
      ).resolves.toMatchObject({ value: { status: "complete", removedJobs: 2 } });

      const modernMailEvent = await createOutboxEvent(prisma, {
        topic: IDENTITY_EMAIL_TOPIC,
        idempotencyKey: "test-mail-privacy-modern",
        payload: { deliveryId: "30000000-0000-4000-8000-000000000002" },
      });
      modernMailEventId = modernMailEvent.id;
      await expect(dispatchOutboxBatch("mail-privacy-modern-publisher")).resolves.toMatchObject({
        dispatched: 2,
        failed: 0,
      });
      await expect(ensureMailQueuePrivacyMigration("mail-privacy-repeat")).resolves.toEqual({
        alreadyCompleted: true,
        removedJobs: 0,
        resetOutboxEvents: 0,
        trimmedEvents: 0,
      });
      await expect(queue.getJob(modernMailEvent.id)).resolves.toBeDefined();
      await expect(queue.getJob(legacyMailEvent.id)).resolves.toBeDefined();
    } finally {
      for (const eventId of [legacyMailEvent.id, ordinaryEvent.id, modernMailEventId]) {
        if (!eventId) continue;
        await (await queue.getJob(eventId))?.remove();
      }
      await prisma.outboxEvent.deleteMany({
        where: {
          id: {
            in: [legacyMailEvent.id, ordinaryEvent.id, modernMailEventId].filter(
              Boolean,
            ) as string[],
          },
        },
      });
      await prisma.systemState.deleteMany({ where: { key: MAIL_QUEUE_PRIVACY_MIGRATION_KEY } });
      await redis.del(eventsKey);
    }
  });

  it("continues Outbox work after a Worker restart", async () => {
    const prisma = getPrismaClient();
    const event = await createOutboxEvent(prisma, {
      topic: RUNTIME_PROBE_TOPIC,
      idempotencyKey: "test-runtime-probe-2",
      payload: { source: "worker-restart-test" },
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(
      await prisma.processedJob.count({ where: { idempotencyKey: `outbox-${event.id}` } }),
    ).toBe(0);
    await expect(prisma.outboxEvent.findUnique({ where: { id: event.id } })).resolves.toMatchObject(
      {
        publishedAt: null,
      },
    );

    const worker = createOutboxWorker();
    await worker.worker.waitUntilReady();
    await expect(dispatchOutboxBatch("integration-dispatcher")).resolves.toMatchObject({
      dispatched: 1,
    });
    await waitFor(async () => {
      return (
        (await prisma.processedJob.count({ where: { idempotencyKey: `outbox-${event.id}` } })) === 1
      );
    });

    await closeWorker(worker);
  });

  it("processes a representative Outbox batch within the Beta budget", async () => {
    const prisma = getPrismaClient();
    const worker = createOutboxWorker();
    await worker.worker.waitUntilReady();
    const events = await prisma.$transaction((transaction) =>
      Promise.all(
        Array.from({ length: 25 }, (_, index) =>
          createOutboxEvent(transaction, {
            topic: RUNTIME_PROBE_TOPIC,
            idempotencyKey: `test-runtime-batch-${index}`,
            payload: { source: "worker-capacity-test", index },
          }),
        ),
      ),
    );
    const startedAt = performance.now();
    await expect(dispatchOutboxBatch("integration-batch-dispatcher")).resolves.toMatchObject({
      dispatched: 25,
      failed: 0,
    });
    const processedKeys = events.map((event) => `outbox-${event.id}`);
    await waitFor(async () => {
      return (
        (await prisma.processedJob.count({ where: { idempotencyKey: { in: processedKeys } } })) ===
        events.length
      );
    }, 10_000);
    expect(performance.now() - startedAt).toBeLessThan(10_000);
    await closeWorker(worker);
  });

  it("closes the BullMQ diagnostic queue when doctor finishes", async () => {
    const queue = getSystemQueue();
    await queue.waitUntilReady();
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await doctor().catch(() => undefined);
      expect(queue.closing).toBeDefined();
      await expect(queue.closing).resolves.toBeUndefined();
    } finally {
      consoleLog.mockRestore();
    }
  });
});
