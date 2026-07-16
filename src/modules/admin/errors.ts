export type AdminErrorCode =
  | "forbidden"
  | "invalid_password"
  | "reauthentication_required"
  | "confirmation_required"
  | "revision_conflict"
  | "user_not_found"
  | "invalid_operation"
  | "provider_unavailable";

export class AdminError extends Error {
  constructor(
    public readonly code: AdminErrorCode,
    public readonly status: 400 | 401 | 403 | 404 | 409 | 503,
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
  }
}
