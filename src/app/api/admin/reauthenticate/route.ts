import { z } from "zod";
import { adminErrorResponse } from "@/modules/admin/response";
import { reauthenticateAdministrator } from "@/modules/admin/reauthentication.server";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { hasSameOrigin } from "@/shared/http/same-origin";
import { resolveRequestId } from "@/shared/http/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ password: z.string().min(1).max(128) });

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ code: "invalid_password" }, { status: 400 });
  try {
    const result = await reauthenticateAdministrator({
      actorId: session.user.id,
      sessionId: session.session.id,
      password: parsed.data.password,
      headers: request.headers,
      requestId: resolveRequestId(request.headers.get("x-request-id")),
    });
    return Response.json({ ok: true, expiresAt: result.expiresAt.toISOString() });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
