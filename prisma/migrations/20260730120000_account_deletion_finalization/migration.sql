BEGIN;

ALTER TABLE "users"
    ADD COLUMN "deletion_finalized_at" TIMESTAMPTZ(6),
    ADD COLUMN "deletion_attempt_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "deletion_next_attempt_at" TIMESTAMPTZ(6),
    ADD COLUMN "deletion_last_error" TEXT;

CREATE FUNCTION nextbuf_auth_verification_owner_id(verification_value TEXT) RETURNS UUID AS $$
DECLARE
    payload JSONB;
    candidate TEXT;
BEGIN
    BEGIN
        RETURN verification_value::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
        NULL;
    END;

    BEGIN
        payload := verification_value::JSONB;
    EXCEPTION WHEN invalid_text_representation THEN
        RETURN NULL;
    END;

    IF jsonb_typeof(payload) IS DISTINCT FROM 'object'
       OR jsonb_typeof(payload->'link') IS DISTINCT FROM 'object' THEN
        RETURN NULL;
    END IF;

    candidate := payload #>> '{link,userId}';
    IF candidate IS NULL THEN
        RETURN NULL;
    END IF;

    BEGIN
        RETURN candidate::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
        RETURN NULL;
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "users" AS user_account
        WHERE (
            lower(user_account."email") ~ '@deleted[.]invalid$'
            AND NOT (
                user_account."status" = 'deleted'
                AND lower(user_account."email") =
                    'deleted+' || lower(user_account."id"::text) || '@deleted.invalid'
            )
        ) OR (
            lower(user_account."username") ~ '^deleted-'
            AND NOT (
                user_account."status" = 'deleted'
                AND lower(user_account."username") = 'deleted-' || user_account."uid"::text
            )
        )
    ) OR EXISTS (
        SELECT 1 FROM "username_aliases"
        WHERE lower("username") ~ '^deleted-'
    ) OR EXISTS (
        SELECT 1
        FROM "users" AS user_account
        INNER JOIN "username_aliases" AS alias
            ON alias."username" = user_account."username"
           AND alias."user_id" <> user_account."id"
        WHERE user_account."status" = 'deleted'
    ) THEN
        RAISE EXCEPTION
            'reserved account tombstone namespace is already occupied; rename the conflicting active identity before upgrading'
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'users_account_tombstone_namespace_check';
    END IF;
END;
$$;

CREATE INDEX "email_deliveries_recipient_lower_idx"
    ON "email_deliveries"(lower("recipient"));

CREATE INDEX "outbox_events_mail_delivery_id_idx"
    ON "outbox_events"(("payload"->>'deliveryId'))
    WHERE "topic" IN (
        'nextbuf.identity.email.send',
        'nextbuf.mail.delivery.send'
    );

CREATE INDEX "worker_job_failures_outbox_event_id_idx"
    ON "worker_job_failures"("outbox_event_id");

CREATE INDEX "auth_verifications_owner_id_idx"
    ON "auth_verifications"(nextbuf_auth_verification_owner_id("value"))
    WHERE nextbuf_auth_verification_owner_id("value") IS NOT NULL;

INSERT INTO "username_aliases" ("id", "username", "user_id", "created_at")
SELECT gen_random_uuid(), user_account."username", user_account."id", CURRENT_TIMESTAMP
FROM "users" AS user_account
WHERE user_account."status" = 'deleted'
  AND lower(user_account."username") !~ '^deleted-'
ON CONFLICT ("username") DO NOTHING;

UPDATE "users"
SET "deletion_requested_at" = COALESCE("deletion_requested_at", CURRENT_TIMESTAMP),
    "deletion_scheduled_at" = CURRENT_TIMESTAMP,
    "deletion_next_attempt_at" = NULL,
    "deletion_last_error" = NULL,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "status" = 'deleted';

DELETE FROM "auth_accounts" AS auth_account
USING "users" AS user_account
WHERE auth_account."user_id" = user_account."id"
  AND user_account."status" = 'deleted';

