import { z } from "zod";
import { moderationErrorResponse } from "@/app/api/moderation/moderation-response";
import { getPrismaClient } from "@/infrastructure/database/client";
import { AdminError } from "@/modules/admin/errors";
import { adminErrorResponse } from "@/modules/admin/response";
import { requireElevatedSiteAdmin } from "@/modules/admin/reauthentication.server";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { activateTrustRule } from "@/modules/trust/trust.server";
import { TRUST_CHANGE_CONFIRMATION } from "@/shared/admin-contracts";
import { hasSameOrigin } from "@/shared/http/same-origin";
import { resolveRequestId } from "@/shared/http/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  reason: z.string().trim().min(3).max(500),
  confirmation: z.literal(TRUST_CHANGE_CONFIRMATION),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const ruleId = z.uuid().safeParse((await context.params).id);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!ruleId.success || !parsed.success) {
    return Response.json({ code: "invalid_action" }, { status: 400 });
  }
  try {
    await getPrismaClient().$transaction((transaction) =>
      requireElevatedSiteAdmin(transaction, {
        actorId: session.user.id,
        sessionId: session.session.id,
      }),
    );
    const result = await activateTrustRule({
      actorId: session.user.id,
      ruleId: ruleId.data,
      reason: parsed.data.reason,
      requestId: resolveRequestId(request.headers.get("x-request-id")),
    });
    return Response.json({ ok: true, batchId: result.batch.id });
  } catch (error) {
    if (error instanceof AdminError) return adminErrorResponse(error);
    return moderationErrorResponse(error);
  }
}
