ALTER TABLE "community_role_assignments" ADD COLUMN "reason" VARCHAR(500);

CREATE SEQUENCE "moderation_cases_number_seq" START 1 INCREMENT 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE "trust_rule_versions_version_seq" START 1 INCREMENT 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE "moderation_cases" (
    "id" UUID NOT NULL,
    "number" INTEGER NOT NULL DEFAULT nextval('moderation_cases_number_seq'),
    "target_type" VARCHAR(24) NOT NULL,
    "target_key" VARCHAR(96) NOT NULL,
    "active_target_key" VARCHAR(96),
    "topic_id" UUID,
    "post_id" UUID,
    "reported_user_id" UUID,
    "status" VARCHAR(24) NOT NULL DEFAULT 'open',
    "priority_score" INTEGER NOT NULL DEFAULT 0,
    "summary" VARCHAR(500),
    "created_by_id" UUID,
    "assigned_to_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "dismissed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "moderation_cases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "moderation_cases_status_check" CHECK ("status" IN ('open', 'in_review', 'resolved', 'dismissed')),
    CONSTRAINT "moderation_cases_priority_check" CHECK ("priority_score" >= 0),
    CONSTRAINT "moderation_cases_target_check" CHECK (
        ("target_type" = 'topic' AND "topic_id" IS NOT NULL AND "post_id" IS NULL AND "reported_user_id" IS NULL) OR
        ("target_type" = 'post' AND "topic_id" IS NOT NULL AND "post_id" IS NOT NULL AND "reported_user_id" IS NULL) OR
        ("target_type" = 'user' AND "topic_id" IS NULL AND "post_id" IS NULL AND "reported_user_id" IS NOT NULL)
    ),
    CONSTRAINT "moderation_cases_active_key_check" CHECK (
        ("status" IN ('open', 'in_review') AND "active_target_key" IS NOT NULL AND "active_target_key" = "target_key") OR
        ("status" IN ('resolved', 'dismissed') AND "active_target_key" IS NULL)
    )
);

ALTER SEQUENCE "moderation_cases_number_seq" OWNED BY "moderation_cases"."number";

CREATE TABLE "moderation_reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "target_type" VARCHAR(24) NOT NULL,
    "target_key" VARCHAR(96) NOT NULL,
    "active_target_key" VARCHAR(96),
    "topic_id" UUID,
    "post_id" UUID,
    "reported_user_id" UUID,
    "reason" VARCHAR(32) NOT NULL,
    "details" VARCHAR(2000) NOT NULL DEFAULT '',
    "status" VARCHAR(24) NOT NULL DEFAULT 'open',
    "reporter_trust_level" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "snapshot" JSONB NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "moderation_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "moderation_reports_reason_check" CHECK ("reason" IN ('spam', 'abuse', 'harassment', 'illegal', 'privacy', 'other')),
    CONSTRAINT "moderation_reports_status_check" CHECK ("status" IN ('open', 'resolved', 'dismissed')),
    CONSTRAINT "moderation_reports_trust_check" CHECK ("reporter_trust_level" BETWEEN 0 AND 4),
    CONSTRAINT "moderation_reports_weight_check" CHECK ("weight" BETWEEN 1 AND 5),
    CONSTRAINT "moderation_reports_snapshot_check" CHECK (jsonb_typeof("snapshot") = 'object'),
    CONSTRAINT "moderation_reports_target_check" CHECK (
        ("target_type" = 'topic' AND "topic_id" IS NOT NULL AND "post_id" IS NULL AND "reported_user_id" IS NULL) OR
        ("target_type" = 'post' AND "topic_id" IS NOT NULL AND "post_id" IS NOT NULL AND "reported_user_id" IS NULL) OR
        ("target_type" = 'user' AND "topic_id" IS NULL AND "post_id" IS NULL AND "reported_user_id" IS NOT NULL)
    ),
    CONSTRAINT "moderation_reports_active_key_check" CHECK (
        ("status" = 'open' AND "active_target_key" IS NOT NULL AND "active_target_key" = "target_key") OR
        ("status" IN ('resolved', 'dismissed') AND "active_target_key" IS NULL)
    )
);

