import { z } from "zod";
import { communityErrorResponse } from "@/app/api/community/community-response";
import { deleteReply, restoreReply, updateReply } from "@/modules/community/replies.server";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { hasSameOrigin } from "@/shared/http/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.union([
  z.object({
    action: z.literal("save"),
    body: z.string().max(25_000),
    quotedPosition: z.number().int().min(1).nullable().optional(),
  }),
  z.object({ action: z.literal("delete") }),
  z.object({ action: z.literal("restore") }),
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ number: string; position: string }> },
) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const params = await context.params;
  const number = Number(params.number);
  const position = Number(params.position);
  if (
    !Number.isSafeInteger(number) ||
    number < 1 ||
    !Number.isSafeInteger(position) ||
    position < 2
  ) {
    return Response.json({ code: "post_not_found" }, { status: 404 });
  }
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ code: "invalid_post" }, { status: 400 });
  const writeContext = {
    userId: session.user.id,
    requestId: request.headers.get("x-request-id") ?? undefined,
  };
  try {
    const reply =
      input.data.action === "delete"
        ? await deleteReply(writeContext, number, position)
        : input.data.action === "restore"
          ? await restoreReply(writeContext, number, position)
          : await updateReply(writeContext, number, position, input.data);
    return Response.json({ ok: true, position: reply.position, status: reply.status });
  } catch (error) {
    return communityErrorResponse(error);
  }
}
