import { z } from "zod";
import { getRequestSession } from "@/modules/identity/current-session.server";
import {
  archiveNotification,
  markNotificationRead,
} from "@/modules/notifications/notifications.server";
import { hasSameOrigin } from "@/shared/http/same-origin";

const schema = z.object({ action: z.enum(["read", "archive"]) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ code: "invalid_action" }, { status: 400 });
  const id = (await context.params).id;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ code: "notification_not_found" }, { status: 404 });
  }
  const changed =
    input.data.action === "read"
      ? await markNotificationRead(session.user.id, id)
      : await archiveNotification(session.user.id, id);
  if (!changed) return Response.json({ code: "notification_not_found" }, { status: 404 });
  return Response.json({ ok: true });
}
