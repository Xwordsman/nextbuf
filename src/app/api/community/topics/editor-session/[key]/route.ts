import { z } from "zod";
import { findTopicEditorSessionTarget } from "@/modules/community/editor-session-recovery.server";
import { getRequestSession } from "@/modules/identity/current-session.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ key: string }> }) {
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const key = z
    .string()
    .uuid()
    .safeParse((await context.params).key);
  if (!key.success) return Response.json({ code: "editor_session_not_found" }, { status: 404 });
  const target = await findTopicEditorSessionTarget(session.user.id, key.data);
  if (!target) return Response.json({ code: "editor_session_not_found" }, { status: 404 });
  return Response.json(
    { ok: true, ...target },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
