import { z } from "zod";
import { interactionErrorResponse } from "@/app/api/interactions/interaction-response";
import { markTopicRead } from "@/modules/interactions/interactions.server";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { hasSameOrigin } from "@/shared/http/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ position: z.number().int().min(1) });

export async function PUT(request: Request, context: { params: Promise<{ number: string }> }) {
  if (!hasSameOrigin(request))
    return Response.json({ ok: false, code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ ok: false, code: "unauthorized" }, { status: 401 });
  const number = Number((await context.params).number);
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!Number.isSafeInteger(number) || number < 1)
    return Response.json({ ok: false, code: "topic_not_found" }, { status: 404 });
  if (!input.success)
    return Response.json({ ok: false, code: "invalid_interaction" }, { status: 400 });
  try {
    const state = await markTopicRead(session.user.id, number, input.data.position);
    return Response.json({
      ok: true,
      position: state.position,
      readAt: state.readAt.toISOString(),
    });
  } catch (error) {
    return interactionErrorResponse(error);
  }
}
