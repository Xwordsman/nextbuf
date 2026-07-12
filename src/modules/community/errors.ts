export class CommunityError extends Error {
  constructor(
    public readonly code:
      | "unauthorized"
      | "forbidden"
      | "invalid_topic"
      | "node_unavailable"
      | "topic_not_found"
      | "topic_rate_limited"
      | "draft_limit_reached"
      | "invalid_topic_state",
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
  }
}
