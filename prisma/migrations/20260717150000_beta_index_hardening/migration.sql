-- v0.13.0 Beta hardening: every single-column foreign key must have a valid
-- leading-column index so parent updates/deletes and relationship lookups do
-- not degrade into full table scans as community data grows.
CREATE INDEX "community_posts_deleted_by_idx" ON "community_posts"("deleted_by_id");
CREATE INDEX "community_post_drafts_quoted_post_idx" ON "community_post_drafts"("quoted_post_id");
CREATE INDEX "community_role_assignments_node_idx" ON "community_role_assignments"("node_id");
CREATE INDEX "community_role_assignments_granted_by_idx" ON "community_role_assignments"("granted_by_id");

CREATE INDEX "moderation_cases_created_by_idx" ON "moderation_cases"("created_by_id");
CREATE INDEX "moderation_cases_assigned_to_idx" ON "moderation_cases"("assigned_to_id");
CREATE INDEX "moderation_reports_topic_idx" ON "moderation_reports"("topic_id");
CREATE INDEX "moderation_reports_post_idx" ON "moderation_reports"("post_id");
CREATE INDEX "moderation_reports_reported_user_idx" ON "moderation_reports"("reported_user_id");
CREATE INDEX "moderation_actions_topic_idx" ON "moderation_actions"("topic_id");
CREATE INDEX "moderation_actions_post_idx" ON "moderation_actions"("post_id");
CREATE INDEX "moderation_actions_target_user_idx" ON "moderation_actions"("target_user_id");
CREATE INDEX "moderation_actions_node_idx" ON "moderation_actions"("node_id");
CREATE INDEX "moderation_sanctions_case_idx" ON "moderation_sanctions"("case_id");
CREATE INDEX "moderation_sanctions_created_by_idx" ON "moderation_sanctions"("created_by_id");
CREATE INDEX "moderation_sanctions_revoked_by_idx" ON "moderation_sanctions"("revoked_by_id");

CREATE INDEX "trust_rule_versions_created_by_idx" ON "trust_rule_versions"("created_by_id");
CREATE INDEX "trust_user_states_rule_version_idx" ON "trust_user_states"("rule_version_id");
CREATE INDEX "trust_level_history_rule_version_idx" ON "trust_level_history"("rule_version_id");
CREATE INDEX "trust_level_history_actor_idx" ON "trust_level_history"("actor_id");
CREATE INDEX "trust_recalculation_batches_requested_by_idx" ON "trust_recalculation_batches"("requested_by_id");
CREATE INDEX "community_audit_node_created_idx" ON "community_audit_events"("node_id", "created_at");

CREATE INDEX "interaction_topic_read_states_topic_idx" ON "interaction_topic_read_states"("topic_id");
CREATE INDEX "site_settings_updated_by_idx" ON "site_settings"("updated_by_id");
CREATE INDEX "notifications_actor_idx" ON "notifications"("actor_id");
CREATE INDEX "notifications_topic_idx" ON "notifications"("topic_id");
CREATE INDEX "notifications_post_idx" ON "notifications"("post_id");
CREATE INDEX "worker_job_failures_replay_requested_by_idx" ON "worker_job_failures"("replay_requested_by_id");