CREATE TABLE "moderation_actions" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "actor_roles" JSONB NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "target_type" VARCHAR(24) NOT NULL,
    "target_key" VARCHAR(96) NOT NULL,
    "topic_id" UUID,
    "post_id" UUID,
    "target_user_id" UUID,
    "node_id" UUID,
    "reason" VARCHAR(500) NOT NULL,
    "before_state" JSONB NOT NULL,
    "after_state" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "request_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_actions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "moderation_actions_action_check" CHECK ("action" IN (
        'warn', 'hide', 'restore', 'close', 'node_mute', 'site_mute', 'suspend', 'ban',
        'revoke_sanction', 'resolve', 'dismiss', 'assign'
    )),
    CONSTRAINT "moderation_actions_actor_roles_check" CHECK (jsonb_typeof("actor_roles") = 'array'),
    CONSTRAINT "moderation_actions_target_check" CHECK (
        ("target_type" = 'topic' AND "topic_id" IS NOT NULL AND "post_id" IS NULL AND "target_user_id" IS NULL) OR
        ("target_type" = 'post' AND "topic_id" IS NOT NULL AND "post_id" IS NOT NULL AND "target_user_id" IS NULL) OR
        ("target_type" = 'user' AND "topic_id" IS NULL AND "post_id" IS NULL AND "target_user_id" IS NOT NULL) OR
        ("target_type" = 'node' AND "topic_id" IS NULL AND "post_id" IS NULL AND "target_user_id" IS NULL AND "node_id" IS NOT NULL) OR
        ("target_type" IN ('case', 'sanction') AND "topic_id" IS NULL AND "post_id" IS NULL)
    ),
    CONSTRAINT "moderation_actions_reason_check" CHECK (char_length(btrim("reason")) BETWEEN 3 AND 500),
    CONSTRAINT "moderation_actions_request_id_check" CHECK (char_length(btrim("request_id")) BETWEEN 1 AND 128)
);

CREATE TABLE "moderation_sanctions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "node_id" UUID,
    "case_id" UUID NOT NULL,
    "action_id" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(6),
    "created_by_id" UUID NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_id" UUID,
    "revocation_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "moderation_sanctions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "moderation_sanctions_type_check" CHECK ("type" IN ('warning', 'node_mute', 'site_mute', 'suspend', 'ban')),
    CONSTRAINT "moderation_sanctions_scope_check" CHECK (
        ("type" = 'node_mute' AND "node_id" IS NOT NULL) OR
        ("type" <> 'node_mute' AND "node_id" IS NULL)
    ),
    CONSTRAINT "moderation_sanctions_window_check" CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at"),
    CONSTRAINT "moderation_sanctions_suspend_check" CHECK ("type" <> 'suspend' OR "ends_at" IS NOT NULL),
    CONSTRAINT "moderation_sanctions_ban_check" CHECK ("type" <> 'ban' OR "ends_at" IS NULL),
    CONSTRAINT "moderation_sanctions_revocation_check" CHECK (
        ("revoked_at" IS NULL AND "revoked_by_id" IS NULL AND "revocation_reason" IS NULL) OR
        ("revoked_at" IS NOT NULL AND "revoked_by_id" IS NOT NULL AND char_length(btrim("revocation_reason")) BETWEEN 3 AND 500)
    )
);

CREATE TABLE "governance_audit_events" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "actor_roles" JSONB NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "target_type" VARCHAR(32) NOT NULL,
    "target_key" VARCHAR(120) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "before_state" JSONB NOT NULL,
    "after_state" JSONB NOT NULL,
    "request_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "governance_audit_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "governance_audit_actor_roles_check" CHECK (jsonb_typeof("actor_roles") = 'array'),
    CONSTRAINT "governance_audit_reason_check" CHECK (char_length(btrim("reason")) BETWEEN 3 AND 500),
    CONSTRAINT "governance_audit_request_id_check" CHECK (char_length(btrim("request_id")) BETWEEN 1 AND 128)
);

CREATE TABLE "trust_rule_versions" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT nextval('trust_rule_versions_version_seq'),
    "status" VARCHAR(24) NOT NULL DEFAULT 'draft',
    "config" JSONB NOT NULL,
    "created_by_id" UUID,
    "activated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trust_rule_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "trust_rule_versions_status_check" CHECK ("status" IN ('draft', 'previewed', 'active', 'retired')),
    CONSTRAINT "trust_rule_versions_activation_check" CHECK (("status" = 'active') = ("activated_at" IS NOT NULL) OR "status" = 'retired'),
    CONSTRAINT "trust_rule_versions_config_check" CHECK (jsonb_typeof("config") = 'object')
);

ALTER SEQUENCE "trust_rule_versions_version_seq" OWNED BY "trust_rule_versions"."version";

CREATE TABLE "trust_user_states" (
    "user_id" UUID NOT NULL,
    "current_level" INTEGER NOT NULL DEFAULT 0,
    "automated_level" INTEGER NOT NULL DEFAULT 0,
    "manual_level" INTEGER,
    "rule_version_id" UUID NOT NULL,
    "metrics" JSONB NOT NULL,
    "explanation" JSONB NOT NULL,
    "grace_until" TIMESTAMPTZ(6),
    "calculated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "trust_user_states_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "trust_user_states_level_check" CHECK ("current_level" BETWEEN 0 AND 4 AND "automated_level" BETWEEN 0 AND 3),
    CONSTRAINT "trust_user_states_manual_check" CHECK ("manual_level" IS NULL OR "manual_level" = 4),
    CONSTRAINT "trust_user_states_effective_check" CHECK ("current_level" = COALESCE("manual_level", "automated_level")),
    CONSTRAINT "trust_user_states_json_check" CHECK (jsonb_typeof("metrics") = 'object' AND jsonb_typeof("explanation") = 'object')
);

