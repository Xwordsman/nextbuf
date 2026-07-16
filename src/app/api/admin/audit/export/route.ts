import { z } from "zod";
import { exportAdminAuditEvents } from "@/modules/admin/audit.server";
import { adminErrorResponse } from "@/modules/admin/response";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { AUDIT_EXPORT_CONFIRMATION } from "@/shared/admin-contracts";
import { hasSameOrigin } from "@/shared/http/same-origin";
import { resolveRequestId } from "@/shared/http/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const optionalDate = z
  .string()
  .datetime()
  .optional()
  .transform((value) => (value ? new Date(value) : undefined));
const schema = z.object({
  confirmation: z.literal(AUDIT_EXPORT_CONFIRMATION),
  reason: z.string().trim().min(3).max(500),
  filters: z.object({
    source: z.enum(["all", "identity", "community", "governance"]).optional(),
    action: z.string().trim().max(80).optional(),
    actorUid: z.number().int().positive().optional(),
    from: optionalDate,
    to: optionalDate,
  }),
});

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ code: "invalid_operation" }, { status: 400 });
  try {
    const result = await exportAdminAuditEvents({
      actorId: session.user.id,
      sessionId: session.session.id,
      requestId: resolveRequestId(request.headers.get("x-request-id")),
      ...parsed.data,
    });
    return new Response(result.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="nextbuf-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
        "X-NextBuf-Export-Count": String(result.count),
      },
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
