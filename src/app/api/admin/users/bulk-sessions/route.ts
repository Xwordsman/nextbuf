import { z } from "zod";
import { adminErrorResponse } from "@/modules/admin/response";
import { bulkRevokeUserSessions } from "@/modules/admin/users.server";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { BULK_SESSION_CONFIRMATION } from "@/shared/admin-contracts";
import { hasSameOrigin } from "@/shared/http/same-origin";
import { resolveRequestId } from "@/shared/http/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  userIds: z.array(z.uuid()).min(1).max(50),
  confirmation: z.literal(BULK_SESSION_CONFIRMATION),
  reason: z.string().trim().min(3).max(500),
});

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ code: "invalid_operation" }, { status: 400 });
  try {
    const result = await bulkRevokeUserSessions({
      actorId: session.user.id,
      sessionId: session.session.id,
      requestId: resolveRequestId(request.headers.get("x-request-id")),
      ...parsed.data,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
