import { getAuthEnvironment } from "@/shared/config/runtime-env";

export function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  return origin === new URL(getAuthEnvironment().APP_URL).origin;
}
