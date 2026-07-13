import { z } from "zod";
import { renderCommunityMarkdown } from "@/modules/community/markdown.server";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { hasSameOrigin } from "@/shared/http/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ body: z.string().max(20_000) });

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ code: "invalid_post" }, { status: 400 });
  return Response.json({ ok: true, html: renderCommunityMarkdown(input.data.body) });
}