CREATE TABLE "trust_recalculation_batches" (
    "id" UUID NOT NULL,
    "rule_version_id" UUID NOT NULL,
    "requested_by_id" UUID,
    "mode" VARCHAR(16) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'pending',
    "total_users" INTEGER NOT NULL DEFAULT 0,
    "processed_users" INTEGER NOT NULL DEFAULT 0,
    "changed_users" INTEGER NOT NULL DEFAULT 0,
    "cursor_uid" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB NOT NULL,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "trust_recalculation_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "trust_recalculation_batches_mode_check" CHECK ("mode" IN ('preview', 'apply')),
    CONSTRAINT "trust_recalculation_batches_status_check" CHECK ("status" IN ('pending', 'running', 'completed', 'failed')),
    CONSTRAINT "trust_recalculation_batches_counts_check" CHECK (
        "total_users" >= 0 AND "processed_users" >= 0 AND "changed_users" >= 0 AND "cursor_uid" >= 0 AND
        "processed_users" <= "total_users" AND "changed_users" <= "processed_users"
    ),
    CONSTRAINT "trust_recalculation_batches_summary_check" CHECK (jsonb_typeof("summary") = 'object')
);

CREATE TABLE "trust_level_history" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rule_version_id" UUID NOT NULL,
    "batch_id" UUID,
    "actor_id" UUID,
    "from_level" INTEGER NOT NULL,
    "to_level" INTEGER NOT NULL,
    "automated_level" INTEGER NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "reason" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trust_level_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "trust_level_history_level_check" CHECK ("from_level" BETWEEN 0 AND 4 AND "to_level" BETWEEN 0 AND 4 AND "automated_level" BETWEEN 0 AND 3),
    CONSTRAINT "trust_level_history_source_check" CHECK ("source" IN ('initial', 'automatic', 'grace', 'rule_apply', 'manual_tl4', 'manual_tl4_revoked')),
    CONSTRAINT "trust_level_history_json_check" CHECK (jsonb_typeof("reason") = 'object' AND jsonb_typeof("metrics") = 'object')
);

