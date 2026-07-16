import { getRequestSession } from "@/modules/identity/current-session.server";
import { markAllNotificationsRead } from "@/modules/notifications/notifications.server";
import { hasSameOrigin } from "@/shared/http/same-origin";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  return Response.json({ ok: true, changed: await markAllNotificationsRead(session.user.id) });
}
