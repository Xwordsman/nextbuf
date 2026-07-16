CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "community_posts"
    ADD COLUMN "like_count" INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT "community_posts_like_count_check" CHECK ("like_count" >= 0);

ALTER TABLE "community_topics"
    ADD CONSTRAINT "community_topics_bookmark_count_check" CHECK ("bookmark_count" >= 0),
    ADD CONSTRAINT "community_topics_view_count_check" CHECK ("view_count" >= 0);

CREATE TABLE "interaction_post_likes" (
    "user_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interaction_post_likes_pkey" PRIMARY KEY ("user_id", "post_id")
);

CREATE TABLE "interaction_topic_bookmarks" (
    "user_id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interaction_topic_bookmarks_pkey" PRIMARY KEY ("user_id", "topic_id")
);

CREATE TABLE "interaction_user_follows" (
    "follower_id" UUID NOT NULL,
    "followed_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interaction_user_follows_pkey" PRIMARY KEY ("follower_id", "followed_id"),
    CONSTRAINT "interaction_user_follows_not_self_check" CHECK ("follower_id" <> "followed_id")
);

CREATE TABLE "interaction_topic_follows" (
    "user_id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interaction_topic_follows_pkey" PRIMARY KEY ("user_id", "topic_id")
);

CREATE TABLE "interaction_topic_read_states" (
    "user_id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "last_read_position" INTEGER NOT NULL DEFAULT 1,
    "last_read_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "interaction_topic_read_states_pkey" PRIMARY KEY ("user_id", "topic_id"),
    CONSTRAINT "interaction_topic_read_states_position_check" CHECK ("last_read_position" >= 1)
);

CREATE TABLE "interaction_topic_views" (
    "id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "viewer_key_hash" CHAR(64) NOT NULL,
    "bucket_started_at" TIMESTAMPTZ(6) NOT NULL,
    "counted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interaction_topic_views_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "interaction_topic_views_hash_check" CHECK ("viewer_key_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "interaction_topic_views_bucket_check" CHECK (
        EXTRACT(SECOND FROM "bucket_started_at") = 0
        AND MOD(EXTRACT(MINUTE FROM "bucket_started_at")::INTEGER, 30) = 0
    )
);

CREATE INDEX "interaction_post_likes_post_created_idx"
    ON "interaction_post_likes"("post_id", "created_at");
CREATE INDEX "interaction_topic_bookmarks_user_created_idx"
    ON "interaction_topic_bookmarks"("user_id", "created_at");
CREATE INDEX "interaction_topic_bookmarks_topic_created_idx"
    ON "interaction_topic_bookmarks"("topic_id", "created_at");
CREATE INDEX "interaction_user_follows_follower_created_idx"
    ON "interaction_user_follows"("follower_id", "created_at");
CREATE INDEX "interaction_user_follows_followed_created_idx"
    ON "interaction_user_follows"("followed_id", "created_at");
CREATE INDEX "interaction_topic_follows_user_created_idx"
    ON "interaction_topic_follows"("user_id", "created_at");
CREATE INDEX "interaction_topic_follows_topic_created_idx"
    ON "interaction_topic_follows"("topic_id", "created_at");
CREATE INDEX "interaction_topic_read_states_user_read_idx"
    ON "interaction_topic_read_states"("user_id", "last_read_at");
CREATE UNIQUE INDEX "interaction_topic_views_dedupe_key"
    ON "interaction_topic_views"("topic_id", "viewer_key_hash", "bucket_started_at");
CREATE INDEX "interaction_topic_views_counted_created_idx"
    ON "interaction_topic_views"("counted_at", "created_at");

ALTER TABLE "interaction_post_likes" ADD CONSTRAINT "interaction_post_likes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interaction_post_likes" ADD CONSTRAINT "interaction_post_likes_post_id_fkey"
    FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interaction_topic_bookmarks" ADD CONSTRAINT "interaction_topic_bookmarks_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interaction_topic_bookmarks" ADD CONSTRAINT "interaction_topic_bookmarks_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "community_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interaction_user_follows" ADD CONSTRAINT "interaction_user_follows_follower_id_fkey"
    FOREIGN KEY ("follower_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interaction_user_follows" ADD CONSTRAINT "interaction_user_follows_followed_id_fkey"
    FOREIGN KEY ("followed_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interaction_topic_follows" ADD CONSTRAINT "interaction_topic_follows_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interaction_topic_follows" ADD CONSTRAINT "interaction_topic_follows_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "community_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interaction_topic_read_states" ADD CONSTRAINT "interaction_topic_read_states_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interaction_topic_read_states" ADD CONSTRAINT "interaction_topic_read_states_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "community_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interaction_topic_views" ADD CONSTRAINT "interaction_topic_views_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "community_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "community_topics_title_fts_idx"
    ON "community_topics" USING GIN (to_tsvector('simple', "title"));
CREATE INDEX "community_topics_title_trgm_idx"
    ON "community_topics" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "community_posts_body_fts_idx"
    ON "community_posts" USING GIN (to_tsvector('simple', "body_source"));
CREATE INDEX "community_posts_body_trgm_idx"
    ON "community_posts" USING GIN ("body_source" gin_trgm_ops);
CREATE INDEX "users_public_identity_fts_idx"
    ON "users" USING GIN (to_tsvector('simple', "username" || ' ' || "name"));
CREATE INDEX "users_username_trgm_idx" ON "users" USING GIN ("username" gin_trgm_ops);
CREATE INDEX "users_name_trgm_idx" ON "users" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "profiles_bio_fts_idx" ON "profiles" USING GIN (to_tsvector('simple', "bio"));
CREATE INDEX "profiles_bio_trgm_idx" ON "profiles" USING GIN ("bio" gin_trgm_ops);
CREATE INDEX "community_nodes_search_fts_idx"
    ON "community_nodes" USING GIN (to_tsvector('simple', "name" || ' ' || "description"));
CREATE INDEX "community_nodes_name_trgm_idx"
    ON "community_nodes" USING GIN ("name" gin_trgm_ops);
