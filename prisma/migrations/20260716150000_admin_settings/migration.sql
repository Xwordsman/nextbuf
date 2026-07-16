CREATE TABLE "site_settings" (
  "id" VARCHAR(32) NOT NULL DEFAULT 'site',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "site_name" VARCHAR(80) NOT NULL DEFAULT 'NextBuf',
  "registration_mode" VARCHAR(16) NOT NULL DEFAULT 'open',
  "topics_enabled" BOOLEAN NOT NULL DEFAULT true,
  "replies_enabled" BOOLEAN NOT NULL DEFAULT true,
  "uploads_enabled" BOOLEAN NOT NULL DEFAULT true,
  "max_topics_per_hour" INTEGER NOT NULL DEFAULT 3,
  "max_replies_per_hour" INTEGER NOT NULL DEFAULT 20,
  "max_uploads_per_hour" INTEGER NOT NULL DEFAULT 20,
  "updated_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "site_settings_singleton_check" CHECK ("id" = 'site'),
  CONSTRAINT "site_settings_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "site_settings_name_check" CHECK (char_length(btrim("site_name")) BETWEEN 2 AND 80),
  CONSTRAINT "site_settings_registration_mode_check" CHECK ("registration_mode" IN ('open', 'invite', 'closed')),
  CONSTRAINT "site_settings_topic_limit_check" CHECK ("max_topics_per_hour" BETWEEN 1 AND 100),
  CONSTRAINT "site_settings_reply_limit_check" CHECK ("max_replies_per_hour" BETWEEN 1 AND 500),
  CONSTRAINT "site_settings_upload_limit_check" CHECK ("max_uploads_per_hour" BETWEEN 1 AND 200),
  CONSTRAINT "site_settings_updated_by_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "site_settings" ("id") VALUES ('site');

CREATE TABLE "admin_reauthentications" (
  "session_id" UUID NOT NULL,
  "verified_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_reauthentications_pkey" PRIMARY KEY ("session_id"),
  CONSTRAINT "admin_reauthentications_expiry_check" CHECK ("expires_at" > "verified_at"),
  CONSTRAINT "admin_reauthentications_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "admin_reauthentications_expires_idx" ON "admin_reauthentications"("expires_at");
