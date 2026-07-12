import { z } from "zod";
import { recordIdentityAudit } from "@/modules/identity/audit.server";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { changeUsername, UsernameError } from "@/modules/profiles/username.server";
import { hasSameOrigin } from "@/shared/http/same-origin";

const schema = z.object({ username: z.string().min(3).max(24) });

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ code: "invalid_username" }, { status: 400 });

  try {
    const user = await changeUsername(session.user.id, input.data.username);
    await recordIdentityAudit({
      eventType: "identity.username.changed",
      userId: session.user.id,
      request,
      metadata: { username: user.username },
    });
    return Response.json({ ok: true, username: user.username });
  } catch (error) {
    if (error instanceof UsernameError) {
      return Response.json(
        { code: error.code, availableAt: error.availableAt?.toISOString() },
        { status: error.code === "username_cooldown" ? 429 : 409 },
      );
    }
    throw error;
  }
}
