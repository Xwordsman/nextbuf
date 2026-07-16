import { z } from "zod";
import { moderationErrorResponse } from "@/app/api/moderation/moderation-response";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { createTrustRuleDraft, getTrustGovernanceOverview } from "@/modules/trust/trust.server";
import { hasSameOrigin } from "@/shared/http/same-origin";
import { resolveRequestId } from "@/shared/http/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ config: z.unknown(), reason: z.string().trim().min(3).max(500) });

export async function GET(request: Request) {
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  try {
    return Response.json({ ok: true, ...(await getTrustGovernanceOverview(session.user.id)) });
  } catch (error) {
    return moderationErrorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ code: "invalid_rule" }, { status: 400 });
  try {
    const rule = await createTrustRuleDraft({
      actorId: session.user.id,
      config: parsed.data.config,
      reason: parsed.data.reason,
      requestId: resolveRequestId(request.headers.get("x-request-id")),
    });
    return Response.json({ ok: true, ruleId: rule.id, version: rule.version });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ code: "invalid_rule" }, { status: 400 });
    }
    return moderationErrorResponse(error);
  }
}
