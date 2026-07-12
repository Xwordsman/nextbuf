-- CreateTable
CREATE TABLE "system_state" (
    "key" VARCHAR(120) NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "system_state_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "topic" VARCHAR(160) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "locked_at" TIMESTAMPTZ(6),
    "lock_owner" VARCHAR(160),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_jobs" (
    "id" UUID NOT NULL,
    "queue_name" VARCHAR(120) NOT NULL,
    "job_name" VARCHAR(160) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "result" JSONB,
    "completed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_heartbeats" (
    "worker_id" VARCHAR(160) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "version" VARCHAR(64) NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "heartbeat_at" TIMESTAMPTZ(6) NOT NULL,
    "stopped_at" TIMESTAMPTZ(6),
    "metadata" JSONB,

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("worker_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_idempotency_key_key" ON "outbox_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "outbox_events_publishable_idx" ON "outbox_events"("published_at", "available_at");

-- CreateIndex
CREATE INDEX "outbox_events_locked_at_idx" ON "outbox_events"("locked_at");

-- CreateIndex
CREATE UNIQUE INDEX "processed_jobs_queue_idempotency_key" ON "processed_jobs"("queue_name", "idempotency_key");

-- CreateIndex
CREATE INDEX "processed_jobs_completed_at_idx" ON "processed_jobs"("completed_at");

-- CreateIndex
CREATE INDEX "worker_heartbeats_heartbeat_at_idx" ON "worker_heartbeats"("heartbeat_at");
