import { checkRedisHealth } from "@/infrastructure/cache/health";
import { getPrismaClient } from "@/infrastructure/database/client";
import { checkDatabaseHealth } from "@/infrastructure/database/health";
import { getSystemQueueHealth } from "@/infrastructure/queue/health";
import { getServiceEnvironment } from "@/shared/config/runtime-env";

function publicDependencyStatus(status: Awaited<ReturnType<typeof checkDatabaseHealth>>) {
  return { ok: status.ok, latencyMs: status.latencyMs };
}

export async function getReadinessStatus() {
  const [database, redis] = await Promise.all([checkDatabaseHealth(), checkRedisHealth()]);

  return {
    ok: database.ok && redis.ok,
    dependencies: {
      database: publicDependencyStatus(database),
      redis: publicDependencyStatus(redis),
    },
  };
}

export async function getWorkerHealthStatus() {
  const readiness = await getReadinessStatus();

  if (!readiness.ok) {
    return { ok: false, dependencies: readiness.dependencies, workers: [], queue: null };
  }

  const environment = getServiceEnvironment();
  const freshAfter = new Date(Date.now() - environment.WORKER_STALE_AFTER_MS);
  const [workers, queue] = await Promise.all([
    getPrismaClient().workerHeartbeat.findMany({
      where: { status: "ready", heartbeatAt: { gte: freshAfter } },
      orderBy: { heartbeatAt: "desc" },
      select: { workerId: true, version: true, startedAt: true, heartbeatAt: true },
    }),
    getSystemQueueHealth(),
  ]);

  return {
    ok: workers.length > 0,
    dependencies: readiness.dependencies,
    workers,
    queue,
  };
}
