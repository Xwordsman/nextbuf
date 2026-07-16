import { ModerationError } from "@/modules/moderation/errors";
import { TrustError } from "@/modules/trust/errors";

export function moderationErrorResponse(error: unknown): Response {
  if (error instanceof ModerationError || error instanceof TrustError) {
    return Response.json(
      { ok: false, code: error.code, details: "details" in error ? error.details : undefined },
      {
        status: error.status,
        headers:
          error instanceof ModerationError && error.code === "report_rate_limited"
            ? { "Retry-After": String(error.details?.retryAfter ?? 86_400) }
            : undefined,
      },
    );
  }
  throw error;
}
