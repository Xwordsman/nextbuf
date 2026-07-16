import { z } from "zod";
import { interactionErrorResponse } from "@/app/api/interactions/interaction-response";
import { setPostLiked } from "@/modules/interactions/interactions.server";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { hasSameOrigin } from "@/shared/http/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function updateLike(
  request: Request,
  context: { params: Promise<{ id: string }> },
  active: boolean,
) {
  if (!hasSameOrigin(request))
    return Response.json({ ok: false, code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ ok: false, code: "unauthorized" }, { status: 401 });
  const id = z.uuid().safeParse((await context.params).id);
  if (!id.success) return Response.json({ ok: false, code: "post_not_found" }, { status: 404 });
  try {
    return Response.json({ ok: true, ...(await setPostLiked(session.user.id, id.data, active)) });
  } catch (error) {
    return interactionErrorResponse(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return updateLike(request, context, true);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return updateLike(request, context, false);
}
