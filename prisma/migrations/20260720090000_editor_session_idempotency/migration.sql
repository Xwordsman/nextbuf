ALTER TABLE "community_topics"
    ADD COLUMN "editor_session_key" UUID,
    ADD COLUMN "editor_session_revision" INTEGER;

ALTER TABLE "community_topics"
    ADD CONSTRAINT "community_topics_editor_session_check"
    CHECK (
        ("editor_session_key" IS NULL AND "editor_session_revision" IS NULL)
        OR
        (
            "editor_session_key" IS NOT NULL
            AND "editor_session_revision" IS NOT NULL
            AND "editor_session_revision" >= 1
        )
    );

CREATE UNIQUE INDEX "community_topics_author_editor_session_key"
    ON "community_topics"("author_id", "editor_session_key");

ALTER TABLE "community_posts"
    ADD COLUMN "editor_session_key" UUID,
    ADD COLUMN "editor_session_revision" INTEGER;

ALTER TABLE "community_posts"
    ADD CONSTRAINT "community_posts_editor_session_check"
    CHECK (
        ("editor_session_key" IS NULL AND "editor_session_revision" IS NULL)
        OR
        (
            "editor_session_key" IS NOT NULL
            AND "editor_session_revision" IS NOT NULL
            AND "editor_session_revision" >= 1
            AND "position" > 1
        )
    );

CREATE UNIQUE INDEX "community_posts_author_editor_session_key"
    ON "community_posts"("author_id", "editor_session_key");

ALTER TABLE "community_post_drafts"
    ADD COLUMN "editor_session_key" UUID,
    ADD COLUMN "editor_session_revision" INTEGER;

ALTER TABLE "community_post_drafts"
    ADD CONSTRAINT "community_post_drafts_editor_session_check"
    CHECK (
        ("editor_session_key" IS NULL AND "editor_session_revision" IS NULL)
        OR
        (
            "editor_session_key" IS NOT NULL
            AND "editor_session_revision" IS NOT NULL
            AND "editor_session_revision" >= 1
        )
    );

CREATE UNIQUE INDEX "community_post_drafts_author_editor_session_key"
    ON "community_post_drafts"("author_id", "editor_session_key");

CREATE TABLE "community_reply_editor_sessions" (
    "id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "key" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "state" VARCHAR(16) NOT NULL DEFAULT 'active',
    "post_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "community_reply_editor_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "community_reply_editor_sessions_state_check" CHECK (
        "revision" >= 1
        AND "state" IN ('active', 'cleared', 'published', 'superseded')
        AND (
            ("state" = 'published' AND "post_id" IS NOT NULL)
            OR
            ("state" <> 'published' AND "post_id" IS NULL)
        )
    )
);

CREATE UNIQUE INDEX "community_reply_editor_sessions_author_key"
    ON "community_reply_editor_sessions"("author_id", "key");

CREATE UNIQUE INDEX "community_reply_editor_sessions_post_key"
    ON "community_reply_editor_sessions"("post_id");

CREATE INDEX "community_reply_editor_sessions_topic_author_state_idx"
    ON "community_reply_editor_sessions"("topic_id", "author_id", "state");

CREATE INDEX "community_reply_editor_sessions_author_created_idx"
    ON "community_reply_editor_sessions"("author_id", "created_at");

CREATE INDEX "community_reply_editor_sessions_state_updated_idx"
    ON "community_reply_editor_sessions"("state", "updated_at");

ALTER TABLE "community_reply_editor_sessions"
    ADD CONSTRAINT "community_reply_editor_sessions_topic_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "community_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "community_reply_editor_sessions"
    ADD CONSTRAINT "community_reply_editor_sessions_author_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "community_reply_editor_sessions"
    ADD CONSTRAINT "community_reply_editor_sessions_post_fkey"
    FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
