import { z } from "zod";
import { moderationErrorResponse } from "@/app/api/moderation/moderation-response";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { createModerationReport } from "@/modules/moderation/reports.server";
import { hasSameOrigin } from "@/shared/http/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const targetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("topic"), number: z.number().int().positive() }),
  z.object({
    type: z.literal("post"),
    number: z.number().int().positive(),
    position: z.number().int().positive(),
  }),
  z.object({ type: z.literal("user"), username: z.string().trim().min(3).max(24) }),
]);
const schema = z.object({
  target: targetSchema,
  reason: z.enum(["spam", "abuse", "harassment", "illegal", "privacy", "other"]),
  details: z.string().trim().max(2000).default(""),
});

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ code: "invalid_report" }, { status: 400 });
  try {
    const result = await createModerationReport({
      reporterId: session.user.id,
      ...parsed.data,
    });
    return Response.json({ ok: true, reportId: result.report.id, caseNumber: result.caseNumber });
  } catch (error) {
    return moderationErrorResponse(error);
  }
}
