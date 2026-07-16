import { getRequestSession } from "@/modules/identity/current-session.server";
import {
  queueTestEmailAsOperator,
  WorkerOperationsError,
} from "@/modules/worker/operations.server";
import { hasSameOrigin } from "@/shared/http/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  try {
    await queueTestEmailAsOperator(session.user.id);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof WorkerOperationsError) {
      return Response.json({ ok: false, code: error.code }, { status: error.status });
    }
    throw error;
  }
}