DELETE FROM "auth_sessions" AS auth_session
USING "users" AS user_account
WHERE auth_session."user_id" = user_account."id"
  AND user_account."status" = 'deleted';

DELETE FROM "auth_verifications" AS verification
USING "users" AS user_account
WHERE user_account."status" = 'deleted'
  AND nextbuf_auth_verification_owner_id(verification."value") = user_account."id";

DELETE FROM "worker_job_failures" AS failure
USING "outbox_events" AS event
WHERE failure."outbox_event_id" = event."id"
  AND event."topic" IN (
      'nextbuf.identity.email.send',
      'nextbuf.mail.delivery.send'
  )
  AND EXISTS (
      SELECT 1
      FROM "email_deliveries" AS delivery
      LEFT JOIN "notification_deliveries" AS notification_delivery
        ON notification_delivery."email_delivery_id" = delivery."id"
      LEFT JOIN "notifications" AS notification
        ON notification."id" = notification_delivery."notification_id"
      WHERE event."payload"->>'deliveryId' = delivery."id"::text
        AND EXISTS (
            SELECT 1
            FROM "users" AS user_account
            WHERE user_account."status" = 'deleted'
              AND (
                  lower(delivery."recipient") = lower(user_account."email")
                  OR notification."actor_id" = user_account."id"
              )
        )
  );

UPDATE "outbox_events" AS event
SET "last_error" = NULL,
    "updated_at" = CURRENT_TIMESTAMP
WHERE event."topic" IN (
      'nextbuf.identity.email.send',
      'nextbuf.mail.delivery.send'
  )
  AND EXISTS (
      SELECT 1
      FROM "email_deliveries" AS delivery
      LEFT JOIN "notification_deliveries" AS notification_delivery
        ON notification_delivery."email_delivery_id" = delivery."id"
      LEFT JOIN "notifications" AS notification
        ON notification."id" = notification_delivery."notification_id"
      WHERE event."payload"->>'deliveryId' = delivery."id"::text
        AND EXISTS (
            SELECT 1
            FROM "users" AS user_account
            WHERE user_account."status" = 'deleted'
              AND (
                  lower(delivery."recipient") = lower(user_account."email")
                  OR notification."actor_id" = user_account."id"
              )
        )
  );

DELETE FROM "email_deliveries" AS delivery
WHERE EXISTS (
    SELECT 1
    FROM "users" AS user_account
    WHERE user_account."status" = 'deleted'
      AND lower(delivery."recipient") = lower(user_account."email")
  )
  OR EXISTS (
      SELECT 1
      FROM "notification_deliveries" AS notification_delivery
      INNER JOIN "notifications" AS notification
        ON notification."id" = notification_delivery."notification_id"
      INNER JOIN "users" AS user_account
        ON user_account."id" = notification."actor_id"
       AND user_account."status" = 'deleted'
      WHERE notification_delivery."email_delivery_id" = delivery."id"
  );

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "users"
        WHERE ("deletion_requested_at" IS NULL) <> ("deletion_scheduled_at" IS NULL)
    ) THEN
        RAISE EXCEPTION
            'account deletion request and schedule must either both be set or both be empty before upgrading'
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'users_deletion_finalized_state_check';
    END IF;
END;
$$;

