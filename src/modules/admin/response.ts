import { AdminError } from "@/modules/admin/errors";

export function adminErrorResponse(error: unknown): Response {
  if (!(error instanceof AdminError)) throw error;
  return Response.json(
    { ok: false, code: error.code, details: error.details },
    { status: error.status },
  );
}
