import { getRedisEnvironment } from "@/shared/config/runtime-env";

export function getRedisKeyspaces() {
  const root = getRedisEnvironment().REDIS_PREFIX;

  return Object.freeze({
    cache: `${root}:cache`,
    rateLimit: `${root}:rate`,
    queue: `${root}:queue`,
  });
}