ALTER TABLE "users"
    ADD CONSTRAINT "users_deletion_attempt_count_check"
        CHECK ("deletion_attempt_count" >= 0),
    ADD CONSTRAINT "users_deletion_finalized_state_check"
        CHECK (
            (
                "deletion_finalized_at" IS NULL
                AND (
                    (
                        "status" <> 'deleted'
                        AND "deletion_requested_at" IS NULL
                        AND "deletion_scheduled_at" IS NULL
                        AND "deletion_attempt_count" = 0
                        AND "deletion_next_attempt_at" IS NULL
                        AND "deletion_last_error" IS NULL
                    ) OR (
                        "deletion_requested_at" IS NOT NULL
                        AND "deletion_scheduled_at" IS NOT NULL
                    )
                )
            ) OR (
                "status" = 'deleted'
                AND "deletion_finalized_at" IS NOT NULL
                AND "name" = '已注销用户'
                AND "email_verified" = FALSE
                AND "image" IS NULL
                AND "activated_at" IS NULL
                AND "username_changed_at" IS NULL
                AND "deletion_requested_at" IS NULL
                AND "deletion_scheduled_at" IS NULL
                AND "deletion_next_attempt_at" IS NULL
                AND "deletion_last_error" IS NULL
            )
        ),
    ADD CONSTRAINT "users_account_tombstone_namespace_check"
        CHECK (
            (
                "deletion_finalized_at" IS NOT NULL
                AND "email" = 'deleted+' || "id"::text || '@deleted.invalid'
                AND "username" = 'deleted-' || "uid"::text
            ) OR (
                "deletion_finalized_at" IS NULL
                AND (
                    lower("email") !~ '@deleted[.]invalid$'
                    OR (
                        "status" = 'deleted'
                        AND lower("email") =
                            'deleted+' || lower("id"::text) || '@deleted.invalid'
                    )
                )
                AND (
                    lower("username") !~ '^deleted-'
                    OR (
                        "status" = 'deleted'
                        AND lower("username") = 'deleted-' || "uid"::text
                    )
                )
            )
        );

ALTER TABLE "username_aliases"
    ADD CONSTRAINT "username_aliases_tombstone_namespace_check"
        CHECK (lower("username") !~ '^deleted-');

CREATE INDEX "users_deletion_due_idx"
    ON "users"("deletion_scheduled_at", "deletion_next_attempt_at")
    WHERE "deletion_finalized_at" IS NULL
      AND "deletion_scheduled_at" IS NOT NULL;

ALTER TABLE "moderation_cases"
    DROP CONSTRAINT "moderation_cases_target_check",
    ADD CONSTRAINT "moderation_cases_target_check" CHECK (
        ("target_type" = 'topic' AND "post_id" IS NULL AND "reported_user_id" IS NULL) OR
        ("target_type" = 'post' AND "reported_user_id" IS NULL AND ("post_id" IS NULL OR "topic_id" IS NOT NULL)) OR
        ("target_type" = 'user' AND "topic_id" IS NULL AND "post_id" IS NULL AND "reported_user_id" IS NOT NULL)
    );

ALTER TABLE "moderation_reports"
    DROP CONSTRAINT "moderation_reports_target_check",
    ADD CONSTRAINT "moderation_reports_target_check" CHECK (
        ("target_type" = 'topic' AND "post_id" IS NULL AND "reported_user_id" IS NULL) OR
        ("target_type" = 'post' AND "reported_user_id" IS NULL AND ("post_id" IS NULL OR "topic_id" IS NOT NULL)) OR
        ("target_type" = 'user' AND "topic_id" IS NULL AND "post_id" IS NULL AND "reported_user_id" IS NOT NULL)
    );

ALTER TABLE "moderation_actions"
    DROP CONSTRAINT "moderation_actions_target_check",
    ADD CONSTRAINT "moderation_actions_target_check" CHECK (
        ("target_type" = 'topic' AND "post_id" IS NULL AND "target_user_id" IS NULL) OR
        ("target_type" = 'post' AND "target_user_id" IS NULL AND ("post_id" IS NULL OR "topic_id" IS NOT NULL)) OR
        ("target_type" = 'user' AND "topic_id" IS NULL AND "post_id" IS NULL AND "target_user_id" IS NOT NULL) OR
        ("target_type" = 'node' AND "topic_id" IS NULL AND "post_id" IS NULL AND "target_user_id" IS NULL AND "node_id" IS NOT NULL) OR
        ("target_type" IN ('case', 'sanction') AND "topic_id" IS NULL AND "post_id" IS NULL)
    );

CREATE FUNCTION nextbuf_guard_deleted_user_auth_fact() RETURNS trigger AS $$
DECLARE
    owner_status TEXT;
