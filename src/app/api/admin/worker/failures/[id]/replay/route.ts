import { z } from "zod";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { requestReplayAsOperator, WorkerOperationsError } from "@/modules/worker/operations.server";
import { hasSameOrigin } from "@/shared/http/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const id = (await context.params).id;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ ok: false, code: "failure_not_replayable" }, { status: 409 });
  }
  try {
    await requestReplayAsOperator(session.user.id, id);
    return Response.json({ ok: true, status: "requested" });
  } catch (error) {
    if (error instanceof WorkerOperationsError) {
      return Response.json({ ok: false, code: error.code }, { status: error.status });
    }
    throw error;
  }
}
