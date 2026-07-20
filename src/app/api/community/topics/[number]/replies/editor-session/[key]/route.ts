import { z } from "zod";
import { communityErrorResponse } from "@/app/api/community/community-response";
import { findReplyEditorSessionTarget } from "@/modules/community/editor-session-recovery.server";
import { getRequestSession } from "@/modules/identity/current-session.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ number: string; key: string }> },
) {
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const params = await context.params;
  const number = Number(params.number);
  const key = z.string().uuid().safeParse(params.key);
  if (!Number.isSafeInteger(number) || number < 1 || !key.success) {
    return Response.json({ code: "editor_session_not_found" }, { status: 404 });
  }
  try {
    const target = await findReplyEditorSessionTarget(session.user.id, number, key.data);
    if (!target) return Response.json({ code: "editor_session_not_found" }, { status: 404 });
    return Response.json(
      { ok: true, ...target },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return communityErrorResponse(error);
  }
}