BEGIN
    SELECT "status"
      INTO owner_status
      FROM "users"
     WHERE "id" = NEW."user_id"
     FOR KEY SHARE;

    IF owner_status = 'deleted' THEN
        RAISE EXCEPTION 'authentication owner is deleted'
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = format('%s_active_user_check', TG_TABLE_NAME);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "auth_accounts_guard_deleted_user"
BEFORE INSERT OR UPDATE OF "user_id" ON "auth_accounts"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_auth_fact();

CREATE TRIGGER "auth_sessions_guard_deleted_user"
BEFORE INSERT OR UPDATE OF "user_id" ON "auth_sessions"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_auth_fact();

CREATE FUNCTION nextbuf_guard_deleted_user_verification() RETURNS trigger AS $$
DECLARE
    owner_id UUID;
    owner_status TEXT;
BEGIN
    owner_id := nextbuf_auth_verification_owner_id(NEW."value");
    IF owner_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT "status"
      INTO owner_status
      FROM "users"
     WHERE "id" = owner_id
     FOR KEY SHARE;

    IF owner_status = 'deleted' THEN
        RAISE EXCEPTION 'deleted user cannot own a verification'
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'auth_verifications_active_user_check';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "auth_verifications_guard_deleted_user"
BEFORE INSERT OR UPDATE OF "value" ON "auth_verifications"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_verification();

CREATE FUNCTION nextbuf_guard_deleted_user_reference() RETURNS trigger AS $$
DECLARE
    referenced_user_id UUID;
    owner_status TEXT;
