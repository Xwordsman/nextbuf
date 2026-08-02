import { getRedisEnvironment } from "@/shared/config/runtime-env";

let testRedisPrefix: string | undefined;

export function getRedisKeyspaces() {
  const root = testRedisPrefix ?? getRedisEnvironment().REDIS_PREFIX;

  return Object.freeze({
    cache: `${root}:cache`,
    rateLimit: `${root}:rate`,
    queue: `${root}:queue`,
  });
}

/** @internal Test-only hook for isolated integration keyspaces. */
export function overrideRedisPrefixForTests(prefix: string): () => void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Redis prefix overrides are only available in tests");
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(prefix)) {
    throw new Error("Invalid Redis prefix override");
  }

  const previous = testRedisPrefix;
  testRedisPrefix = prefix;
  let restored = false;

  return () => {
    if (restored) {
      throw new Error("Redis prefix override has already been restored");
    }
    if (testRedisPrefix !== prefix) {
      throw new Error("Redis prefix override ownership was lost");
    }

    testRedisPrefix = previous;
    restored = true;
  };
}
