export class CommunityError extends Error {
  constructor(
    public readonly code:
      | "unauthorized"
      | "forbidden"
      | "invalid_topic"
      | "invalid_post"
      | "post_not_found"
      | "reply_rate_limited"
      | "topic_closed"
      | "invalid_attachment"
      | "attachment_too_large"
      | "attachment_not_ready"
      | "attachment_rate_limited"
      | "topic_posting_disabled"
      | "reply_posting_disabled"
      | "uploads_disabled"
      | "node_conflict"
      | "node_unavailable"
      | "topic_not_found"
      | "topic_rate_limited"
      | "draft_limit_reached"
      | "editor_session_conflict"
      | "editor_session_rate_limited"
      | "invalid_topic_state",
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
  }
}
