import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { disconnectRedisClient } from "@/infrastructure/cache/redis";
import { disconnectPrismaClient, getPrismaClient } from "@/infrastructure/database/client";
import { checkDatabaseHealth } from "@/infrastructure/database/health";
import { checkRedisHealth } from "@/infrastructure/cache/health";
import { logger } from "@/infrastructure/observability/logger";
import { dispatchOutboxBatch } from "@/infrastructure/outbox/dispatcher";
import { closeSystemQueue } from "@/infrastructure/queue/system-queue";
import { getAuthEnvironment } from "@/shared/config/runtime-env";
import { getErrorMessage } from "@/shared/errors/error-message";
import { createOutboxWorker } from "@/worker/processors/outbox";
import { ensureWorkerScheduledTasks, runScheduledTasks } from "@/worker/scheduler.server";

export async function startWorker(): Promise<void> {
  const environment = getAuthEnvironment();
  const databaseHealth = await checkDatabaseHealth();
  const redisHealth = await checkRedisHealth();

  if (!databaseHealth.ok || !redisHealth.ok) {
    throw new Error(
      `Worker dependencies are not ready: database=${databaseHealth.ok}, redis=${redisHealth.ok}`,
    );
  }

  const prisma = getPrismaClient();
  const workerId = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date();
  const { worker, connection } = createOutboxWorker();
  let dispatching = false;
  let scheduling = false;
  let stopping = false;
  let activeDispatch: Promise<void> | null = null;
  let activeSchedule: Promise<void> | null = null;

  await worker.waitUntilReady();

  await prisma.workerHeartbeat.upsert({
    where: { workerId },
    create: {
      workerId,
      status: "ready",
      version: environment.NEXTBUF_VERSION,
      startedAt,
      heartbeatAt: startedAt,
      metadata: { pid: process.pid, hostname: hostname() },
    },
    update: {
      status: "ready",
      version: environment.NEXTBUF_VERSION,
      startedAt,
      heartbeatAt: startedAt,
      stoppedAt: null,
      metadata: { pid: process.pid, hostname: hostname() },
    },
  });

  const heartbeatTimer = setInterval(() => {
    void prisma.workerHeartbeat
      .update({
        where: { workerId },
        data: { status: "ready", heartbeatAt: new Date() },
      })
      .catch((error) =>
        logger.error("Worker heartbeat failed", { workerId, error: getErrorMessage(error) }),
      );
  }, environment.WORKER_HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  const dispatch = () => {
    if (dispatching || stopping) {
      return activeDispatch ?? Promise.resolve();
    }

    dispatching = true;
    activeDispatch = (async () => {
      try {
        const result = await dispatchOutboxBatch(workerId);
        if (result.dispatched > 0 || result.failed > 0) {
          logger.info("Outbox dispatch cycle completed", { workerId, ...result });
        }
      } catch (error) {
        logger.error("Outbox dispatch cycle failed", { workerId, error: getErrorMessage(error) });
      } finally {
        dispatching = false;
        activeDispatch = null;
      }
    })();
    return activeDispatch;
  };

  const dispatchTimer = setInterval(() => void dispatch(), environment.OUTBOX_POLL_INTERVAL_MS);
  dispatchTimer.unref();
  await dispatch();

  await ensureWorkerScheduledTasks();
  const schedule = () => {
    if (scheduling || stopping) return activeSchedule ?? Promise.resolve();
    scheduling = true;
    activeSchedule = runScheduledTasks(workerId)
      .catch((error) =>
        logger.error("Worker schedule cycle failed", { workerId, error: getErrorMessage(error) }),
      )
      .then(() => undefined)
      .finally(() => {
        scheduling = false;
        activeSchedule = null;
      });
    return activeSchedule;
  };
  const scheduleTimer = setInterval(
    () => void schedule(),
    environment.WORKER_SCHEDULER_POLL_INTERVAL_MS,
  );
  scheduleTimer.unref();
  await schedule();

  worker.on("completed", (job) => {
    logger.debug("Worker job completed", { jobId: job.id });
  });
  worker.on("failed", (job, error) => {
    logger.error("Worker job failed", { jobId: job?.id, error: getErrorMessage(error) });
  });
  worker.on("error", (error) =>
    logger.error("BullMQ worker error", { error: getErrorMessage(error) }),
  );

  logger.info("NextBuf worker is ready", { workerId, concurrency: environment.WORKER_CONCURRENCY });

  const shutdown = async (signal: string) => {
    if (stopping) {
      return;
    }

    stopping = true;
    clearInterval(heartbeatTimer);
    clearInterval(dispatchTimer);
    clearInterval(scheduleTimer);
    logger.info("Stopping NextBuf worker", { workerId, signal });

    const forceExit = setTimeout(() => {
      logger.error("Worker shutdown timed out", { workerId });
      process.exit(1);
    }, environment.WORKER_SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      await Promise.all([activeDispatch, activeSchedule]);
      await worker.close();
      if (connection.status !== "end") {
        await connection.quit();
      }
      await closeSystemQueue();
      await prisma.workerHeartbeat.update({
        where: { workerId },
        data: { status: "stopped", heartbeatAt: new Date(), stoppedAt: new Date() },
      });
    } finally {
      await disconnectRedisClient();
      await disconnectPrismaClient();
      clearTimeout(forceExit);
    }
  };

  const handleSignal = (signal: string) => {
    void shutdown(signal).catch((error) => {
      logger.error("Worker shutdown failed", { workerId, error: getErrorMessage(error) });
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", () => handleSignal("SIGINT"));
  process.once("SIGTERM", () => handleSignal("SIGTERM"));
}
