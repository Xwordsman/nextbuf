import { checkRedisHealth } from "@/infrastructure/cache/health";
import { disconnectRedisClient } from "@/infrastructure/cache/redis";
import { disconnectPrismaClient, getPrismaClient } from "@/infrastructure/database/client";
import { checkDatabaseHealth } from "@/infrastructure/database/health";
import { getMigrationStatus } from "@/infrastructure/database/migrations";
import { verifyObjectStorageConnection } from "@/infrastructure/storage/object-storage";
import { getAuthEnvironment } from "@/shared/config/runtime-env";
import { PROJECT } from "@/shared/project";

export async function preflight(role: string): Promise<void> {
  const environment = getAuthEnvironment();
  if (environment.NEXTBUF_VERSION !== PROJECT.version) {
    throw new Error(
      `Version mismatch: configuration=${environment.NEXTBUF_VERSION}, application=${PROJECT.version}`,
    );
  }

  try {
    const [database, redis] = await Promise.all([checkDatabaseHealth(), checkRedisHealth()]);
    if (!database.ok || !redis.ok) {
      throw new Error(
        `${role} dependencies are unavailable: database=${database.ok}, redis=${redis.ok}`,
      );
    }
    const [migration, initialized] = await Promise.all([
      getMigrationStatus(),
      getPrismaClient().systemState.findUnique({
        where: { key: "runtime.initialized" },
        select: { key: true },
      }),
      verifyObjectStorageConnection(),
    ]);
    if (!migration.ok) throw new Error(`${role} migration preflight failed`);
    if (!initialized) {
      throw new Error(`${role} startup refused because setup has not completed`);
    }
  } finally {
    await disconnectRedisClient();
    await disconnectPrismaClient();
  }
}
