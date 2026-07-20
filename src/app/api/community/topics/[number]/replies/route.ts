import { z } from "zod";
import { communityErrorResponse } from "@/app/api/community/community-response";
import { createReply, saveReplyDraft } from "@/modules/community/replies.server";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { hasSameOrigin } from "@/shared/http/same-origin";
import { MAX_EDITOR_SESSION_REVISION } from "@/shared/community/editor-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  body: z.string().max(25_000),
  quotedPosition: z.number().int().min(1).nullable().optional(),
  editorSessionKey: z.string().uuid(),
  editorSessionRevision: z.number().int().min(1).max(MAX_EDITOR_SESSION_REVISION),
});

async function requestContext(request: Request, context: { params: Promise<{ number: string }> }) {
  if (!hasSameOrigin(request))
    return { response: Response.json({ code: "invalid_origin" }, { status: 403 }) };
  const session = await getRequestSession(request);
  if (!session) return { response: Response.json({ code: "unauthorized" }, { status: 401 }) };
  const number = Number((await context.params).number);
  if (!Number.isSafeInteger(number) || number < 1) {
    return { response: Response.json({ code: "topic_not_found" }, { status: 404 }) };
  }
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return { response: Response.json({ code: "invalid_post" }, { status: 400 }) };
  return { session, number, input: input.data };
}

export async function POST(request: Request, context: { params: Promise<{ number: string }> }) {
  const parsed = await requestContext(request, context);
  if ("response" in parsed) return parsed.response;
  try {
    const reply = await createReply(
      {
        userId: parsed.session.user.id,
        requestId: request.headers.get("x-request-id") ?? undefined,
      },
      parsed.number,
      parsed.input,
    );
    return Response.json(
      {
        ok: true,
        position: reply.position,
        editorSessionRevision: reply.editorSessionRevision,
      },
      { status: 201 },
    );
  } catch (error) {
    return communityErrorResponse(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ number: string }> }) {
  const parsed = await requestContext(request, context);
  if ("response" in parsed) return parsed.response;
  try {
    const draft = await saveReplyDraft(
      {
        userId: parsed.session.user.id,
        requestId: request.headers.get("x-request-id") ?? undefined,
      },
      parsed.number,
      parsed.input,
    );
    return Response.json({
      ok: true,
      savedAt: draft?.updatedAt.toISOString() ?? null,
      editorSessionRevision: draft?.editorSessionRevision ?? parsed.input.editorSessionRevision,
    });
  } catch (error) {
    return communityErrorResponse(error);
  }
}
