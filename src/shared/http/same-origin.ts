import { getAuthEnvironment } from "@/shared/config/runtime-env";

export function isSameOrigin(request: Request, applicationUrl: string): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.origin === origin && parsedOrigin.origin === new URL(applicationUrl).origin;
  } catch {
    return false;
  }
}

export function hasSameOrigin(request: Request): boolean {
  return isSameOrigin(request, getAuthEnvironment().APP_URL);
}
