CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "actor_id" UUID,
    "type" VARCHAR(48) NOT NULL,
    "topic_id" UUID,
    "post_id" UUID,
    "dedupe_key" VARCHAR(255) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "read_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_type_check" CHECK ("type" IN ('mention', 'reply', 'followed_topic_reply', 'management'))
);

CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "type" VARCHAR(48) NOT NULL,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id", "type"),
    CONSTRAINT "notification_preferences_type_check" CHECK ("type" IN ('mention', 'reply', 'followed_topic_reply', 'management'))
);

CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "channel" VARCHAR(24) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "skipped_reason" VARCHAR(120),
    "email_delivery_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_deliveries_channel_check" CHECK ("channel" IN ('in_app', 'email')),
    CONSTRAINT "notification_deliveries_status_check" CHECK ("status" IN ('delivered', 'queued', 'skipped', 'failed'))
);

CREATE TABLE "worker_job_failures" (
    "id" UUID NOT NULL,
    "queue_name" VARCHAR(120) NOT NULL,
    "job_id" VARCHAR(255) NOT NULL,
    "job_name" VARCHAR(160) NOT NULL,
    "outbox_event_id" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT NOT NULL,
    "failed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replay_requested_at" TIMESTAMPTZ(6),
    "replay_requested_by_id" UUID,
    "replayed_at" TIMESTAMPTZ(6),
    "replay_count" INTEGER NOT NULL DEFAULT 0,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "worker_job_failures_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "worker_job_failures_attempts_check" CHECK ("attempts" >= 0),
    CONSTRAINT "worker_job_failures_replay_count_check" CHECK ("replay_count" >= 0)
);

CREATE TABLE "worker_scheduled_tasks" (
    "name" VARCHAR(120) NOT NULL,
    "interval_seconds" INTEGER NOT NULL,
    "next_run_at" TIMESTAMPTZ(6) NOT NULL,
    "locked_at" TIMESTAMPTZ(6),
    "lock_owner" VARCHAR(160),
    "last_started_at" TIMESTAMPTZ(6),
    "last_completed_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "worker_scheduled_tasks_pkey" PRIMARY KEY ("name"),
    CONSTRAINT "worker_scheduled_tasks_interval_check" CHECK ("interval_seconds" >= 5),
    CONSTRAINT "worker_scheduled_tasks_run_count_check" CHECK ("run_count" >= 0)
);

CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");
CREATE INDEX "notifications_recipient_archive_created_idx" ON "notifications"("recipient_id", "archived_at", "created_at");
CREATE INDEX "notifications_recipient_read_created_idx" ON "notifications"("recipient_id", "read_at", "created_at");
CREATE UNIQUE INDEX "notification_deliveries_notification_channel_key" ON "notification_deliveries"("notification_id", "channel");
CREATE UNIQUE INDEX "notification_deliveries_email_delivery_id_key" ON "notification_deliveries"("email_delivery_id");
CREATE INDEX "notification_deliveries_channel_status_created_idx" ON "notification_deliveries"("channel", "status", "created_at");
CREATE UNIQUE INDEX "worker_job_failures_queue_job_key" ON "worker_job_failures"("queue_name", "job_id");
CREATE INDEX "worker_job_failures_resolved_failed_idx" ON "worker_job_failures"("resolved_at", "failed_at");
CREATE INDEX "worker_job_failures_replay_idx" ON "worker_job_failures"("replay_requested_at", "replayed_at");
CREATE INDEX "worker_scheduled_tasks_due_idx" ON "worker_scheduled_tasks"("next_run_at", "locked_at");

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey"
    FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "community_topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_post_id_fkey"
    FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey"
    FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_email_delivery_id_fkey"
    FOREIGN KEY ("email_delivery_id") REFERENCES "email_deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "worker_job_failures" ADD CONSTRAINT "worker_job_failures_replay_requested_by_id_fkey"
    FOREIGN KEY ("replay_requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "worker_scheduled_tasks" (
    "name", "interval_seconds", "next_run_at", "updated_at"
) VALUES (
    'worker.maintenance', 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
) ON CONFLICT ("name") DO NOTHING;
