BEGIN;

-- Keep completed Outbox history durable without making every recovery pass
-- anti-join the entire historical event table against processed_jobs.
ALTER TABLE "outbox_events"
ADD COLUMN "processed_at" TIMESTAMPTZ(6);

UPDATE "outbox_events" AS "event"
SET "processed_at" = "processed"."completed_at"
FROM "processed_jobs" AS "processed"
WHERE "processed"."queue_name" = 'system'
  AND "processed"."idempotency_key" = 'outbox-' || "event"."id"::text
  AND "event"."processed_at" IS NULL;

CREATE INDEX "outbox_events_recovery_pending_idx"
ON "outbox_events" ("published_at", "occurred_at")
WHERE "processed_at" IS NULL
  AND "published_at" IS NOT NULL;

COMMIT;
