export class InteractionError extends Error {
  constructor(
    public readonly code:
      | "unauthorized"
      | "forbidden"
      | "invalid_interaction"
      | "topic_not_found"
      | "post_not_found"
      | "user_not_found"
      | "cannot_follow_self",
    public readonly status: number,
  ) {
    super(code);
  }
}
