-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "activated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_status_check" CHECK ("status" IN ('pending', 'active', 'restricted', 'suspended', 'deleted'))
);

CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "ip_address" VARCHAR(64),
    "user_agent" TEXT,
    "user_id" UUID NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_accounts" (
    "id" UUID NOT NULL,
    "account_id" VARCHAR(255) NOT NULL,
    "provider_id" VARCHAR(80) NOT NULL,
    "user_id" UUID NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(6),
    "refresh_token_expires_at" TIMESTAMPTZ(6),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auth_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_verifications" (
    "id" UUID NOT NULL,
    "identifier" CHAR(64) NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auth_verifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "registration_invites" (
    "id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "label" VARCHAR(120),
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6),
    "disabled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_invites_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "registration_invites_max_uses_check" CHECK ("max_uses" > 0),
    CONSTRAINT "registration_invites_use_count_check" CHECK ("use_count" >= 0 AND "use_count" <= "max_uses")
);

CREATE TABLE "identity_audit_events" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(160) NOT NULL,
    "user_id" UUID,
    "session_id" UUID,
    "ip_hash" CHAR(64),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "email_deliveries" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(80) NOT NULL,
    "recipient" VARCHAR(320) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "initialization_vector" VARCHAR(32) NOT NULL,
    "auth_tag" VARCHAR(32) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_deliveries_status_check" CHECK ("status" IN ('pending', 'sending', 'sent', 'failed'))
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_status_idx" ON "users"("status");
CREATE UNIQUE INDEX "auth_sessions_token_key" ON "auth_sessions"("token");
CREATE INDEX "auth_sessions_user_expires_idx" ON "auth_sessions"("user_id", "expires_at");
CREATE UNIQUE INDEX "auth_accounts_provider_account_key" ON "auth_accounts"("provider_id", "account_id");
CREATE INDEX "auth_accounts_user_idx" ON "auth_accounts"("user_id");
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications"("identifier");
CREATE INDEX "auth_verifications_expires_idx" ON "auth_verifications"("expires_at");
CREATE UNIQUE INDEX "registration_invites_code_hash_key" ON "registration_invites"("code_hash");
CREATE INDEX "registration_invites_expires_idx" ON "registration_invites"("expires_at");
CREATE INDEX "identity_audit_user_created_idx" ON "identity_audit_events"("user_id", "created_at");
CREATE INDEX "identity_audit_event_created_idx" ON "identity_audit_events"("event_type", "created_at");
CREATE INDEX "email_deliveries_status_created_idx" ON "email_deliveries"("status", "created_at");

ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
