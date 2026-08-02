BEGIN;

-- Fence every external SMTP attempt independently from Redis/BullMQ state.
ALTER TABLE "email_deliveries"
    ADD COLUMN "attempt_token" UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN "attempt_generation" INTEGER NOT NULL DEFAULT 0,
    DROP CONSTRAINT "email_deliveries_status_check";

UPDATE "email_deliveries"
SET "attempt_generation" = "attempts";

-- A committed `sending` row from an older Worker has an indeterminate external
-- result. Preserve that fact instead of collapsing it into an ordinary failure.
UPDATE "email_deliveries"
SET "status" = 'outcome_unknown',
    "last_error" = 'Mail delivery failed (EOUTCOMEUNKNOWN)',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "status" = 'sending';

UPDATE "notification_deliveries" AS notification_delivery
SET "status" = 'failed',
    "updated_at" = CURRENT_TIMESTAMP
FROM "email_deliveries" AS delivery
WHERE notification_delivery."email_delivery_id" = delivery."id"
  AND delivery."status" = 'outcome_unknown'
  AND notification_delivery."status" <> 'delivered';

ALTER TABLE "email_deliveries"
    ADD CONSTRAINT "email_deliveries_status_check"
        CHECK ("status" IN ('pending', 'sending', 'sent', 'failed', 'outcome_unknown')),
    ADD CONSTRAINT "email_deliveries_attempts_check"
        CHECK ("attempts" >= 0),
    ADD CONSTRAINT "email_deliveries_attempt_generation_check"
        CHECK ("attempt_generation" >= "attempts");

ALTER TABLE "worker_job_failures"
    ADD COLUMN "replay_duplicate_risk_acknowledged_at" TIMESTAMPTZ(6);

COMMIT;
