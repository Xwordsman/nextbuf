import { getAuth } from "@/infrastructure/auth/better-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  return getAuth().handler(request);
}

export { handle as DELETE, handle as GET, handle as PATCH, handle as POST, handle as PUT };
