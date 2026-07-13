import { CommunityError } from "@/modules/community/errors";

export function communityErrorResponse(error: unknown): Response {
  if (!(error instanceof CommunityError)) throw error;
  const retryAfter = [
    "topic_rate_limited",
    "reply_rate_limited",
    "attachment_rate_limited",
  ].includes(error.code)
    ? String(error.details?.retryAfter ?? 3600)
    : null;
  return Response.json(
    { ok: false, code: error.code, details: error.details },
    { status: error.status, headers: retryAfter ? { "Retry-After": retryAfter } : undefined },
  );
}
