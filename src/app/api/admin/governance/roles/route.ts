import { z } from "zod";
import { moderationErrorResponse } from "@/app/api/moderation/moderation-response";
import { getPrismaClient } from "@/infrastructure/database/client";
import { AdminError } from "@/modules/admin/errors";
import { adminErrorResponse } from "@/modules/admin/response";
import {
  requireConfirmation,
  requireElevatedSiteAdmin,
} from "@/modules/admin/reauthentication.server";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { grantCommunityRole, revokeCommunityRole } from "@/modules/moderation/governance.server";
import { ROLE_CHANGE_CONFIRMATION } from "@/shared/admin-contracts";
import { hasSameOrigin } from "@/shared/http/same-origin";
import { resolveRequestId } from "@/shared/http/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reason = z.string().trim().min(3).max(500);
const grantSchema = z.object({
  userId: z.uuid(),
  role: z.enum(["admin", "global_moderator", "node_moderator"]),
  nodeId: z.uuid().optional(),
  reason,
  confirmation: z.literal(ROLE_CHANGE_CONFIRMATION),
});
const revokeSchema = z.object({
  assignmentId: z.uuid(),
  reason,
  confirmation: z.literal(ROLE_CHANGE_CONFIRMATION),
});

async function requireElevation(actorId: string, sessionId: string, confirmation: string) {
  requireConfirmation(confirmation, ROLE_CHANGE_CONFIRMATION);
  await getPrismaClient().$transaction((transaction) =>
    requireElevatedSiteAdmin(transaction, { actorId, sessionId }),
  );
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const parsed = grantSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ code: "invalid_action" }, { status: 400 });
  try {
    await requireElevation(session.user.id, session.session.id, parsed.data.confirmation);
    const assignment = await grantCommunityRole({
      actorId: session.user.id,
      targetUserId: parsed.data.userId,
      role: parsed.data.role,
      nodeId: parsed.data.nodeId,
      reason: parsed.data.reason,
      requestId: resolveRequestId(request.headers.get("x-request-id")),
    });
    return Response.json({ ok: true, assignmentId: assignment.id });
  } catch (error) {
    if (error instanceof AdminError) return adminErrorResponse(error);
    return moderationErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const parsed = revokeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ code: "invalid_action" }, { status: 400 });
  try {
    await requireElevation(session.user.id, session.session.id, parsed.data.confirmation);
    await revokeCommunityRole({
      actorId: session.user.id,
      assignmentId: parsed.data.assignmentId,
      reason: parsed.data.reason,
      requestId: resolveRequestId(request.headers.get("x-request-id")),
    });
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminError) return adminErrorResponse(error);
    return moderationErrorResponse(error);
  }
}
