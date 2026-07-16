import { InteractionError } from "@/modules/interactions/errors";

export function interactionErrorResponse(error: unknown): Response {
  if (!(error instanceof InteractionError)) throw error;
  return Response.json({ ok: false, code: error.code }, { status: error.status });
}
