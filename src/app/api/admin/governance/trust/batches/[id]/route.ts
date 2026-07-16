import { z } from "zod";
import { moderationErrorResponse } from "@/app/api/moderation/moderation-response";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { getTrustBatchAsAdmin } from "@/modules/trust/trust.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const batchId = z.uuid().safeParse((await context.params).id);
  if (!batchId.success) return Response.json({ code: "invalid_action" }, { status: 400 });
  try {
    const batch = await getTrustBatchAsAdmin(session.user.id, batchId.data);
    return Response.json({ ok: true, batch });
  } catch (error) {
    return moderationErrorResponse(error);
  }
}
