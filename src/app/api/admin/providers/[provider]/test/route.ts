import { adminErrorResponse } from "@/modules/admin/response";
import { testProviderConnection, type ProviderName } from "@/modules/admin/providers.server";
import { getRequestSession } from "@/modules/identity/current-session.server";
import { hasSameOrigin } from "@/shared/http/same-origin";
import { resolveRequestId } from "@/shared/http/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const providers = new Set<ProviderName>(["mail", "storage", "github"]);

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  if (!hasSameOrigin(request)) return Response.json({ code: "invalid_origin" }, { status: 403 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
  const provider = (await context.params).provider as ProviderName;
  if (!providers.has(provider))
    return Response.json({ code: "provider_unavailable" }, { status: 404 });
  try {
    const result = await testProviderConnection({
      actorId: session.user.id,
      provider,
      requestId: resolveRequestId(request.headers.get("x-request-id")),
    });
    return Response.json({ ok: result.ok, message: result.message, checkedAt: result.checkedAt });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
