import { z } from "zod";
import { adminErrorResponse } from "@/modules/admin/response";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { siteSettingsInputSchema } from "@/modules/settings/contracts";
import { SITE_SETTINGS_CONFIRMATION } from "@/shared/admin-contracts";
import { updateSiteSettings } from "@/modules/settings/settings.server";
import { hasSameOrigin } from "@/shared/http/same-origin";
import { resolveRequestId } from "@/shared/http/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  expectedRevision: z.number().int().min(1),
  confirmation: z.literal(SITE_SETTINGS_CONFIRMATION),
  reason: z.string().trim().min(3).max(500),
  settings: siteSettingsInputSchema,
});

export async function PUT(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ code: "invalid_operation" }, { status: 400 });
  try {
    const settings = await updateSiteSettings({
      actorId: session.user.id,
      sessionId: session.session.id,
      requestId: resolveRequestId(request.headers.get("x-request-id")),
      ...parsed.data,
    });
    return Response.json({ ok: true, settings });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
