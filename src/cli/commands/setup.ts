import { disconnectRedisClient } from "@/infrastructure/cache/redis";
import { checkRedisHealth } from "@/infrastructure/cache/health";
import { disconnectPrismaClient, getPrismaClient } from "@/infrastructure/database/client";
import { checkDatabaseHealth } from "@/infrastructure/database/health";
import { migrate } from "@/cli/commands/migrate";
import { runtimeEnv } from "@/shared/config/runtime-env";

export async function setup(): Promise<void> {
  await migrate();

  const [database, redis] = await Promise.all([checkDatabaseHealth(), checkRedisHealth()]);
  if (!database.ok || !redis.ok) {
    throw new Error(`Setup dependency check failed: database=${database.ok}, redis=${redis.ok}`);
  }

  await getPrismaClient().systemState.upsert({
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