BEGIN
    referenced_user_id := NULLIF(to_jsonb(NEW)->>TG_ARGV[0], '')::uuid;
    IF referenced_user_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT "status"
      INTO owner_status
      FROM "users"
     WHERE "id" = referenced_user_id
     FOR KEY SHARE;

    IF owner_status = 'deleted' THEN
        RAISE EXCEPTION 'deleted user cannot own a new private or mutable fact'
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = format('%s_%s_active_user_check', TG_TABLE_NAME, TG_ARGV[0]);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION nextbuf_guard_deleted_user_mutation() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."status" = 'deleted' THEN
            RAISE EXCEPTION 'deleted user tombstone cannot be deleted'
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'users_deleted_tombstone_immutable_check';
        END IF;
        RETURN OLD;
    END IF;

    IF OLD."deletion_finalized_at" IS NULL
       AND NEW."deletion_finalized_at" IS NOT NULL THEN
        IF OLD."deletion_requested_at" IS NULL
           OR OLD."deletion_scheduled_at" IS NULL
           OR OLD."deletion_attempt_count" < 1
           OR OLD."deletion_next_attempt_at" IS NULL
           OR OLD."deletion_scheduled_at" > NEW."deletion_finalized_at"
           OR OLD."deletion_next_attempt_at" <= NEW."deletion_finalized_at" THEN
            RAISE EXCEPTION 'deleted user tombstone requires an active finalization claim'
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'users_deleted_tombstone_finalization_claim_check';
        END IF;

        IF NEW."id" IS DISTINCT FROM OLD."id"
           OR NEW."uid" IS DISTINCT FROM OLD."uid"
           OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
           OR NEW."deletion_attempt_count" IS DISTINCT FROM OLD."deletion_attempt_count" THEN
            RAISE EXCEPTION 'deleted user tombstone must preserve immutable identity and finalization attempt facts'
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'users_deleted_tombstone_preserved_identity_check';
        END IF;

        IF NEW."username" IS DISTINCT FROM 'deleted-' || OLD."uid"::text
           OR NEW."email" IS DISTINCT FROM 'deleted+' || OLD."id"::text || '@deleted.invalid'
           OR NEW."name" IS DISTINCT FROM '已注销用户'
           OR NEW."email_verified" IS DISTINCT FROM FALSE
           OR NEW."image" IS NOT NULL
           OR NEW."activated_at" IS NOT NULL
           OR NEW."username_changed_at" IS NOT NULL THEN
            RAISE EXCEPTION 'deleted user tombstone identity is not canonical'
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'users_deleted_tombstone_identity_check';
        END IF;

        IF lower(OLD."username") !~ '^deleted-'
           AND NOT EXISTS (
               SELECT 1
               FROM "username_aliases"
               WHERE "username" = OLD."username"
                 AND "user_id" = OLD."id"
           ) THEN
            RAISE EXCEPTION 'deleted user tombstone requires a permanent alias for the prior username'
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'users_deleted_tombstone_alias_check';
        END IF;

        IF EXISTS (SELECT 1 FROM "auth_accounts" WHERE "user_id" = OLD."id")
           OR EXISTS (SELECT 1 FROM "auth_sessions" WHERE "user_id" = OLD."id")
           OR EXISTS (
               SELECT 1 FROM "auth_verifications"
               WHERE nextbuf_auth_verification_owner_id("value") = OLD."id"
           )
           OR EXISTS (SELECT 1 FROM "profiles" WHERE "user_id" = OLD."id")
           OR EXISTS (
               SELECT 1 FROM "community_topics"
               WHERE "author_id" = OLD."id"
                 AND (
                     "status" = 'draft'
                     OR (
                         "status" = 'deleted'
                         AND (
                             "deleted_from_status" IS NULL
                             OR "deleted_from_status" NOT IN ('published', 'closed', 'hidden')
                         )
                     )
                 )
           )
           OR EXISTS (
               SELECT 1 FROM "community_posts"
               WHERE "author_id" = OLD."id" AND "status" = 'draft'
           )
           OR EXISTS (SELECT 1 FROM "community_post_drafts" WHERE "author_id" = OLD."id")
           OR EXISTS (
               SELECT 1 FROM "community_reply_editor_sessions" WHERE "author_id" = OLD."id"
           )
           OR EXISTS (
               SELECT 1 FROM "community_post_mentions" WHERE "mentioned_user_id" = OLD."id"
           )
           OR EXISTS (SELECT 1 FROM "interaction_post_likes" WHERE "user_id" = OLD."id")
           OR EXISTS (SELECT 1 FROM "interaction_topic_bookmarks" WHERE "user_id" = OLD."id")
           OR EXISTS (
               SELECT 1 FROM "interaction_user_follows"
               WHERE "follower_id" = OLD."id" OR "followed_id" = OLD."id"
           )
           OR EXISTS (SELECT 1 FROM "interaction_topic_follows" WHERE "user_id" = OLD."id")
           OR EXISTS (
               SELECT 1 FROM "interaction_topic_read_states" WHERE "user_id" = OLD."id"
           )
           OR EXISTS (SELECT 1 FROM "notifications" WHERE "recipient_id" = OLD."id")
           OR EXISTS (SELECT 1 FROM "notifications" WHERE "actor_id" = OLD."id")
           OR EXISTS (SELECT 1 FROM "notification_preferences" WHERE "user_id" = OLD."id")
           OR EXISTS (SELECT 1 FROM "trust_user_states" WHERE "user_id" = OLD."id")
           OR EXISTS (
               SELECT 1 FROM "community_role_assignments"
               WHERE "user_id" = OLD."id" OR "granted_by_id" = OLD."id"
           )
           OR EXISTS (SELECT 1 FROM "moderation_cases" WHERE "assigned_to_id" = OLD."id")
           OR EXISTS (
               SELECT 1 FROM "worker_job_failures" WHERE "replay_requested_by_id" = OLD."id"
           )
           OR EXISTS (
               SELECT 1 FROM "identity_audit_events"
               WHERE "user_id" = OLD."id"
                 AND ("session_id" IS NOT NULL OR "ip_hash" IS NOT NULL OR "metadata" IS NOT NULL)
           )
           OR EXISTS (
               SELECT 1 FROM "community_audit_events"
               WHERE "actor_id" = OLD."id"
                 AND ("request_id" IS NOT NULL OR "metadata" IS NOT NULL)
           )
           OR EXISTS (
               SELECT 1 FROM "email_deliveries" WHERE lower("recipient") = lower(OLD."email")
           ) THEN
            RAISE EXCEPTION 'deleted user tombstone still owns private or mutable facts'
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'users_deleted_tombstone_cleanup_check';
        END IF;
    END IF;

    IF OLD."status" = 'deleted' THEN
        IF OLD."deletion_finalized_at" IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION 'deleted user tombstone is immutable'
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'users_deleted_tombstone_immutable_check';
        END IF;

        IF OLD."deletion_finalized_at" IS NULL THEN
            IF NEW."status" <> 'deleted' THEN
                RAISE EXCEPTION 'legacy deleted user cannot return to an active state'
                    USING ERRCODE = 'check_violation',
                          CONSTRAINT = 'users_deleted_tombstone_immutable_check';
            END IF;

            IF NEW."deletion_finalized_at" IS NULL
               AND (
                   to_jsonb(NEW) - ARRAY[
                       'deletion_attempt_count',
                       'deletion_next_attempt_at',
                       'deletion_last_error',
                       'updated_at'
                   ]
               ) IS DISTINCT FROM (
                   to_jsonb(OLD) - ARRAY[
                       'deletion_attempt_count',
                       'deletion_next_attempt_at',
                       'deletion_last_error',
                       'updated_at'
                   ]
               ) THEN
                RAISE EXCEPTION 'legacy deleted user may only advance through finalization'
                    USING ERRCODE = 'check_violation',
                          CONSTRAINT = 'users_deleted_tombstone_immutable_check';
            END IF;
        END IF;
    ELSIF NEW."status" = 'deleted' AND NEW."deletion_finalized_at" IS NULL THEN
        RAISE EXCEPTION 'new deleted users must be finalized atomically'
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'users_deleted_tombstone_immutable_check';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_guard_deleted_tombstone"
BEFORE UPDATE OR DELETE ON "users"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_mutation();

