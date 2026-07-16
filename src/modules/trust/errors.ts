export class TrustError extends Error {
  constructor(
    public readonly code:
      | "forbidden"
      | "rule_not_found"
      | "invalid_rule_state"
      | "preview_required"
      | "batch_in_progress"
      | "user_not_found",
    public readonly status: 403 | 404 | 409,
  ) {
    super(code);
  }
}
