import { getAuthEnvironment } from "@/shared/config/runtime-env";
import { getTrustedOrigins } from "@/shared/config/environment";

export function isSameOrigin(
  request: Request,
  applicationUrl: string,
  additionalTrustedOrigins: readonly string[] = [],
): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const parsedOrigin = new URL(origin);
    const trustedOrigins = new Set([new URL(applicationUrl).origin, ...additionalTrustedOrigins]);
    return parsedOrigin.origin === origin && trustedOrigins.has(parsedOrigin.origin);
  } catch {
    return false;
  }
}

export function hasSameOrigin(request: Request): boolean {
  const environment = getAuthEnvironment();
  return isSameOrigin(request, environment.APP_URL, getTrustedOrigins(environment));
}