CREATE TRIGGER "profiles_guard_deleted_user"
BEFORE INSERT OR UPDATE OF "user_id" ON "profiles"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('user_id');

CREATE TRIGGER "username_aliases_guard_deleted_user"
BEFORE INSERT OR UPDATE OF "user_id" ON "username_aliases"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('user_id');

CREATE FUNCTION nextbuf_guard_deleted_username_alias_history() RETURNS trigger AS $$
DECLARE
    owner_status TEXT;
BEGIN
    SELECT "status"
      INTO owner_status
      FROM "users"
     WHERE "id" = OLD."user_id"
     FOR KEY SHARE;

    IF owner_status = 'deleted' THEN
        RAISE EXCEPTION 'deleted user username aliases are permanent'
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'username_aliases_deleted_history_immutable_check';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "username_aliases_guard_deleted_history"
BEFORE UPDATE OR DELETE ON "username_aliases"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_username_alias_history();

CREATE TRIGGER "community_topics_guard_deleted_author"
BEFORE INSERT OR UPDATE OF "author_id" ON "community_topics"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('author_id');

CREATE TRIGGER "community_posts_guard_deleted_author"
BEFORE INSERT OR UPDATE OF "author_id" ON "community_posts"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('author_id');

CREATE TRIGGER "community_posts_guard_deleted_actor"
BEFORE INSERT OR UPDATE OF "deleted_by_id" ON "community_posts"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('deleted_by_id');

CREATE TRIGGER "community_post_revisions_guard_deleted_editor"
BEFORE INSERT OR UPDATE OF "editor_id" ON "community_post_revisions"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('editor_id');

CREATE TRIGGER "community_post_drafts_guard_deleted_author"
BEFORE INSERT OR UPDATE OF "author_id" ON "community_post_drafts"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('author_id');

CREATE TRIGGER "community_reply_editor_sessions_guard_deleted_author"
BEFORE INSERT OR UPDATE OF "author_id" ON "community_reply_editor_sessions"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('author_id');

