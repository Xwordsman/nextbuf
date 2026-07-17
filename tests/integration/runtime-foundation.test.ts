import type IORedis from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { doctor } from "@/cli/commands/doctor";
import { setup } from "@/cli/commands/setup";
import { getRedisClient, disconnectRedisClient } from "@/infrastructure/cache/redis";
import { disconnectPrismaClient, getPrismaClient } from "@/infrastructure/database/client";
import { Prisma } from "@/generated/prisma/client";
import { checkDatabaseHealth } from "@/infrastructure/database/health";
import { createOutboxEvent } from "@/infrastructure/outbox/create-event";
import { getOperationalCapacity } from "@/infrastructure/operations/capacity.server";
import { dispatchOutboxBatch } from "@/infrastructure/outbox/dispatcher";
import { RUNTIME_PROBE_TOPIC } from "@/infrastructure/queue/contracts";
import { closeSystemQueue, getSystemQueue } from "@/infrastructure/queue/system-queue";
import { createOutboxWorker } from "@/worker/processors/outbox";

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
    });

    await redis.flushdb();
    await expect(
      prisma.systemState.findUnique({ where: { key: "test.business_fact" } }),
    ).resolves.toMatchObject({ value: { durable: true } });

    await closeWorker(worker);
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
