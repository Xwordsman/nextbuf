import { z } from "zod";
import { moderationErrorResponse } from "@/app/api/moderation/moderation-response";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { closeModerationCase } from "@/modules/moderation/actions.server";
import { hasSameOrigin } from "@/shared/http/same-origin";
import { resolveRequestId } from "@/shared/http/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  outcome: z.enum(["resolved", "dismissed"]),
  reason: z.string().trim().min(3).max(500),
});

export async function PATCH(request: Request, context: { params: Promise<{ number: string }> }) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const caseNumber = Number((await context.params).number);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!Number.isSafeInteger(caseNumber) || caseNumber < 1 || !parsed.success) {
    return Response.json({ code: "invalid_action" }, { status: 400 });
  }
  try {
    const moderationCase = await closeModerationCase({
      actorId: session.user.id,
      caseNumber,
      ...parsed.data,
      requestId: resolveRequestId(request.headers.get("x-request-id")),
    });
    return Response.json({ ok: true, status: moderationCase.status });
  } catch (error) {
    return moderationErrorResponse(error);
  }
}