CREATE TRIGGER "community_post_mentions_guard_deleted_user"
BEFORE INSERT OR UPDATE OF "mentioned_user_id" ON "community_post_mentions"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('mentioned_user_id');

CREATE TRIGGER "community_attachments_guard_deleted_uploader"
BEFORE INSERT OR UPDATE OF "uploader_id" ON "community_attachments"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('uploader_id');

CREATE TRIGGER "community_roles_guard_deleted_user"
BEFORE INSERT OR UPDATE OF "user_id" ON "community_role_assignments"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('user_id');

CREATE TRIGGER "community_roles_guard_deleted_grantor"
BEFORE INSERT OR UPDATE OF "granted_by_id" ON "community_role_assignments"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('granted_by_id');

CREATE TRIGGER "moderation_cases_guard_deleted_creator"
BEFORE INSERT OR UPDATE OF "created_by_id" ON "moderation_cases"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('created_by_id');

CREATE TRIGGER "moderation_cases_guard_deleted_assignee"
BEFORE INSERT OR UPDATE OF "assigned_to_id" ON "moderation_cases"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('assigned_to_id');

CREATE TRIGGER "moderation_reports_guard_deleted_reporter"
BEFORE INSERT OR UPDATE OF "reporter_id" ON "moderation_reports"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('reporter_id');

CREATE TRIGGER "moderation_actions_guard_deleted_actor"
BEFORE INSERT OR UPDATE OF "actor_id" ON "moderation_actions"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('actor_id');

CREATE TRIGGER "moderation_sanctions_guard_deleted_creator"
BEFORE INSERT OR UPDATE OF "created_by_id" ON "moderation_sanctions"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('created_by_id');

CREATE TRIGGER "moderation_sanctions_guard_deleted_revoker"
BEFORE INSERT OR UPDATE OF "revoked_by_id" ON "moderation_sanctions"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('revoked_by_id');

CREATE TRIGGER "governance_audit_guard_deleted_actor"
BEFORE INSERT OR UPDATE OF "actor_id" ON "governance_audit_events"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('actor_id');

CREATE TRIGGER "trust_rules_guard_deleted_creator"
BEFORE INSERT OR UPDATE OF "created_by_id" ON "trust_rule_versions"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('created_by_id');

CREATE TRIGGER "trust_states_guard_deleted_user"
BEFORE INSERT OR UPDATE OF "user_id" ON "trust_user_states"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('user_id');

CREATE TRIGGER "trust_history_guard_deleted_user"
BEFORE INSERT OR UPDATE OF "user_id" ON "trust_level_history"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('user_id');

CREATE TRIGGER "trust_history_guard_deleted_actor"
BEFORE INSERT OR UPDATE OF "actor_id" ON "trust_level_history"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('actor_id');

CREATE TRIGGER "trust_batches_guard_deleted_requester"
BEFORE INSERT OR UPDATE OF "requested_by_id" ON "trust_recalculation_batches"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('requested_by_id');

CREATE TRIGGER "community_audit_guard_deleted_actor"
BEFORE INSERT OR UPDATE OF "actor_id" ON "community_audit_events"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('actor_id');

CREATE TRIGGER "post_likes_guard_deleted_user"
BEFORE INSERT OR UPDATE OF "user_id" ON "interaction_post_likes"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('user_id');

CREATE TRIGGER "topic_bookmarks_guard_deleted_user"
BEFORE INSERT OR UPDATE OF "user_id" ON "interaction_topic_bookmarks"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('user_id');

CREATE TRIGGER "user_follows_guard_deleted_follower"
BEFORE INSERT OR UPDATE OF "follower_id" ON "interaction_user_follows"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('follower_id');

CREATE TRIGGER "user_follows_guard_deleted_followed"
BEFORE INSERT OR UPDATE OF "followed_id" ON "interaction_user_follows"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('followed_id');

