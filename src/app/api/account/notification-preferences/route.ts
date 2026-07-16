import { z } from "zod";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { NOTIFICATION_TYPES } from "@/modules/notifications/contracts";
import {
  NotificationPreferencesError,
  updateNotificationPreferences,
} from "@/modules/notifications/notifications.server";
import { hasSameOrigin } from "@/shared/http/same-origin";

const schema = z.object({
  preferences: z.array(
    z.object({
      type: z.enum(NOTIFICATION_TYPES),
      inAppEnabled: z.boolean(),
      emailEnabled: z.boolean(),
    }),
  ),
});

export async function PUT(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ code: "invalid_preferences" }, { status: 400 });
  try {
    await updateNotificationPreferences(session.user.id, input.data.preferences);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof NotificationPreferencesError) {
      return Response.json({ code: "invalid_preferences" }, { status: 400 });
    }
    throw error;
  }
}
