import { ensureRedisConnected, getRedisClient } from "@/infrastructure/cache/redis";
import type { DependencyHealth } from "@/infrastructure/database/health";
import { getErrorMessage } from "@/shared/errors/error-message";

export async function checkRedisHealth(): Promise<DependencyHealth> {
  const startedAt = performance.now();

  try {
    const redis = getRedisClient();
    await ensureRedisConnected(redis);
    const response = await redis.ping();

    if (response !== "PONG") {
      throw new Error(`unexpected Redis PING response: ${response}`);
    }

    return { ok: true, latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      detail: getErrorMessage(error),
    };
  }
}
