import type IORedis from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { doctor } from "@/cli/commands/doctor";
import { setup } from "@/cli/commands/setup";
import { getRedisClient, disconnectRedisClient } from "@/infrastructure/cache/redis";
import { disconnectPrismaClient, getPrismaClient } from "@/infrastructure/database/client";
import { checkDatabaseHealth } from "@/infrastructure/database/health";
import { createOutboxEvent } from "@/infrastructure/outbox/create-event";
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
