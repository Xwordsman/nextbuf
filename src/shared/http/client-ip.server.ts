import "server-only";

import { getIPFromHeader } from "@better-auth/core/utils/ip";
import { getAuthEnvironment } from "@/shared/config/runtime-env";

function configuredTrustedProxies(): string[] {
  return getAuthEnvironment()
    .AUTH_TRUSTED_PROXIES.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Resolve the address from the same forwarded-header contract as Better Auth.
 * A multi-hop chain is accepted only when every hop on the right is configured
 * as a trusted proxy; otherwise the value is treated as unavailable.
 */
export function resolveClientIp(
  request: Request,
  trustedProxies: readonly string[] = configuredTrustedProxies(),
): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return undefined;

  return getIPFromHeader(forwarded, { trustedProxies: [...trustedProxies] }) ?? undefined;
}

export function resolveForwardedClientIp(
  forwarded: string,
  trustedProxies: readonly string[] = [],
): string | undefined {
  return getIPFromHeader(forwarded, { trustedProxies: [...trustedProxies] }) ?? undefined;
}
