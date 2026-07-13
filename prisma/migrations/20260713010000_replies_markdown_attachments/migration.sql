ALTER TABLE "community_topics"
    ADD COLUMN "next_post_position" INTEGER NOT NULL DEFAULT 2;

ALTER TABLE "community_topics"
    ADD CONSTRAINT "community_topics_next_post_position_check"
    CHECK ("next_post_position" >= 2);

ALTER TABLE "community_posts"
    ADD COLUMN "quoted_post_id" UUID,
    ADD COLUMN "deleted_by_id" UUID,
    ADD COLUMN "deleted_reason" VARCHAR(500);

ALTER TABLE "community_post_revisions"
    ALTER COLUMN "title" DROP NOT NULL;

ALTER TABLE "community_audit_events"
    ADD COLUMN "post_id" UUID;

CREATE TABLE "community_post_drafts" (
    "id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "quoted_post_id" UUID,
    "body_source" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "community_post_drafts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "community_post_drafts_body_length_check"
        CHECK (char_length("body_source") <= 20000)
);

CREATE TABLE "community_post_mentions" (
    "post_id" UUID NOT NULL,
    "mentioned_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_post_mentions_pkey" PRIMARY KEY ("post_id", "mentioned_user_id")
);

CREATE TABLE "community_attachments" (
    "id" UUID NOT NULL,
    "uploader_id" UUID NOT NULL,
    "storage_driver" VARCHAR(16) NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "processed_key" VARCHAR(500),
    "original_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "processed_type" VARCHAR(100),
    "kind" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "size_bytes" INTEGER NOT NULL,
    "checksum_sha256" CHAR(64) NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "processing_error" TEXT,
    "orphaned_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "community_attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "community_attachments_driver_check" CHECK ("storage_driver" IN ('local', 's3')),
    CONSTRAINT "community_attachments_kind_check" CHECK ("kind" IN ('image', 'file')),
    CONSTRAINT "community_attachments_status_check" CHECK ("status" IN ('pending', 'ready', 'failed')),
    CONSTRAINT "community_attachments_size_check" CHECK ("size_bytes" BETWEEN 1 AND 52428800),
    CONSTRAINT "community_attachments_checksum_check" CHECK ("checksum_sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "community_attachments_dimensions_check"
        CHECK (("width" IS NULL AND "height" IS NULL) OR ("width" > 0 AND "height" > 0))
);

CREATE TABLE "community_post_attachments" (
    "post_id" UUID NOT NULL,
    "attachment_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_post_attachments_pkey" PRIMARY KEY ("post_id", "attachment_id")
);

CREATE TABLE "community_revision_attachments" (
    "revision_id" UUID NOT NULL,
    "attachment_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_revision_attachments_pkey" PRIMARY KEY ("revision_id", "attachment_id")
);

CREATE TABLE "community_post_draft_attachments" (
    "draft_id" UUID NOT NULL,
    "attachment_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_post_draft_attachments_pkey" PRIMARY KEY ("draft_id", "attachment_id")
);

CREATE UNIQUE INDEX "community_post_drafts_topic_author_key"
    ON "community_post_drafts"("topic_id", "author_id");
CREATE INDEX "community_post_drafts_author_updated_idx"
    ON "community_post_drafts"("author_id", "updated_at");
CREATE INDEX "community_post_mentions_user_created_idx"
    ON "community_post_mentions"("mentioned_user_id", "created_at");
CREATE UNIQUE INDEX "community_attachments_storage_key"
    ON "community_attachments"("storage_driver", "storage_key");
CREATE INDEX "community_attachments_uploader_created_idx"
    ON "community_attachments"("uploader_id", "created_at");
CREATE INDEX "community_attachments_status_orphaned_idx"
    ON "community_attachments"("status", "orphaned_at");
CREATE INDEX "community_post_attachments_attachment_idx"
    ON "community_post_attachments"("attachment_id");
CREATE INDEX "community_revision_attachments_attachment_idx"
    ON "community_revision_attachments"("attachment_id");
CREATE INDEX "community_post_draft_attachments_attachment_idx"
    ON "community_post_draft_attachments"("attachment_id");
CREATE INDEX "community_posts_quoted_post_idx" ON "community_posts"("quoted_post_id");
CREATE INDEX "community_audit_post_created_idx"
    ON "community_audit_events"("post_id", "created_at");

ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_quoted_post_id_fkey"
    FOREIGN KEY ("quoted_post_id") REFERENCES "community_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_deleted_by_id_fkey"
    FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "community_post_drafts" ADD CONSTRAINT "community_post_drafts_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "community_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_post_drafts" ADD CONSTRAINT "community_post_drafts_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_post_drafts" ADD CONSTRAINT "community_post_drafts_quoted_post_id_fkey"
    FOREIGN KEY ("quoted_post_id") REFERENCES "community_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "community_post_mentions" ADD CONSTRAINT "community_post_mentions_post_id_fkey"
    FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_post_mentions" ADD CONSTRAINT "community_post_mentions_user_id_fkey"
    FOREIGN KEY ("mentioned_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_attachments" ADD CONSTRAINT "community_attachments_uploader_id_fkey"
    FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "community_post_attachments" ADD CONSTRAINT "community_post_attachments_post_id_fkey"
    FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_post_attachments" ADD CONSTRAINT "community_post_attachments_attachment_id_fkey"
    FOREIGN KEY ("attachment_id") REFERENCES "community_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_revision_attachments" ADD CONSTRAINT "community_revision_attachments_revision_id_fkey"
    FOREIGN KEY ("revision_id") REFERENCES "community_post_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_revision_attachments" ADD CONSTRAINT "community_revision_attachments_attachment_id_fkey"
    FOREIGN KEY ("attachment_id") REFERENCES "community_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_post_draft_attachments" ADD CONSTRAINT "community_post_draft_attachments_draft_id_fkey"
    FOREIGN KEY ("draft_id") REFERENCES "community_post_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_post_draft_attachments" ADD CONSTRAINT "community_post_draft_attachments_attachment_id_fkey"
    FOREIGN KEY ("attachment_id") REFERENCES "community_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_audit_events" ADD CONSTRAINT "community_audit_events_post_id_fkey"
    FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE FUNCTION validate_community_quote_topic() RETURNS trigger AS $$
DECLARE
    quoted_topic UUID;
BEGIN
    IF NEW."quoted_post_id" IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT "topic_id" INTO quoted_topic FROM "community_posts" WHERE "id" = NEW."quoted_post_id";
    IF quoted_topic IS NULL OR quoted_topic <> NEW."topic_id" THEN
        RAISE EXCEPTION 'quoted post must belong to the same topic' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "community_posts_quote_topic_check"
    BEFORE INSERT OR UPDATE OF "quoted_post_id", "topic_id" ON "community_posts"
    FOR EACH ROW EXECUTE FUNCTION validate_community_quote_topic();

CREATE TRIGGER "community_post_drafts_quote_topic_check"
    BEFORE INSERT OR UPDATE OF "quoted_post_id", "topic_id" ON "community_post_drafts"
    FOR EACH ROW EXECUTE FUNCTION validate_community_quote_topic();
