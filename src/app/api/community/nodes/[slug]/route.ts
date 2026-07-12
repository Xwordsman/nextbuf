import { z } from "zod";
import { CommunityError } from "@/modules/community/errors";
import { updateCommunityNode } from "@/modules/community/nodes.server";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { hasSameOrigin } from "@/shared/http/same-origin";

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  icon: z.enum(["bot", "code", "server", "globe", "network", "sparkles", "grid"]),
  sortOrder: z.number().int().min(-10_000).max(10_000),
  visibility: z.enum(["public", "hidden"]),
  archived: z.boolean(),
});

export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ code: "invalid_node" }, { status: 400 });
  try {
    const node = await updateCommunityNode(
      { userId: session.user.id, requestId: request.headers.get("x-request-id") ?? undefined },
      (await context.params).slug,
      input.data,
    );
    return Response.json({ ok: true, slug: node.slug });
  } catch (error) {
    if (error instanceof CommunityError) {
      return Response.json({ ok: false, code: error.code }, { status: error.status });
    }
    throw error;
  }
}
