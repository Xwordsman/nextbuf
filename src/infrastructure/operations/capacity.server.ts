import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { ensureRedisConnected, getRedisClient } from "@/infrastructure/cache/redis";
import { getPrismaClient } from "@/infrastructure/database/client";
import { getSystemQueueHealth } from "@/infrastructure/queue/health";
import { getAuthEnvironment } from "@/shared/config/runtime-env";

type DatabaseCapacityRow = {
  sizeBytes: bigint;
  activeConnections: bigint;
  maxConnections: number;
};

function infoValue(info: string, key: string): number {
  const match = info.match(new RegExp(`^${key}:(\\d+)$`, "mu"));
  return match ? Number(match[1]) : 0;
}

function configValue(result: unknown): string {
  return Array.isArray(result) && typeof result[1] === "string" ? result[1] : "";
}

export async function getOperationalCapacity() {
  const environment = getAuthEnvironment();
  const prisma = getPrismaClient();
  const redis = getRedisClient();
  await ensureRedisConnected(redis);
  const [databaseRows, memoryInfo, maxMemoryConfig, evictionPolicyConfig, queue, facts] =
    await Promise.all([
      prisma.$queryRaw<DatabaseCapacityRow[]>(Prisma.sql`
        SELECT
          pg_database_size(current_database())::bigint AS "sizeBytes",
          COUNT(*) FILTER (WHERE "datname" = current_database())::bigint AS "activeConnections",
          (SELECT "setting"::integer FROM "pg_settings" WHERE "name" = 'max_connections') AS "maxConnections"
        FROM "pg_stat_activity"
      `),
      redis.info("memory"),
      redis.config("GET", "maxmemory"),
      redis.config("GET", "maxmemory-policy"),
      getSystemQueueHealth(),
      Promise.all([
        prisma.outboxEvent.count({ where: { publishedAt: null } }),
        prisma.outboxEvent.count({ where: { publishedAt: null, lastError: { not: null } } }),
        prisma.emailDelivery.count({ where: { status: { in: ["pending", "sending"] } } }),
        prisma.emailDelivery.count({ where: { status: "failed" } }),
        prisma.workerJobFailure.count({ where: { resolvedAt: null } }),
      ]),
    ]);
  const database = databaseRows[0];
  if (!database) throw new Error("PostgreSQL capacity query returned no row");
  const maxMemoryBytes = Number(configValue(maxMemoryConfig) || 0);
  const usedMemoryBytes = infoValue(memoryInfo, "used_memory");
  const [pendingOutbox, failedOutbox, pendingMail, failedMail, unresolvedJobs] = facts;

  return {
    database: {
      sizeBytes: Number(database.sizeBytes),
      activeConnections: Number(database.activeConnections),
      maxConnections: database.maxConnections,
      configuredPoolSizePerProcess: environment.DATABASE_POOL_SIZE,
      statementTimeoutMs: environment.DATABASE_STATEMENT_TIMEOUT_MS,
    },
    redis: {
      usedMemoryBytes,
      peakMemoryBytes: infoValue(memoryInfo, "used_memory_peak"),
      maxMemoryBytes,
      usageRatio: maxMemoryBytes > 0 ? Number((usedMemoryBytes / maxMemoryBytes).toFixed(4)) : null,
      evictionPolicy: configValue(evictionPolicyConfig),
    },
    worker: {
      concurrencyPerProcess: environment.WORKER_CONCURRENCY,
      outboxBatchSize: environment.OUTBOX_BATCH_SIZE,
      outboxPollIntervalMs: environment.OUTBOX_POLL_INTERVAL_MS,
    },
    backlog: {
      pendingOutbox,
      failedOutbox,
      pendingMail,
      failedMail,
      unresolvedJobs,
      queue: {
        waiting: queue.waiting ?? 0,
        active: queue.active ?? 0,
        delayed: queue.delayed ?? 0,
        failed: queue.failed ?? 0,
      },
    },
  };
}
