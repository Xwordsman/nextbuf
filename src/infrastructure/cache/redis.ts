import IORedis from "ioredis";
import { getRedisEnvironment } from "@/shared/config/runtime-env";

const globalRedis = globalThis as typeof globalThis & {
  nextbufRedis?: IORedis;
};

function createRedis(options: { bullmq?: boolean } = {}): IORedis {
  const environment = getRedisEnvironment();

  const redis = new IORedis(environment.REDIS_URL, {
    connectionName: options.bullmq ? "nextbuf-bullmq" : "nextbuf-runtime",
    enableReadyCheck: true,
    lazyConnect: true,
    maxRetriesPerRequest: options.bullmq ? null : 3,
  });

  if (!options.bullmq) {
    redis.on("error", () => undefined);
  }

  return redis;
}

export function getRedisClient(): IORedis {
  if (!globalRedis.nextbufRedis || globalRedis.nextbufRedis.status === "end") {
    globalRedis.nextbufRedis = createRedis();
  }
  return globalRedis.nextbufRedis;
}

export function createBullRedisConnection(): IORedis {
  return createRedis({ bullmq: true });
}

export async function ensureRedisConnected(redis: IORedis): Promise<void> {
  if (redis.status === "wait") {
    await redis.connect();
  }
}

export async function disconnectRedisClient(): Promise<void> {
  if (!globalRedis.nextbufRedis) {
    return;
  }

  await globalRedis.nextbufRedis.quit();
  globalRedis.nextbufRedis = undefined;
}
