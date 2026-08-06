import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const heartbeat = {
    upsert: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  };
  const worker = {
    waitUntilReady: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
  };
  const connection = {
    status: "ready",
    quit: vi.fn(),
  };
  return {
    heartbeat,
    worker,
    connection,
    checkDatabaseHealth: vi.fn(),
    checkRedisHealth: vi.fn(),
    ensureMailQueuePrivacyMigration: vi.fn(),
    dispatchOutboxBatch: vi.fn(),
    ensureWorkerScheduledTasks: vi.fn(),
    runScheduledTasks: vi.fn(),
    closeSystemQueue: vi.fn(),
    disconnectRedisClient: vi.fn(),
    disconnectPrismaClient: vi.fn(),
  };
});

vi.mock("@/infrastructure/cache/redis", () => ({
  disconnectRedisClient: mocks.disconnectRedisClient,
}));
vi.mock("@/infrastructure/database/client", () => ({
  disconnectPrismaClient: mocks.disconnectPrismaClient,
  getPrismaClient: () => ({ workerHeartbeat: mocks.heartbeat }),
}));
vi.mock("@/infrastructure/database/health", () => ({
  checkDatabaseHealth: mocks.checkDatabaseHealth,
}));
vi.mock("@/infrastructure/cache/health", () => ({
  checkRedisHealth: mocks.checkRedisHealth,
}));
vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("@/infrastructure/outbox/dispatcher", () => ({
  dispatchOutboxBatch: mocks.dispatchOutboxBatch,
}));
vi.mock("@/infrastructure/queue/system-queue", () => ({
  closeSystemQueue: mocks.closeSystemQueue,
}));
vi.mock("@/infrastructure/queue/mail-privacy-migration", () => ({
  ensureMailQueuePrivacyMigration: mocks.ensureMailQueuePrivacyMigration,
}));
vi.mock("@/shared/config/runtime-env", () => ({
  getAuthEnvironment: () => ({
    NEXTBUF_VERSION: "1.0.1",
    WORKER_CONCURRENCY: 5,
    WORKER_HEARTBEAT_INTERVAL_MS: 60_000,
    WORKER_SCHEDULER_POLL_INTERVAL_MS: 60_000,
    WORKER_SHUTDOWN_TIMEOUT_MS: 30_000,
    OUTBOX_POLL_INTERVAL_MS: 60_000,
  }),
}));
vi.mock("@/worker/processors/outbox", () => ({
  createOutboxWorker: () => ({ worker: mocks.worker, connection: mocks.connection }),
}));
vi.mock("@/worker/scheduler.server", () => ({
  ensureWorkerScheduledTasks: mocks.ensureWorkerScheduledTasks,
  runScheduledTasks: mocks.runScheduledTasks,
}));

import { startWorker } from "@/worker/runtime";

describe("worker startup lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connection.status = "ready";
    mocks.checkDatabaseHealth.mockResolvedValue({ ok: true });
    mocks.checkRedisHealth.mockResolvedValue({ ok: true });
    mocks.ensureMailQueuePrivacyMigration.mockResolvedValue(undefined);
    mocks.worker.waitUntilReady.mockResolvedValue(undefined);
    mocks.worker.close.mockResolvedValue(undefined);
    mocks.connection.quit.mockImplementation(async () => {
      mocks.connection.status = "end";
    });
    mocks.heartbeat.upsert.mockResolvedValue(undefined);
    mocks.heartbeat.updateMany.mockResolvedValue({ count: 1 });
    mocks.dispatchOutboxBatch.mockResolvedValue({ dispatched: 0, failed: 0 });
    mocks.runScheduledTasks.mockResolvedValue(undefined);
    mocks.closeSystemQueue.mockResolvedValue(undefined);
    mocks.disconnectRedisClient.mockResolvedValue(undefined);
    mocks.disconnectPrismaClient.mockResolvedValue(undefined);
  });

  it("closes every acquired resource when scheduler initialization fails", async () => {
    const startupFailure = new Error("injected scheduler initialization failure");
    mocks.ensureWorkerScheduledTasks.mockRejectedValue(startupFailure);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    try {
      await expect(startWorker()).rejects.toBe(startupFailure);
      expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
    } finally {
      clearIntervalSpy.mockRestore();
    }

    expect(mocks.worker.close).toHaveBeenCalledOnce();
    expect(mocks.connection.quit).toHaveBeenCalledOnce();
    expect(mocks.closeSystemQueue).toHaveBeenCalledOnce();
    expect(mocks.heartbeat.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workerId: expect.any(String) },
        data: expect.objectContaining({ status: "stopped", stoppedAt: expect.any(Date) }),
      }),
    );
    expect(mocks.disconnectRedisClient).toHaveBeenCalledOnce();
    expect(mocks.disconnectPrismaClient).toHaveBeenCalledOnce();
  });

  it("disconnects global clients when dependency health fails before worker creation", async () => {
    mocks.checkDatabaseHealth.mockResolvedValue({ ok: false });

    await expect(startWorker()).rejects.toThrow(
      "Worker dependencies are not ready: database=false, redis=true",
    );

    expect(mocks.worker.close).not.toHaveBeenCalled();
    expect(mocks.closeSystemQueue).toHaveBeenCalledOnce();
    expect(mocks.disconnectRedisClient).toHaveBeenCalledOnce();
    expect(mocks.disconnectPrismaClient).toHaveBeenCalledOnce();
  });
});
