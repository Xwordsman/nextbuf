import { z } from "zod";
import { getPrismaClient } from "@/infrastructure/database/client";
import { recordIdentityAudit } from "@/modules/identity/audit.server";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { hasSameOrigin } from "@/shared/http/same-origin";

const schema = z.object({ isPublic: z.boolean(), showActivity: z.boolean() });

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ code: "invalid_privacy" }, { status: 400 });
  await getPrismaClient().profile.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, ...input.data },
    update: input.data,
  });
  await recordIdentityAudit({
    eventType: "identity.profile.privacy.updated",
    userId: session.user.id,
    request,
  });
  return Response.json({ ok: true });
}
