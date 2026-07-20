import { z } from "zod";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { CommunityError } from "@/modules/community/errors";
import { createTopic } from "@/modules/community/topics.server";
import { hasSameOrigin } from "@/shared/http/same-origin";
import { MAX_EDITOR_SESSION_REVISION } from "@/shared/community/editor-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  nodeSlug: z.string().trim().min(1).max(64),
  title: z.string().max(200),
  body: z.string().max(25_000),
  action: z.enum(["draft", "publish"]),
  editorSessionKey: z.string().uuid(),
  editorSessionRevision: z.number().int().min(1).max(MAX_EDITOR_SESSION_REVISION),
});

function errorResponse(error: unknown) {
  if (error instanceof CommunityError) {
    return Response.json(
      { ok: false, code: error.code, details: error.details },
      {
        status: error.status,
        headers:
          error.code === "topic_rate_limited"
            ? { "Retry-After": String(error.details?.retryAfter ?? 3600) }
            : undefined,
      },
    );
  }
  throw error;
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ code: "invalid_topic" }, { status: 400 });

  try {
    const topic = await createTopic(
      { userId: session.user.id, requestId: request.headers.get("x-request-id") ?? undefined },
      input.data,
    );
    return Response.json(
      {
        ok: true,
        number: topic.number,
        status: topic.status,
        editorSessionRevision: topic.editorSessionRevision,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
