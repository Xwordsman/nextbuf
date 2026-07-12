import "server-only";

import { getAuth } from "@/infrastructure/auth/better-auth";

export async function getRequestSession(request: Request) {
  return getAuth().api.getSession({ headers: request.headers });
}
