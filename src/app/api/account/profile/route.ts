import { z } from "zod";
import { getPrismaClient } from "@/infrastructure/database/client";
import { recordIdentityAudit } from "@/modules/identity/audit.server";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { hasSameOrigin } from "@/shared/http/same-origin";

const profileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
  bio: z.string().trim().max(500),
  website: z.union([z.literal(""), z.url().max(2048)]).refine((value) => {
    if (!value) return true;
    return ["http:", "https:"].includes(new URL(value).protocol);
  }),
});

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const input = profileSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ code: "invalid_profile" }, { status: 400 });

  await getPrismaClient().$transaction([
    getPrismaClient().user.update({
      where: { id: session.user.id },
      data: { name: input.data.name },
    }),
    getPrismaClient().profile.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, bio: input.data.bio, website: input.data.website || null },
      update: { bio: input.data.bio, website: input.data.website || null },
    }),
  ]);
  await recordIdentityAudit({
    eventType: "identity.profile.updated",
    userId: session.user.id,
    request,
  });
  return Response.json({ ok: true });
}
