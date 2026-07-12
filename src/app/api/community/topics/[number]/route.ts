import { z } from "zod";
import { CommunityError } from "@/modules/community/errors";
import {
  deleteTopic,
  moderateTopic,
  restoreTopic,
  updateTopicContent,
} from "@/modules/community/topics.server";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { hasSameOrigin } from "@/shared/http/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contentSchema = z.object({
  action: z.enum(["save", "publish"]),
  nodeSlug: z.string().trim().min(1).max(64),
  title: z.string().max(200),
  body: z.string().max(25_000),
});
const stateSchema = z.union([
  z.object({ action: z.literal("delete") }),
  z.object({ action: z.literal("restore") }),
]);
const moderationSchema = z.object({
  action: z.literal("moderate"),
  isPinned: z.boolean(),
  isEssence: z.boolean(),
  isClosed: z.boolean(),
  isHidden: z.boolean(),
});
const schema = z.union([contentSchema, stateSchema, moderationSchema]);

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

export async function PATCH(request: Request, context: { params: Promise<{ number: string }> }) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const number = Number((await context.params).number);
  if (!Number.isSafeInteger(number) || number < 1) {
    return Response.json({ code: "topic_not_found" }, { status: 404 });
  }
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ code: "invalid_topic" }, { status: 400 });
  const writeContext = {
    userId: session.user.id,
    requestId: request.headers.get("x-request-id") ?? undefined,
  };

  try {
    let topic;
    if (input.data.action === "delete") {
      topic = await deleteTopic(writeContext, number);
    } else if (input.data.action === "restore") {
      topic = await restoreTopic(writeContext, number);
    } else if (input.data.action === "moderate") {
      topic = await moderateTopic(writeContext, number, input.data);
    } else {
      topic = await updateTopicContent(writeContext, number, input.data);
    }
    return Response.json({ ok: true, number: topic.number, status: topic.status });
  } catch (error) {
    return errorResponse(error);
  }
}
