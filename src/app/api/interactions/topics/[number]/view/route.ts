import { interactionErrorResponse } from "@/app/api/interactions/interaction-response";
import { recordTopicView } from "@/modules/interactions/interactions.server";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { hasSameOrigin } from "@/shared/http/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function anonymousFingerprint(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  const userAgent = request.headers.get("user-agent")?.slice(0, 500) || "unknown";
  return `${address}|${userAgent}`;
}

export async function POST(request: Request, context: { params: Promise<{ number: string }> }) {
  if (!hasSameOrigin(request))
    return Response.json({ ok: false, code: "invalid_origin" }, { status: 403 });
  const number = Number((await context.params).number);
  if (!Number.isSafeInteger(number) || number < 1)
    return Response.json({ ok: false, code: "topic_not_found" }, { status: 404 });
  const session = await getRequestSession(request);
  try {
    const result = await recordTopicView({
      number,
      viewerId: session?.user.id,
      anonymousFingerprint: anonymousFingerprint(request),
    });
    return Response.json({ ok: true, accepted: result.accepted }, { status: 202 });
  } catch (error) {
    return interactionErrorResponse(error);
  }
}
