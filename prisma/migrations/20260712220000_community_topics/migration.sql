CREATE SEQUENCE "community_topics_number_seq" START 1 INCREMENT 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE "community_nodes" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500) NOT NULL DEFAULT '',
    "color" CHAR(7) NOT NULL,
    "icon" VARCHAR(32) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "visibility" VARCHAR(32) NOT NULL DEFAULT 'public',
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "community_nodes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "community_nodes_slug_check" CHECK ("slug" ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$'),
    CONSTRAINT "community_nodes_color_check" CHECK ("color" ~ '^#[0-9A-Fa-f]{6}$'),
    CONSTRAINT "community_nodes_visibility_check" CHECK ("visibility" IN ('public', 'hidden'))
);

CREATE TABLE "community_topics" (
    "id" UUID NOT NULL,
    "number" INTEGER NOT NULL DEFAULT nextval('community_topics_number_seq'),
    "node_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'draft',
    "deleted_from_status" VARCHAR(32),
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "is_essence" BOOLEAN NOT NULL DEFAULT false,
    "reply_count" INTEGER NOT NULL DEFAULT 0,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "bookmark_count" INTEGER NOT NULL DEFAULT 0,
    "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "edited_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "community_topics_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "community_topics_title_check" CHECK (char_length("title") BETWEEN 1 AND 120),
    CONSTRAINT "community_topics_status_check" CHECK ("status" IN ('draft', 'published', 'closed', 'hidden', 'deleted')),
    CONSTRAINT "community_topics_deleted_from_status_check" CHECK ("deleted_from_status" IS NULL OR "deleted_from_status" IN ('draft', 'published', 'closed', 'hidden')),
    CONSTRAINT "community_topics_counts_check" CHECK ("reply_count" >= 0 AND "view_count" >= 0 AND "bookmark_count" >= 0)
);

ALTER SEQUENCE "community_topics_number_seq" OWNED BY "community_topics"."number";

CREATE TABLE "community_posts" (
    "id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'draft',
    "body_source" TEXT NOT NULL,
    "revision_count" INTEGER NOT NULL DEFAULT 1,
    "edited_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "community_posts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "community_posts_position_check" CHECK ("position" >= 1),
    CONSTRAINT "community_posts_status_check" CHECK ("status" IN ('draft', 'published', 'hidden', 'deleted')),
    CONSTRAINT "community_posts_body_length_check" CHECK (char_length("body_source") <= 20000),
    CONSTRAINT "community_posts_revision_count_check" CHECK ("revision_count" >= 1)
);

CREATE TABLE "community_post_revisions" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "editor_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body_source" TEXT NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_post_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "community_post_revisions_version_check" CHECK ("version" >= 1),
    CONSTRAINT "community_post_revisions_source_check" CHECK ("source" IN ('create', 'edit', 'publish', 'moderation')),
    CONSTRAINT "community_post_revisions_body_length_check" CHECK (char_length("body_source") <= 20000)
);

CREATE TABLE "community_role_assignments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(32) NOT NULL,
    "node_id" UUID,
    "scope_key" VARCHAR(64) NOT NULL,
    "granted_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_role_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "community_role_assignments_role_check" CHECK ("role" IN ('admin', 'global_moderator', 'node_moderator')),
    CONSTRAINT "community_role_assignments_scope_check" CHECK (
        ("role" IN ('admin', 'global_moderator') AND "node_id" IS NULL AND "scope_key" = 'site') OR
        ("role" = 'node_moderator' AND "node_id" IS NOT NULL AND "scope_key" = "node_id"::text)
    )
);

CREATE TABLE "community_audit_events" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "topic_id" UUID,
    "node_id" UUID,
    "request_id" VARCHAR(64),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "community_nodes_slug_key" ON "community_nodes"("slug");
CREATE INDEX "community_nodes_browse_idx" ON "community_nodes"("visibility", "archived_at", "sort_order");
CREATE UNIQUE INDEX "community_topics_number_key" ON "community_topics"("number");
CREATE INDEX "community_topics_feed_idx" ON "community_topics"("status", "is_pinned", "last_activity_at", "number");
CREATE INDEX "community_topics_node_feed_idx" ON "community_topics"("node_id", "status", "is_pinned", "last_activity_at", "number");
CREATE INDEX "community_topics_author_status_idx" ON "community_topics"("author_id", "status", "updated_at");
CREATE UNIQUE INDEX "community_posts_topic_position_key" ON "community_posts"("topic_id", "position");
CREATE INDEX "community_posts_author_created_idx" ON "community_posts"("author_id", "created_at");
CREATE INDEX "community_posts_topic_status_idx" ON "community_posts"("topic_id", "status");
CREATE UNIQUE INDEX "community_post_revisions_post_version_key" ON "community_post_revisions"("post_id", "version");
CREATE INDEX "community_post_revisions_editor_created_idx" ON "community_post_revisions"("editor_id", "created_at");
CREATE UNIQUE INDEX "community_role_assignments_user_role_scope_key" ON "community_role_assignments"("user_id", "role", "scope_key");
CREATE INDEX "community_role_assignments_role_scope_idx" ON "community_role_assignments"("role", "scope_key");
CREATE INDEX "community_audit_topic_created_idx" ON "community_audit_events"("topic_id", "created_at");
CREATE INDEX "community_audit_actor_created_idx" ON "community_audit_events"("actor_id", "created_at");
CREATE INDEX "community_audit_action_created_idx" ON "community_audit_events"("action", "created_at");

ALTER TABLE "community_topics" ADD CONSTRAINT "community_topics_node_id_fkey"
    FOREIGN KEY ("node_id") REFERENCES "community_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "community_topics" ADD CONSTRAINT "community_topics_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "community_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "community_post_revisions" ADD CONSTRAINT "community_post_revisions_post_id_fkey"
    FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_post_revisions" ADD CONSTRAINT "community_post_revisions_editor_id_fkey"
    FOREIGN KEY ("editor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "community_role_assignments" ADD CONSTRAINT "community_role_assignments_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_role_assignments" ADD CONSTRAINT "community_role_assignments_node_id_fkey"
    FOREIGN KEY ("node_id") REFERENCES "community_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_role_assignments" ADD CONSTRAINT "community_role_assignments_granted_by_id_fkey"
    FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "community_audit_events" ADD CONSTRAINT "community_audit_events_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "community_audit_events" ADD CONSTRAINT "community_audit_events_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "community_topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "community_audit_events" ADD CONSTRAINT "community_audit_events_node_id_fkey"
    FOREIGN KEY ("node_id") REFERENCES "community_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "community_nodes" (
    "id", "slug", "name", "description", "color", "icon", "sort_order", "updated_at"
) VALUES
    ('10000000-0000-4000-8000-000000000001', 'ai', '人工智能', 'AI 模型、应用、工具与行业实践。', '#7c3aed', 'bot', 10, CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000002', 'site', '建站开发', '网站开发、产品设计与技术栈。', '#2563eb', 'code', 20, CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000003', 'host', '主机云服务', '服务器、VPS、云平台与托管服务。', '#0f766e', 'server', 30, CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000004', 'domain', '域名 DNS', '域名注册、交易、解析与 DNS。', '#c2410c', 'globe', 40, CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000005', 'ops', '运维网络', '系统运维、网络、安全与可观测性。', '#0369a1', 'network', 50, CURRENT_TIMESTAMP),
    ('10000000-0000-4000-8000-000000000006', 'showcase', '项目展示', '展示作品、开源项目与实践成果。', '#be185d', 'sparkles', 60, CURRENT_TIMESTAMP);
