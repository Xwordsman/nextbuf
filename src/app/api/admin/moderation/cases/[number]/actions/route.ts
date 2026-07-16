import { z } from "zod";
import { moderationErrorResponse } from "@/app/api/moderation/moderation-response";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { applyModerationAction } from "@/modules/moderation/actions.server";
import { hasSameOrigin } from "@/shared/http/same-origin";
import { resolveRequestId } from "@/shared/http/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["hide", "restore", "close", "warn", "node_mute", "site_mute", "suspend", "ban"]),
  reason: z.string().trim().min(3).max(500),
  durationHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 365)
    .optional(),
});

export async function POST(request: Request, context: { params: Promise<{ number: string }> }) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const caseNumber = Number((await context.params).number);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!Number.isSafeInteger(caseNumber) || caseNumber < 1 || !parsed.success) {
    return Response.json({ code: "invalid_action" }, { status: 400 });
  }
  try {
    const action = await applyModerationAction({
      actorId: session.user.id,
      caseNumber,
      action: parsed.data.action,
      reason: parsed.data.reason,
      endsAt: parsed.data.durationHours
        ? new Date(Date.now() + parsed.data.durationHours * 3_600_000)
        : undefined,
      requestId: resolveRequestId(request.headers.get("x-request-id")),
    });
    return Response.json({ ok: true, actionId: action.id });
  } catch (error) {
    return moderationErrorResponse(error);
  }
}
