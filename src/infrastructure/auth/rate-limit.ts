import { createHmac } from "node:crypto";
import type { BetterAuthOptions } from "better-auth";
import { ensureRedisConnected, getRedisClient } from "@/infrastructure/cache/redis";
import { getRedisKeyspaces } from "@/infrastructure/cache/keys";
import { getAuthEnvironment } from "@/shared/config/runtime-env";

const consumeScript = `
local current = redis.call("GET", KEYS[1])
if not current then
  redis.call("SET", KEYS[1], 1, "EX", ARGV[2])
  return {1, tonumber(ARGV[2])}
end
local count = tonumber(current)
local ttl = redis.call("TTL", KEYS[1])
if count >= tonumber(ARGV[1]) then
  return {0, ttl}
end
redis.call("INCR", KEYS[1])
return {1, ttl}
`;

function secureKey(scope: string, identifier: string): string {
  const environment = getAuthEnvironment();
  const digest = createHmac("sha256", environment.AUTH_SECRET).update(identifier).digest("hex");
  return `${getRedisKeyspaces().rateLimit}:identity:${scope}:${digest}`;
}

export async function consumeIdentityRateLimit(
  scope: string,
  identifier: string,
  maximum: number,
  windowSeconds: number,
) {
  const redis = getRedisClient();
  await ensureRedisConnected(redis);
  const result = (await redis.eval(
    consumeScript,
    1,
    secureKey(scope, identifier),
    maximum,
    windowSeconds,
  )) as [number, number];

  return {
    allowed: result[0] === 1,
    retryAfter: Math.max(result[1], 1),
  };
}

type AuthRateLimitStorage = NonNullable<
  NonNullable<BetterAuthOptions["rateLimit"]>["customStorage"]
>;

export const authRateLimitStorage: AuthRateLimitStorage = {
  async get() {
    return null;
  },
  async set() {
    return;
  },
  async consume(key, rule) {
    return consumeIdentityRateLimit("better-auth", key, rule.max, rule.window);
  },
};