CREATE TRIGGER "topic_follows_guard_deleted_user"
BEFORE INSERT OR UPDATE OF "user_id" ON "interaction_topic_follows"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('user_id');

CREATE TRIGGER "topic_read_states_guard_deleted_user"
BEFORE INSERT OR UPDATE OF "user_id" ON "interaction_topic_read_states"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('user_id');

CREATE FUNCTION nextbuf_guard_deleted_user_identity_audit() RETURNS trigger AS $$
DECLARE
    owner_status TEXT;
    owner_finalized_at TIMESTAMPTZ;
BEGIN
    IF NEW."user_id" IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT "status", "deletion_finalized_at"
      INTO owner_status, owner_finalized_at
      FROM "users"
     WHERE "id" = NEW."user_id"
     FOR KEY SHARE;

    IF owner_status = 'deleted'
       AND NOT (
           owner_finalized_at IS NULL
           AND NEW."event_type" = 'identity.deletion.finalized'
       ) THEN
        RAISE EXCEPTION 'deleted user cannot own a new identity audit event'
            USING ERRCODE = 'check_violation',
                  CONSTRAINT = 'identity_audit_events_user_id_active_user_check';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "identity_audit_guard_deleted_user"
BEFORE INSERT OR UPDATE OF "user_id" ON "identity_audit_events"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_identity_audit();

CREATE TRIGGER "notifications_guard_deleted_recipient"
BEFORE INSERT OR UPDATE OF "recipient_id" ON "notifications"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('recipient_id');

CREATE TRIGGER "notifications_guard_deleted_actor"
BEFORE INSERT OR UPDATE OF "actor_id" ON "notifications"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('actor_id');

CREATE TRIGGER "notification_preferences_guard_deleted_user"
BEFORE INSERT OR UPDATE OF "user_id" ON "notification_preferences"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('user_id');

CREATE TRIGGER "site_settings_guard_deleted_updater"
BEFORE INSERT OR UPDATE OF "updated_by_id" ON "site_settings"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('updated_by_id');

CREATE TRIGGER "worker_failures_guard_deleted_replay_requester"
BEFORE INSERT OR UPDATE OF "replay_requested_by_id" ON "worker_job_failures"
FOR EACH ROW EXECUTE FUNCTION nextbuf_guard_deleted_user_reference('replay_requested_by_id');

ALTER TABLE "worker_job_failures"
    ADD COLUMN "email_delivery_id" UUID;

UPDATE "worker_job_failures" AS failure
SET "email_delivery_id" = delivery."id",
    "last_error" = 'Mail delivery failed',
    "updated_at" = CURRENT_TIMESTAMP
FROM "outbox_events" AS event
INNER JOIN "email_deliveries" AS delivery
    ON delivery."id"::text = event."payload"->>'deliveryId'
WHERE failure."outbox_event_id" = event."id"
  AND event."topic" IN (
      'nextbuf.identity.email.send',
      'nextbuf.mail.delivery.send'
  );

UPDATE "worker_job_failures" AS failure
SET "last_error" = 'Mail delivery failed',
    "updated_at" = CURRENT_TIMESTAMP
FROM "outbox_events" AS event
WHERE failure."outbox_event_id" = event."id"
  AND event."topic" IN (
      'nextbuf.identity.email.send',
      'nextbuf.mail.delivery.send'
  );

UPDATE "email_deliveries"
SET "last_error" = 'Mail delivery failed',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "last_error" IS NOT NULL;

UPDATE "outbox_events"
SET "last_error" = 'Mail dispatch failed',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "last_error" IS NOT NULL
  AND "topic" IN (
      'nextbuf.identity.email.send',
      'nextbuf.mail.delivery.send'
  );

CREATE INDEX "worker_job_failures_email_delivery_id_idx"
    ON "worker_job_failures"("email_delivery_id");

ALTER TABLE "worker_job_failures"
    ADD CONSTRAINT "worker_job_failures_email_delivery_id_fkey"
    FOREIGN KEY ("email_delivery_id") REFERENCES "email_deliveries"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
