export class ModerationError extends Error {
  constructor(
    public readonly code:
      | "unauthorized"
      | "forbidden"
      | "invalid_report"
      | "report_not_found"
      | "case_not_found"
      | "case_closed"
      | "duplicate_report"
      | "report_rate_limited"
      | "invalid_action"
      | "sanction_not_found"
      | "role_not_found"
      | "last_admin",
    public readonly status: 400 | 401 | 403 | 404 | 409 | 429,
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
  }
}