CREATE UNIQUE INDEX "moderation_cases_number_key" ON "moderation_cases"("number");
CREATE UNIQUE INDEX "moderation_cases_active_target_key" ON "moderation_cases"("active_target_key");
CREATE INDEX "moderation_cases_queue_idx" ON "moderation_cases"("status", "priority_score", "created_at");
CREATE INDEX "moderation_cases_topic_idx" ON "moderation_cases"("topic_id", "created_at");
CREATE INDEX "moderation_cases_post_idx" ON "moderation_cases"("post_id", "created_at");
CREATE INDEX "moderation_cases_user_idx" ON "moderation_cases"("reported_user_id", "created_at");
CREATE UNIQUE INDEX "moderation_reports_reporter_active_target_key" ON "moderation_reports"("reporter_id", "active_target_key");
CREATE INDEX "moderation_reports_case_created_idx" ON "moderation_reports"("case_id", "created_at");
CREATE INDEX "moderation_reports_reporter_created_idx" ON "moderation_reports"("reporter_id", "created_at");
CREATE INDEX "moderation_actions_case_created_idx" ON "moderation_actions"("case_id", "created_at");
CREATE INDEX "moderation_actions_actor_created_idx" ON "moderation_actions"("actor_id", "created_at");
CREATE UNIQUE INDEX "moderation_sanctions_action_id_key" ON "moderation_sanctions"("action_id");
CREATE INDEX "moderation_sanctions_user_active_idx" ON "moderation_sanctions"("user_id", "revoked_at", "starts_at", "ends_at");
CREATE INDEX "moderation_sanctions_node_user_idx" ON "moderation_sanctions"("node_id", "user_id", "revoked_at");
CREATE INDEX "governance_audit_actor_created_idx" ON "governance_audit_events"("actor_id", "created_at");
CREATE INDEX "governance_audit_target_created_idx" ON "governance_audit_events"("target_type", "target_key", "created_at");
CREATE UNIQUE INDEX "trust_rule_versions_version_key" ON "trust_rule_versions"("version");
CREATE UNIQUE INDEX "trust_rule_versions_single_active_idx" ON "trust_rule_versions"("status") WHERE "status" = 'active';
CREATE INDEX "trust_rule_versions_status_created_idx" ON "trust_rule_versions"("status", "created_at");
CREATE INDEX "trust_user_states_level_calculated_idx" ON "trust_user_states"("current_level", "calculated_at");
CREATE INDEX "trust_recalculation_batches_status_created_idx" ON "trust_recalculation_batches"("status", "created_at");
CREATE UNIQUE INDEX "trust_recalculation_batches_inflight_idx" ON "trust_recalculation_batches"("rule_version_id", "mode") WHERE "status" IN ('pending', 'running');
CREATE INDEX "trust_level_history_user_created_idx" ON "trust_level_history"("user_id", "created_at");
CREATE INDEX "trust_level_history_batch_idx" ON "trust_level_history"("batch_id");

ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "community_topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_reported_user_id_fkey" FOREIGN KEY ("reported_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "moderation_reports" ADD CONSTRAINT "moderation_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_reports" ADD CONSTRAINT "moderation_reports_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "moderation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_reports" ADD CONSTRAINT "moderation_reports_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "community_topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_reports" ADD CONSTRAINT "moderation_reports_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_reports" ADD CONSTRAINT "moderation_reports_reported_user_id_fkey" FOREIGN KEY ("reported_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "moderation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "community_topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "community_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_sanctions" ADD CONSTRAINT "moderation_sanctions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_sanctions" ADD CONSTRAINT "moderation_sanctions_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "community_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_sanctions" ADD CONSTRAINT "moderation_sanctions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "moderation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_sanctions" ADD CONSTRAINT "moderation_sanctions_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "moderation_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_sanctions" ADD CONSTRAINT "moderation_sanctions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_sanctions" ADD CONSTRAINT "moderation_sanctions_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "governance_audit_events" ADD CONSTRAINT "governance_audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trust_rule_versions" ADD CONSTRAINT "trust_rule_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "trust_user_states" ADD CONSTRAINT "trust_user_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trust_user_states" ADD CONSTRAINT "trust_user_states_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "trust_rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trust_recalculation_batches" ADD CONSTRAINT "trust_recalculation_batches_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "trust_rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trust_recalculation_batches" ADD CONSTRAINT "trust_recalculation_batches_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "trust_level_history" ADD CONSTRAINT "trust_level_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trust_level_history" ADD CONSTRAINT "trust_level_history_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "trust_rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trust_level_history" ADD CONSTRAINT "trust_level_history_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "trust_recalculation_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "trust_level_history" ADD CONSTRAINT "trust_level_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "trust_rule_versions" ("id", "status", "config", "activated_at") VALUES (
    '20000000-0000-4000-8000-000000000001',
    'active',
    '{"schemaVersion":1,"gracePeriodDays":14,"violationWindowDays":180,"levels":{"1":{"accountAgeDays":1,"readTopics":3,"posts":1,"likesReceived":0,"recentViolationsMax":0},"2":{"accountAgeDays":14,"readTopics":20,"posts":10,"likesReceived":3,"recentViolationsMax":0},"3":{"accountAgeDays":60,"readTopics":100,"posts":50,"likesReceived":20,"recentViolationsMax":0}}}'::jsonb,
    CURRENT_TIMESTAMP
);

INSERT INTO "trust_user_states" (
    "user_id", "current_level", "automated_level", "rule_version_id", "metrics", "explanation", "updated_at"
)
SELECT
    "id", 0, 0, '20000000-0000-4000-8000-000000000001',
    '{"accountAgeDays":0,"readTopics":0,"posts":0,"likesReceived":0,"recentViolations":0}'::jsonb,
    '{"level":0,"source":"initial","checks":[]}'::jsonb,
    CURRENT_TIMESTAMP
FROM "users";

CREATE FUNCTION nextbuf_create_trust_user_state() RETURNS trigger AS $$
DECLARE
    active_rule_id UUID;
BEGIN
    SELECT "id" INTO active_rule_id FROM "trust_rule_versions" WHERE "status" = 'active' LIMIT 1;
    IF active_rule_id IS NULL THEN
        RAISE EXCEPTION 'No active trust rule version';
    END IF;
    INSERT INTO "trust_user_states" (
        "user_id", "current_level", "automated_level", "rule_version_id", "metrics", "explanation", "updated_at"
    ) VALUES (
        NEW."id", 0, 0, active_rule_id,
        '{"accountAgeDays":0,"readTopics":0,"posts":0,"likesReceived":0,"recentViolations":0}'::jsonb,
        '{"level":0,"source":"initial","checks":[]}'::jsonb,
        CURRENT_TIMESTAMP
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_create_trust_user_state"
AFTER INSERT ON "users"
FOR EACH ROW EXECUTE FUNCTION nextbuf_create_trust_user_state();

INSERT INTO "worker_scheduled_tasks" (
    "name", "interval_seconds", "next_run_at", "updated_at"
) VALUES (
    'trust.daily-recalculation', 86400, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
) ON CONFLICT ("name") DO NOTHING;
