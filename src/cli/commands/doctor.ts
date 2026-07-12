import { checkRedisHealth } from "@/infrastructure/cache/health";
import { disconnectRedisClient } from "@/infrastructure/cache/redis";
import { disconnectPrismaClient } from "@/infrastructure/database/client";
import { checkDatabaseHealth } from "@/infrastructure/database/health";
import { getRedisKeyspaces } from "@/infrastructure/cache/keys";
import { runtimeEnv } from "@/shared/config/runtime-env";

export async function doctor(): Promise<void> {
  const [database, redis] = await Promise.all([checkDatabaseHealth(), checkRedisHealth()]);
  const report = {
    status: database.ok && redis.ok ? "ok" : "error",
    version: runtimeEnv.NEXTBUF_VERSION,
    environment: runtimeEnv.NODE_ENV,
    database,
    redis,
    keyspaces: getRedisKeyspaces(),
  };

  console.log(JSON.stringify(report, null, 2));
  await disconnectRedisClient();
  await disconnectPrismaClient();

  if (report.status !== "ok") {
    throw new Error("NextBuf doctor found unavailable dependencies");
  }
}
