import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { detectAvatarFormat } from "@/infrastructure/storage/avatar-format";
import {
  deleteAvatarFromUrl,
  deleteStoredAvatar,
  storeAvatar,
} from "@/infrastructure/storage/avatar-storage";
import { recordIdentityAudit } from "@/modules/identity/audit.server";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { runtimeEnv } from "@/shared/config/runtime-env";
import { hasSameOrigin } from "@/shared/http/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const form = await request.formData();
  const file = form.get("avatar");
  if (!(file instanceof File)) return Response.json({ code: "invalid_avatar" }, { status: 400 });
  if (file.size < 1 || file.size > runtimeEnv.AVATAR_MAX_UPLOAD_BYTES) {
    return Response.json({ code: "avatar_too_large" }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = detectAvatarFormat(bytes);
  if (!format) return Response.json({ code: "invalid_avatar" }, { status: 400 });

  const key = await storeAvatar(bytes, format);
  const image = `/api/media/avatars/${key}`;
  let previous: { image: string | null };
  try {
    previous = await getPrismaClient().$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "users" WHERE "id" = CAST(${session.user.id} AS uuid) FOR UPDATE`,
      );
      const current = await transaction.user.findUniqueOrThrow({
        where: { id: session.user.id },
        select: { image: true },
      });
      await transaction.user.update({
        where: { id: session.user.id },
        data: { image },
      });
      return current;
    });
  } catch (error) {
    await deleteStoredAvatar(key);
    throw error;
  }
  await deleteAvatarFromUrl(previous.image);
  await recordIdentityAudit({
    eventType: "identity.profile.avatar.updated",
    userId: session.user.id,
    request,
  });
  return Response.json({ ok: true, image });
}
