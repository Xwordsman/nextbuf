import { disconnectRedisClient } from "@/infrastructure/cache/redis";
import { checkRedisHealth } from "@/infrastructure/cache/health";
import { disconnectPrismaClient, getPrismaClient } from "@/infrastructure/database/client";
import { checkDatabaseHealth } from "@/infrastructure/database/health";
import { migrate } from "@/cli/commands/migrate";
import { getAuthEnvironment, runtimeEnv } from "@/shared/config/runtime-env";
import { WORKER_MAINTENANCE_TASK } from "@/worker/contracts";
import { reconcileInstallationState } from "@/modules/installation/installation.server";

export async function setup(): Promise<void> {
  getAuthEnvironment();
  await migrate();

  const [database, redis] = await Promise.all([checkDatabaseHealth(), checkRedisHealth()]);
  if (!database.ok || !redis.ok) {
    throw new Error(`Setup dependency check failed: database=${database.ok}, redis=${redis.ok}`);
  }

  const prisma = getPrismaClient();
  await prisma.workerScheduledTask.upsert({
    where: { name: WORKER_MAINTENANCE_TASK },
    create: { name: WORKER_MAINTENANCE_TASK, intervalSeconds: 60, nextRunAt: new Date() },
    update: {},
  });
  await reconcileInstallationState();
  await prisma.systemState.upsert({
    where: { key: "runtime.initialized" },
    create: {
      key: "runtime.initialized",
      value: { version: runtimeEnv.NEXTBUF_VERSION, initializedAt: new Date().toISOString() },
    },
    update: {
      value: { version: runtimeEnv.NEXTBUF_VERSION, checkedAt: new Date().toISOString() },
    },
  });

  await disconnectRedisClient();
  await disconnectPrismaClient();
}
