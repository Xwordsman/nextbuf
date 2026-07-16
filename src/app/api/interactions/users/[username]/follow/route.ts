import { interactionErrorResponse } from "@/app/api/interactions/interaction-response";
import { setUserFollowed } from "@/modules/interactions/interactions.server";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { hasSameOrigin } from "@/shared/http/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function updateFollow(
  request: Request,
  context: { params: Promise<{ username: string }> },
  active: boolean,
) {
  if (!hasSameOrigin(request))
    return Response.json({ ok: false, code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ ok: false, code: "unauthorized" }, { status: 401 });
  const username = (await context.params).username;
  try {
    return Response.json({
      ok: true,
      ...(await setUserFollowed(session.user.id, username, active)),
    });
  } catch (error) {
    return interactionErrorResponse(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ username: string }> }) {
  return updateFollow(request, context, true);
}

export async function DELETE(request: Request, context: { params: Promise<{ username: string }> }) {
  return updateFollow(request, context, false);
}
