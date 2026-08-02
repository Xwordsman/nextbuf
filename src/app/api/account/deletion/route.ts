import { z } from "zod";
import { AdministratorContinuityError } from "@/modules/admin/continuity.server";
import {
  AccountDeletionError,
  updateAccountDeletionRequest,
} from "@/modules/identity/account-deletion.server";
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

  let scheduledAt: Date | null;
  try {
    scheduledAt = await updateAccountDeletionRequest(session.user.id, input.data.action);
  } catch (error) {
    if (error instanceof AccountDeletionError || error instanceof AdministratorContinuityError) {
      return Response.json({ code: error.code }, { status: error.status });
    }
    throw error;
  }
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
