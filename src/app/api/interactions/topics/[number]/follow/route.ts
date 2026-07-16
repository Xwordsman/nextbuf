import { interactionErrorResponse } from "@/app/api/interactions/interaction-response";
import { setTopicFollowed } from "@/modules/interactions/interactions.server";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { hasSameOrigin } from "@/shared/http/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function updateFollow(
  request: Request,
  context: { params: Promise<{ number: string }> },
  active: boolean,
) {
  if (!hasSameOrigin(request))
    return Response.json({ ok: false, code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ ok: false, code: "unauthorized" }, { status: 401 });
  const number = Number((await context.params).number);
  if (!Number.isSafeInteger(number) || number < 1)
    return Response.json({ ok: false, code: "topic_not_found" }, { status: 404 });
  try {
    return Response.json({
      ok: true,
      ...(await setTopicFollowed(session.user.id, number, active)),
    });
  } catch (error) {
    return interactionErrorResponse(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ number: string }> }) {
  return updateFollow(request, context, true);
}

export async function DELETE(request: Request, context: { params: Promise<{ number: string }> }) {
  return updateFollow(request, context, false);
}
