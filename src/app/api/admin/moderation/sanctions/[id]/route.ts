import { z } from "zod";
import { moderationErrorResponse } from "@/app/api/moderation/moderation-response";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { revokeModerationSanction } from "@/modules/moderation/actions.server";
import { hasSameOrigin } from "@/shared/http/same-origin";
import { resolveRequestId } from "@/shared/http/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ reason: z.string().trim().min(3).max(500) });

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const sanctionId = z.uuid().safeParse((await context.params).id);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!sanctionId.success || !parsed.success) {
    return Response.json({ code: "invalid_action" }, { status: 400 });
  }
  try {
    await revokeModerationSanction({
      actorId: session.user.id,
      sanctionId: sanctionId.data,
      reason: parsed.data.reason,
      requestId: resolveRequestId(request.headers.get("x-request-id")),
    });
    return Response.json({ ok: true });
  } catch (error) {
    return moderationErrorResponse(error);
  }
}
