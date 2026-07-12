import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { recordIdentityAudit } from "@/modules/identity/audit.server";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { hasSameOrigin } from "@/shared/http/same-origin";

const schema = z.object({ action: z.enum(["request", "cancel"]) });

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ code: "invalid_action" }, { status: 400 });

  const now = new Date();
  const scheduledAt = await getPrismaClient().$transaction(async (transaction) => {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "users" WHERE "id" = CAST(${session.user.id} AS uuid) FOR UPDATE`,
    );
    const user = await transaction.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { deletionRequestedAt: true, deletionScheduledAt: true },
    });
    const nextScheduledAt =
      input.data.action === "request"
        ? (user.deletionScheduledAt ?? new Date(now.getTime() + 14 * 86_400_000))
        : null;
    await transaction.user.update({
      where: { id: session.user.id },
      data:
        input.data.action === "request"
          ? {
              deletionRequestedAt: user.deletionRequestedAt ?? now,
              deletionScheduledAt: nextScheduledAt,
            }
          : { deletionRequestedAt: null, deletionScheduledAt: null },
    });
    return nextScheduledAt;
  });
  await recordIdentityAudit({
    eventType:
      input.data.action === "request"
        ? "identity.deletion.requested"
        : "identity.deletion.cancelled",
    userId: session.user.id,
    request,
  });
  return Response.json({
    ok: true,
    scheduledAt: input.data.action === "request" ? scheduledAt : null,
  });
}
