import "server-only";

import { createHash, createHmac } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { Client, Query } from "pg";
import {
  ACCEPTANCE_SNAPSHOT_FORMAT,
  compareAcceptanceSnapshots,
  parseAcceptanceSnapshot,
  type AcceptanceFingerprint,
  type AcceptanceIntegrityCheck,
  type AcceptanceMigrationIdentity,
  type AcceptanceSnapshot,
  type AcceptanceStorageVerification,
} from "@/cli/acceptance-contract";
import { getMigrationDatabaseSchema, V1_0_0_MIGRATIONS } from "@/cli/commands/migration-policy";
import { readObject, type StorageDriver } from "@/infrastructure/storage/object-storage";
import { evaluateAdministratorContinuity } from "@/modules/admin/continuity-policy";
import { getAuthEnvironment, getDatabaseEnvironment } from "@/shared/config/runtime-env";
import { PROJECT } from "@/shared/project";

const MAX_SNAPSHOT_FILE_BYTES = 5 * 1024 * 1024;
const FINGERPRINT_PREFIX = "hmac-sha256:";

type StableTableSpec = {
  group: string;
  name: string;
  sql: string;
};

type MigrationRow = AcceptanceMigrationIdentity & {
  finishedAt: Date | null;
  rolledBackAt: Date | null;
};

type AttachmentObjectRow = {
  id: string;
  storageDriver: string;
  storageKey: string;
  processedKey: string | null;
  checksumSha256: string;
};

export type CaptureAcceptanceSnapshotOptions = {
  authSecret?: string;
  configuredVersion?: string;
  connectionString?: string;
  verifyObjects?: boolean;
};

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function wholeRowSpec(input: {
  group: string;
  name: string;
  table: string;
  alias?: string;
  exclusions?: string[];
  joins?: string;
  where?: string;
}): StableTableSpec {
  const alias = input.alias ?? "record";
  const exclusions = input.exclusions?.length
    ? ` - ARRAY[${input.exclusions.map(sqlString).join(", ")}]`
    : "";
  return {
    group: input.group,
    name: input.name,
    sql: `
      SELECT (to_jsonb(${alias})${exclusions})::text AS "canonical"
      FROM "${input.table}" AS ${alias}
      ${input.joins ?? ""}
      ${input.where ? `WHERE ${input.where}` : ""}
      ORDER BY "canonical" COLLATE "C" ASC
    `,
  };
}

const deletedVerificationOwnerSql = `
  CASE
    WHEN pg_input_is_valid(verification."value", 'uuid')
      THEN verification."value"::uuid
    WHEN pg_input_is_valid(verification."value", 'jsonb') THEN
      CASE
        WHEN pg_input_is_valid(
          verification."value"::jsonb #>> '{link,userId}',
          'uuid'
        ) THEN (verification."value"::jsonb #>> '{link,userId}')::uuid
        ELSE NULL
      END
    ELSE NULL
  END`;

function deletedMailDeliveryPredicate(deliveryAlias: string): string {
  return `(
    EXISTS (
      SELECT 1
      FROM "users" AS deleted_recipient
      WHERE deleted_recipient."status" = 'deleted'
        AND lower(deleted_recipient."email") = lower(${deliveryAlias}."recipient")
    )
    OR EXISTS (
      SELECT 1
      FROM "notification_deliveries" AS notification_delivery
      INNER JOIN "notifications" AS notification
        ON notification."id" = notification_delivery."notification_id"
      INNER JOIN "users" AS deleted_actor
        ON deleted_actor."id" = notification."actor_id"
       AND deleted_actor."status" = 'deleted'
      WHERE notification_delivery."email_delivery_id" = ${deliveryAlias}."id"
    )
  )`;
}

function deletedMailFailurePredicate(
  failureAlias: string,
  eventAlias: string,
  deliveryAlias: string,
  notificationAlias: string,
): string {
  return `COALESCE((
    ${failureAlias}."outbox_event_id" = ${eventAlias}."id"
    AND ${eventAlias}."topic" IN (
      'nextbuf.identity.email.send',
      'nextbuf.mail.delivery.send'
    )
    AND ${deliveryAlias}."id"::text = ${eventAlias}."payload"->>'deliveryId'
    AND EXISTS (
      SELECT 1
      FROM "users" AS deleted_member
      WHERE deleted_member."status" = 'deleted'
        AND (
          lower(${deliveryAlias}."recipient") = lower(deleted_member."email")
          OR ${notificationAlias}."actor_id" = deleted_member."id"
        )
    )
  ), FALSE)`;
}

const stableTableSpecs: StableTableSpec[] = [
  {
    group: "identity",
    name: "users_active",
    sql: `
      SELECT (
        to_jsonb(member) - ARRAY[
          'deletion_finalized_at',
          'deletion_attempt_count',
          'deletion_next_attempt_at',
          'deletion_last_error'
        ]
        || jsonb_build_object(
          'deletion_finalized_at',
          COALESCE(to_jsonb(member)->'deletion_finalized_at', 'null'::jsonb),
          'deletion_attempt_count',
          COALESCE(to_jsonb(member)->'deletion_attempt_count', '0'::jsonb),
          'deletion_next_attempt_at',
          COALESCE(to_jsonb(member)->'deletion_next_attempt_at', 'null'::jsonb),
          'deletion_last_error',
          COALESCE(to_jsonb(member)->'deletion_last_error', 'null'::jsonb)
        )
      )::text AS "canonical"
      FROM "users" AS member
      WHERE member."status" <> 'deleted'
      ORDER BY "canonical" COLLATE "C" ASC
    `,
  },
  {
    group: "identity",
    name: "users_deleted_anchors",
    sql: `
      SELECT (
        to_jsonb(member) - ARRAY[
          'updated_at',
          'deletion_requested_at',
          'deletion_scheduled_at',
          'deletion_finalized_at',
          'deletion_attempt_count',
          'deletion_next_attempt_at',
          'deletion_last_error'
        ]
      )::text AS "canonical"
      FROM "users" AS member
      WHERE member."status" = 'deleted'
      ORDER BY "canonical" COLLATE "C" ASC
    `,
  },
  wholeRowSpec({ group: "identity", name: "profiles", table: "profiles" }),
  wholeRowSpec({
    group: "identity",
    name: "username_aliases_active",
    table: "username_aliases",
    alias: "alias_record",
    joins: `INNER JOIN "users" AS member ON member."id" = alias_record."user_id"`,
    where: `member."status" <> 'deleted'`,
  }),
  wholeRowSpec({
    group: "authentication",
    name: "auth_accounts_active",
    table: "auth_accounts",
    alias: "account",
    joins: `INNER JOIN "users" AS member ON member."id" = account."user_id"`,
    where: `member."status" <> 'deleted'`,
  }),
  wholeRowSpec({
    group: "authentication",
    name: "auth_sessions_active",
    table: "auth_sessions",
    alias: "session_record",
    joins: `INNER JOIN "users" AS member ON member."id" = session_record."user_id"`,
    where: `member."status" <> 'deleted'`,
  }),
  {
    group: "authentication",
    name: "auth_verifications_non_deleted",
    sql: `
      WITH verification_rows AS (
        SELECT verification.*, ${deletedVerificationOwnerSql} AS "owner_id"
        FROM "auth_verifications" AS verification
      )
      SELECT (to_jsonb(verification_row) - 'owner_id')::text AS "canonical"
      FROM verification_rows AS verification_row
      WHERE NOT EXISTS (
        SELECT 1
        FROM "users" AS member
        WHERE member."id" = verification_row."owner_id"
          AND member."status" = 'deleted'
      )
      ORDER BY "canonical" COLLATE "C" ASC
    `,
  },
  wholeRowSpec({
    group: "authentication",
    name: "registration_invites",
    table: "registration_invites",
  }),
  wholeRowSpec({
    group: "authentication",
    name: "admin_reauthentications_active",
    table: "admin_reauthentications",
    alias: "reauth",
    joins: `
      INNER JOIN "auth_sessions" AS session_record ON session_record."id" = reauth."session_id"
      INNER JOIN "users" AS member ON member."id" = session_record."user_id"`,
    where: `member."status" <> 'deleted'`,
  }),
  wholeRowSpec({ group: "community", name: "community_nodes", table: "community_nodes" }),
  wholeRowSpec({ group: "community", name: "community_topics", table: "community_topics" }),
  wholeRowSpec({ group: "community", name: "community_posts", table: "community_posts" }),
  wholeRowSpec({
    group: "community",
    name: "community_post_revisions",
    table: "community_post_revisions",
  }),
  wholeRowSpec({
    group: "community",
    name: "community_post_drafts",
    table: "community_post_drafts",
  }),
  wholeRowSpec({
    group: "community",
    name: "community_reply_editor_sessions",
    table: "community_reply_editor_sessions",
  }),
  wholeRowSpec({
    group: "community",
    name: "community_post_mentions",
    table: "community_post_mentions",
  }),
  wholeRowSpec({
    group: "community",
    name: "community_attachments",
    table: "community_attachments",
  }),
  wholeRowSpec({
    group: "community",
    name: "community_post_attachments",
    table: "community_post_attachments",
  }),
  wholeRowSpec({
    group: "community",
    name: "community_revision_attachments",
    table: "community_revision_attachments",
  }),
  wholeRowSpec({
    group: "community",
    name: "community_post_draft_attachments",
    table: "community_post_draft_attachments",
  }),
  wholeRowSpec({
    group: "community",
    name: "community_audit_events",
    table: "community_audit_events",
  }),
  wholeRowSpec({
    group: "interactions",
    name: "interaction_post_likes",
    table: "interaction_post_likes",
  }),
  wholeRowSpec({
    group: "interactions",
    name: "interaction_topic_bookmarks",
    table: "interaction_topic_bookmarks",
  }),
  wholeRowSpec({
    group: "interactions",
    name: "interaction_user_follows",
    table: "interaction_user_follows",
  }),
  wholeRowSpec({
    group: "interactions",
    name: "interaction_topic_follows",
    table: "interaction_topic_follows",
  }),
  wholeRowSpec({
    group: "interactions",
    name: "interaction_topic_read_states",
    table: "interaction_topic_read_states",
  }),
  wholeRowSpec({
    group: "interactions",
    name: "interaction_topic_views",
    table: "interaction_topic_views",
  }),
  wholeRowSpec({
    group: "governance",
    name: "community_role_assignments",
    table: "community_role_assignments",
  }),
  wholeRowSpec({ group: "governance", name: "moderation_cases", table: "moderation_cases" }),
  wholeRowSpec({
    group: "governance",
    name: "moderation_reports",
    table: "moderation_reports",
  }),
  wholeRowSpec({
    group: "governance",
    name: "moderation_actions",
    table: "moderation_actions",
  }),
  wholeRowSpec({
    group: "governance",
    name: "moderation_sanctions",
    table: "moderation_sanctions",
  }),
  wholeRowSpec({
    group: "governance",
    name: "governance_audit_events",
    table: "governance_audit_events",
  }),
  wholeRowSpec({
    group: "governance",
    name: "trust_rule_versions",
    table: "trust_rule_versions",
  }),
  wholeRowSpec({
    group: "governance",
    name: "trust_user_states",
    table: "trust_user_states",
  }),
  wholeRowSpec({
    group: "governance",
    name: "trust_level_history",
    table: "trust_level_history",
  }),
  wholeRowSpec({
    group: "governance",
    name: "trust_recalculation_batches",
    table: "trust_recalculation_batches",
  }),
  wholeRowSpec({
    group: "messaging",
    name: "notifications",
    table: "notifications",
  }),
  wholeRowSpec({
    group: "messaging",
    name: "notification_preferences",
    table: "notification_preferences",
  }),
  {
    group: "messaging",
    name: "notification_deliveries_structure",
    sql: `
      WITH candidate_state AS (
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'email_deliveries'
            AND column_name = 'attempt_token'
        ) AS "present"
      ), migration_window AS (
        SELECT
          MIN("started_at") AS "started_at",
          MAX("finished_at") AS "finished_at"
        FROM "_prisma_migrations"
        WHERE "migration_name" = '20260731180000_email_delivery_attempt_fencing'
          AND "finished_at" IS NOT NULL
          AND "rolled_back_at" IS NULL
      )
      SELECT (
        to_jsonb(delivery_link) - ARRAY['status', 'email_delivery_id', 'updated_at']
        || jsonb_build_object(
          'status',
          CASE
            WHEN candidate_state."present" THEN delivery_link."status"
            WHEN mail_delivery."id" IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM "users" AS deleted_member
                WHERE deleted_member."status" = 'deleted'
                  AND (
                    lower(mail_delivery."recipient") = lower(deleted_member."email")
                    OR notification."actor_id" = deleted_member."id"
                  )
              ) THEN delivery_link."status"
            WHEN mail_delivery."status" = 'sending'
              AND delivery_link."status" <> 'delivered' THEN 'failed'
            ELSE delivery_link."status"
          END,
          'email_delivery_id',
          CASE
            WHEN candidate_state."present" THEN to_jsonb(delivery_link)->'email_delivery_id'
            WHEN mail_delivery."id" IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM "users" AS deleted_member
                WHERE deleted_member."status" = 'deleted'
                  AND (
                    lower(mail_delivery."recipient") = lower(deleted_member."email")
                    OR notification."actor_id" = deleted_member."id"
                  )
              ) THEN 'null'::jsonb
            ELSE to_jsonb(delivery_link)->'email_delivery_id'
          END,
          'updated_at',
          CASE
            WHEN NOT candidate_state."present"
              AND mail_delivery."status" = 'sending'
              AND delivery_link."status" <> 'delivered'
              THEN to_jsonb('migration-normalized'::text)
            WHEN candidate_state."present"
              AND mail_delivery."status" = 'outcome_unknown'
              AND delivery_link."status" = 'failed'
              AND delivery_link."updated_at" BETWEEN
                migration_window."started_at" AND migration_window."finished_at"
              THEN to_jsonb('migration-normalized'::text)
            ELSE to_jsonb(delivery_link)->'updated_at'
          END
        )
      )::text AS "canonical"
      FROM "notification_deliveries" AS delivery_link
      INNER JOIN "notifications" AS notification
        ON notification."id" = delivery_link."notification_id"
      LEFT JOIN "email_deliveries" AS mail_delivery
        ON mail_delivery."id" = delivery_link."email_delivery_id"
      CROSS JOIN candidate_state
      CROSS JOIN migration_window
      ORDER BY "canonical" COLLATE "C" ASC
    `,
  },
  wholeRowSpec({
    group: "operations_preserved",
    name: "site_settings",
    table: "site_settings",
  }),
  wholeRowSpec({
    group: "operations_preserved",
    name: "identity_audit_events",
    table: "identity_audit_events",
  }),
  wholeRowSpec({
    group: "operations_preserved",
    name: "system_state_static",
    table: "system_state",
    alias: "state_record",
    where: `state_record."key" NOT IN ('runtime.initialized', 'installation.claim')`,
  }),
  {
    group: "operations_preserved",
    name: "email_deliveries_preserved",
    sql: `
      WITH migration_window AS (
        SELECT
          MIN("started_at") FILTER (
            WHERE "migration_name" = '20260730120000_account_deletion_finalization'
          ) AS "account_started_at",
          MAX("finished_at") FILTER (
            WHERE "migration_name" = '20260730120000_account_deletion_finalization'
          ) AS "account_finished_at",
          MIN("started_at") FILTER (
            WHERE "migration_name" = '20260731180000_email_delivery_attempt_fencing'
          ) AS "fencing_started_at",
          MAX("finished_at") FILTER (
            WHERE "migration_name" = '20260731180000_email_delivery_attempt_fencing'
          ) AS "fencing_finished_at"
        FROM "_prisma_migrations"
        WHERE "finished_at" IS NOT NULL
          AND "rolled_back_at" IS NULL
      )
      SELECT (
        to_jsonb(delivery) - ARRAY[
          'status',
          'last_error',
          'updated_at',
          'attempt_token',
          'attempt_generation'
        ]
        || jsonb_build_object(
          'status',
          CASE
            WHEN to_jsonb(delivery) ? 'attempt_token' THEN delivery."status"
            WHEN delivery."status" = 'sending' THEN 'outcome_unknown'
            ELSE delivery."status"
          END,
          'last_error',
          CASE
            WHEN to_jsonb(delivery) ? 'attempt_token' THEN delivery."last_error"
            WHEN delivery."status" = 'sending'
              THEN 'Mail delivery failed (EOUTCOMEUNKNOWN)'
            WHEN delivery."last_error" IS NOT NULL THEN 'Mail delivery failed'
            ELSE NULL
          END,
          'attempt_generation',
          CASE
            WHEN to_jsonb(delivery) ? 'attempt_generation'
              THEN to_jsonb(delivery)->'attempt_generation'
            ELSE to_jsonb(delivery."attempts")
          END,
          'updated_at',
          CASE
            WHEN NOT (to_jsonb(delivery) ? 'attempt_token')
              AND (delivery."status" = 'sending' OR delivery."last_error" IS NOT NULL)
              THEN to_jsonb('migration-normalized'::text)
            WHEN to_jsonb(delivery) ? 'attempt_token'
              AND delivery."status" = 'outcome_unknown'
              AND delivery."updated_at" BETWEEN
                migration_window."fencing_started_at" AND migration_window."fencing_finished_at"
              THEN to_jsonb('migration-normalized'::text)
            WHEN to_jsonb(delivery) ? 'attempt_token'
              AND delivery."last_error" = 'Mail delivery failed'
              AND delivery."updated_at" BETWEEN
                migration_window."account_started_at" AND migration_window."account_finished_at"
              THEN to_jsonb('migration-normalized'::text)
            ELSE to_jsonb(delivery)->'updated_at'
          END
        )
      )::text AS "canonical"
      FROM "email_deliveries" AS delivery
      CROSS JOIN migration_window
      WHERE NOT ${deletedMailDeliveryPredicate("delivery")}
      ORDER BY "canonical" COLLATE "C" ASC
    `,
  },
  {
    group: "operations_preserved",
    name: "outbox_events_structure",
    sql: `
      WITH candidate_state AS (
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'outbox_events'
            AND column_name = 'processed_at'
        ) AS "present"
      ), migration_window AS (
        SELECT
          MIN("started_at") AS "started_at",
          MAX("finished_at") AS "finished_at"
        FROM "_prisma_migrations"
        WHERE "migration_name" = '20260730120000_account_deletion_finalization'
          AND "finished_at" IS NOT NULL
          AND "rolled_back_at" IS NULL
      )
      SELECT (
        to_jsonb(event_record) - ARRAY['processed_at', 'last_error', 'updated_at']
        || jsonb_build_object(
          'processed_at',
          CASE
            WHEN to_jsonb(event_record) ? 'processed_at'
              THEN to_jsonb(event_record)->'processed_at'
            ELSE to_jsonb(processed."completed_at")
          END,
          'last_error',
          CASE
            WHEN to_jsonb(event_record) ? 'processed_at'
              THEN to_jsonb(event_record)->'last_error'
            WHEN event_record."topic" IN (
              'nextbuf.identity.email.send',
              'nextbuf.mail.delivery.send'
            )
              AND EXISTS (
                SELECT 1
                FROM "email_deliveries" AS delivery
                WHERE delivery."id"::text = event_record."payload"->>'deliveryId'
                  AND ${deletedMailDeliveryPredicate("delivery")}
              ) THEN 'null'::jsonb
            WHEN event_record."topic" IN (
              'nextbuf.identity.email.send',
              'nextbuf.mail.delivery.send'
            ) AND event_record."last_error" IS NOT NULL
              THEN to_jsonb('Mail dispatch failed'::text)
            ELSE to_jsonb(event_record."last_error")
          END,
          'updated_at',
          CASE
            WHEN NOT candidate_state."present"
              AND event_record."topic" IN (
                'nextbuf.identity.email.send',
                'nextbuf.mail.delivery.send'
              )
              AND (
                event_record."last_error" IS NOT NULL
                OR EXISTS (
                  SELECT 1
                  FROM "email_deliveries" AS delivery
                  WHERE delivery."id"::text = event_record."payload"->>'deliveryId'
                    AND ${deletedMailDeliveryPredicate("delivery")}
                )
              ) THEN to_jsonb('migration-normalized'::text)
            WHEN candidate_state."present"
              AND event_record."topic" IN (
              'nextbuf.identity.email.send',
              'nextbuf.mail.delivery.send'
              )
              AND event_record."updated_at" BETWEEN
                migration_window."started_at" AND migration_window."finished_at"
              AND (
                event_record."last_error" = 'Mail dispatch failed'
                OR (
                  event_record."last_error" IS NULL
                  AND NOT EXISTS (
                    SELECT 1
                    FROM "email_deliveries" AS delivery
                    WHERE delivery."id"::text = event_record."payload"->>'deliveryId'
                  )
                )
              ) THEN to_jsonb('migration-normalized'::text)
            ELSE to_jsonb(event_record)->'updated_at'
          END
        )
      )::text AS "canonical"
      FROM "outbox_events" AS event_record
      LEFT JOIN "processed_jobs" AS processed
        ON processed."queue_name" = 'system'
       AND processed."idempotency_key" = 'outbox-' || event_record."id"::text
      CROSS JOIN candidate_state
      CROSS JOIN migration_window
      ORDER BY "canonical" COLLATE "C" ASC
    `,
  },
  wholeRowSpec({
    group: "operations_preserved",
    name: "processed_jobs",
    table: "processed_jobs",
  }),
  {
    group: "operations_preserved",
    name: "worker_job_failures_structure",
    sql: `
      WITH migration_window AS (
        SELECT
          MIN("started_at") AS "started_at",
          MAX("finished_at") AS "finished_at"
        FROM "_prisma_migrations"
        WHERE "migration_name" = '20260730120000_account_deletion_finalization'
          AND "finished_at" IS NOT NULL
          AND "rolled_back_at" IS NULL
      )
      SELECT (
        to_jsonb(failure) - ARRAY[
          'last_error',
          'updated_at',
          'email_delivery_id',
          'replay_duplicate_risk_acknowledged_at'
        ]
        || jsonb_build_object(
          'last_error',
          CASE
            WHEN to_jsonb(failure) ? 'email_delivery_id' THEN failure."last_error"
            WHEN event_record."topic" IN (
              'nextbuf.identity.email.send',
              'nextbuf.mail.delivery.send'
            ) THEN 'Mail delivery failed'
            ELSE failure."last_error"
          END,
          'email_delivery_id',
          CASE
            WHEN to_jsonb(failure) ? 'email_delivery_id'
              THEN to_jsonb(failure)->'email_delivery_id'
            WHEN event_record."topic" IN (
              'nextbuf.identity.email.send',
              'nextbuf.mail.delivery.send'
            ) THEN to_jsonb(delivery."id")
            ELSE 'null'::jsonb
          END,
          'replay_duplicate_risk_acknowledged_at',
          CASE
            WHEN to_jsonb(failure) ? 'replay_duplicate_risk_acknowledged_at'
              THEN to_jsonb(failure)->'replay_duplicate_risk_acknowledged_at'
            ELSE 'null'::jsonb
          END,
          'updated_at',
          CASE
            WHEN event_record."topic" IN (
              'nextbuf.identity.email.send',
              'nextbuf.mail.delivery.send'
            )
              AND (
                NOT (to_jsonb(failure) ? 'email_delivery_id')
                OR (
                  failure."last_error" = 'Mail delivery failed'
                  AND failure."updated_at" BETWEEN
                    migration_window."started_at" AND migration_window."finished_at"
                )
              ) THEN to_jsonb('migration-normalized'::text)
            ELSE to_jsonb(failure)->'updated_at'
          END
        )
      )::text AS "canonical"
      FROM "worker_job_failures" AS failure
      LEFT JOIN "outbox_events" AS event_record
        ON event_record."id" = failure."outbox_event_id"
      LEFT JOIN "email_deliveries" AS delivery
        ON delivery."id"::text = event_record."payload"->>'deliveryId'
      LEFT JOIN "notification_deliveries" AS notification_delivery
        ON notification_delivery."email_delivery_id" = delivery."id"
      LEFT JOIN "notifications" AS notification
        ON notification."id" = notification_delivery."notification_id"
      CROSS JOIN migration_window
      WHERE NOT ${deletedMailFailurePredicate(
        "failure",
        "event_record",
        "delivery",
        "notification",
      )}
      ORDER BY "canonical" COLLATE "C" ASC
    `,
  },
  wholeRowSpec({
    group: "operations_preserved",
    name: "worker_scheduled_tasks",
    table: "worker_scheduled_tasks",
  }),
];

function deriveFingerprintKey(authSecret: string): Buffer {
  return createHmac("sha256", authSecret).update("nextbuf/acceptance-snapshot/v1/root\0").digest();
}

function hmacDigest(key: Buffer, domain: string, value: string | Buffer): string {
  return `${FINGERPRINT_PREFIX}${createHmac("sha256", key)
    .update(domain)
    .update("\0")
    .update(value)
    .digest("hex")}`;
}

function updateLengthPrefixed(hash: ReturnType<typeof createHmac>, value: string | Buffer): void {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(bytes.byteLength));
  hash.update(length);
  hash.update(bytes);
}

async function fingerprintTable(
  client: Client,
  key: Buffer,
  spec: StableTableSpec,
): Promise<AcceptanceFingerprint> {
  const hash = createHmac("sha256", key);
  updateLengthPrefixed(hash, "nextbuf/acceptance-snapshot/v1/table");
  updateLengthPrefixed(hash, spec.name);
  let rows = 0;
  let rowError: Error | undefined;
  const query = new Query<{ canonical: string }>({ text: spec.sql });

  await new Promise<void>((resolve, reject) => {
    query.on("row", (row) => {
      if (rowError) return;
      if (typeof row.canonical !== "string") {
        rowError = new Error(`Acceptance query ${spec.name} returned a non-text row`);
        return;
      }
      rows += 1;
      updateLengthPrefixed(hash, row.canonical);
    });
    query.on("error", reject);
    query.on("end", () => (rowError ? reject(rowError) : resolve()));
    client.query(query);
  });

  return { rows, digest: `${FINGERPRINT_PREFIX}${hash.digest("hex")}` };
}

function combineFingerprints(
  key: Buffer,
  domain: string,
  fingerprints: Array<[string, AcceptanceFingerprint]>,
): AcceptanceFingerprint {
  const hash = createHmac("sha256", key);
  updateLengthPrefixed(hash, domain);
  let rows = 0;
  for (const [name, fingerprint] of fingerprints.sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    rows += fingerprint.rows;
    updateLengthPrefixed(hash, name);
    updateLengthPrefixed(hash, String(fingerprint.rows));
    updateLengthPrefixed(hash, fingerprint.digest);
  }
  return { rows, digest: `${FINGERPRINT_PREFIX}${hash.digest("hex")}` };
}

async function getCapabilities(client: Client): Promise<Record<string, boolean>> {
  const result = await client.query<Record<string, boolean>>(`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'users'
          AND column_name = 'deletion_finalized_at'
      ) AS "accountDeletionFinalization",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'outbox_events'
          AND column_name = 'processed_at'
      ) AS "outboxProcessedStatus",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'email_deliveries'
          AND column_name = 'attempt_token'
      ) AS "emailAttemptFencing"
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Acceptance capability query returned no row");
  return row;
}

async function getMigrationState(client: Client): Promise<{
  applied: AcceptanceMigrationIdentity[];
  failed: string[];
}> {
  const result = await client.query<MigrationRow>(`
    SELECT
      "migration_name" AS "migrationName",
      "checksum",
      "finished_at" AS "finishedAt",
      "rolled_back_at" AS "rolledBackAt"
    FROM "_prisma_migrations"
    ORDER BY "started_at" ASC, "migration_name" ASC
  `);
  return {
    applied: result.rows
      .filter((migration) => migration.finishedAt && !migration.rolledBackAt)
      .map(({ migrationName, checksum }) => ({ migrationName, checksum })),
    failed: result.rows
      .filter((migration) => !migration.finishedAt && !migration.rolledBackAt)
      .map((migration) => migration.migrationName),
  };
}

const commonIntegrityQueries: Array<{ name: string; sql: string }> = [
  {
    name: "topic_exactly_one_first_post",
    sql: `
      SELECT COUNT(*)::integer AS "violations"
      FROM "community_topics" AS topic
      WHERE (
        SELECT COUNT(*) FROM "community_posts" AS post
        WHERE post."topic_id" = topic."id" AND post."position" = 1
      ) <> 1`,
  },
  {
    name: "topic_next_post_position",
    sql: `
      SELECT COUNT(*)::integer AS "violations"
      FROM "community_topics" AS topic
      WHERE topic."next_post_position" <= COALESCE((
        SELECT MAX(post."position")
        FROM "community_posts" AS post
        WHERE post."topic_id" = topic."id"
      ), 0)`,
  },
  {
    name: "topic_reply_count",
    sql: `
      SELECT COUNT(*)::integer AS "violations"
      FROM "community_topics" AS topic
      WHERE topic."reply_count" <> (
        SELECT COUNT(*)::integer
        FROM "community_posts" AS post
        WHERE post."topic_id" = topic."id"
          AND post."position" > 1
          AND post."status" = 'published'
      )`,
  },
  {
    name: "post_revision_count_and_sequence",
    sql: `
      SELECT COUNT(*)::integer AS "violations"
      FROM "community_posts" AS post
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::integer AS "revision_count",
          COUNT(DISTINCT revision."version")::integer AS "distinct_versions",
          MIN(revision."version")::integer AS "minimum_version",
          MAX(revision."version")::integer AS "maximum_version"
        FROM "community_post_revisions" AS revision
        WHERE revision."post_id" = post."id"
      ) AS revisions ON TRUE
      WHERE revisions."revision_count" < 1
        OR post."revision_count" <> revisions."revision_count"
        OR revisions."minimum_version" <> 1
        OR revisions."maximum_version" <> revisions."revision_count"
        OR revisions."distinct_versions" <> revisions."revision_count"`,
  },
  {
    name: "post_like_count",
    sql: `
      SELECT COUNT(*)::integer AS "violations"
      FROM "community_posts" AS post
      WHERE post."like_count" <> (
        SELECT COUNT(*)::integer
        FROM "interaction_post_likes" AS interaction
        WHERE interaction."post_id" = post."id"
      )`,
  },
  {
    name: "topic_bookmark_count",
    sql: `
      SELECT COUNT(*)::integer AS "violations"
      FROM "community_topics" AS topic
      WHERE topic."bookmark_count" <> (
        SELECT COUNT(*)::integer
        FROM "interaction_topic_bookmarks" AS interaction
        WHERE interaction."topic_id" = topic."id"
      )`,
  },
  {
    name: "account_deletion_request_pair",
    sql: `
      SELECT COUNT(*)::integer AS "violations"
      FROM "users"
      WHERE ("deletion_requested_at" IS NULL) <> ("deletion_scheduled_at" IS NULL)`,
  },
  {
    name: "valid_ready_indexes",
    sql: `
      SELECT COUNT(*)::integer AS "violations"
      FROM pg_index AS index_state
      INNER JOIN pg_class AS indexed_object ON indexed_object.oid = index_state.indrelid
      INNER JOIN pg_namespace AS namespace ON namespace.oid = indexed_object.relnamespace
      WHERE namespace.nspname = current_schema()
        AND (NOT index_state.indisvalid OR NOT index_state.indisready)`,
  },
  {
    name: "validated_constraints",
    sql: `
      SELECT COUNT(*)::integer AS "violations"
      FROM pg_constraint AS constraint_state
      INNER JOIN pg_namespace AS namespace ON namespace.oid = constraint_state.connamespace
      WHERE namespace.nspname = current_schema()
        AND NOT constraint_state.convalidated`,
  },
];

const candidateIntegrityQueries: Array<{
  capability: string;
  name: string;
  sql: string;
}> = [
  {
    capability: "accountDeletionFinalization",
    name: "deleted_user_auth_quarantine",
    sql: `
      SELECT COUNT(*)::integer AS "violations"
      FROM "users" AS member
      WHERE member."status" = 'deleted'
        AND (
          member."deletion_finalized_at" IS NULL
          AND (
            member."deletion_requested_at" IS NULL
            OR member."deletion_scheduled_at" IS NULL
          )
          OR EXISTS (SELECT 1 FROM "auth_accounts" WHERE "user_id" = member."id")
          OR EXISTS (SELECT 1 FROM "auth_sessions" WHERE "user_id" = member."id")
          OR EXISTS (
            SELECT 1 FROM "auth_verifications"
            WHERE nextbuf_auth_verification_owner_id("value") = member."id"
          )
        )`,
  },
  {
    capability: "outboxProcessedStatus",
    name: "outbox_processed_linkage",
    sql: `
      SELECT COUNT(*)::integer AS "violations"
      FROM "outbox_events" AS event_record
      LEFT JOIN "processed_jobs" AS processed
       ON processed."queue_name" = 'system'
       AND processed."idempotency_key" = 'outbox-' || event_record."id"::text
      WHERE (event_record."processed_at" IS NULL) <> (processed."id" IS NULL)`,
  },
  {
    capability: "emailAttemptFencing",
    name: "email_attempt_fencing_state",
    sql: `
      SELECT COUNT(*)::integer AS "violations"
      FROM "email_deliveries"
      WHERE "attempt_token" IS NULL
        OR "attempt_generation" < "attempts"
        OR "status" = 'sending'`,
  },
  {
    capability: "emailAttemptFencing",
    name: "worker_mail_failure_linkage",
    sql: `
      SELECT COUNT(*)::integer AS "violations"
      FROM "worker_job_failures" AS failure
      INNER JOIN "outbox_events" AS event_record
        ON event_record."id" = failure."outbox_event_id"
       AND event_record."topic" IN (
         'nextbuf.identity.email.send',
         'nextbuf.mail.delivery.send'
       )
      INNER JOIN "email_deliveries" AS delivery
        ON delivery."id"::text = event_record."payload"->>'deliveryId'
      WHERE failure."email_delivery_id" IS DISTINCT FROM delivery."id"`,
  },
];

async function getViolationCount(client: Client, sql: string): Promise<number> {
  const result = await client.query<{ violations: number }>(sql);
  const violations = result.rows[0]?.violations;
  if (typeof violations !== "number" || !Number.isSafeInteger(violations) || violations < 0) {
    throw new Error("Acceptance integrity query returned an invalid count");
  }
  return violations;
}

async function getIntegrityChecks(
  client: Client,
  capabilities: Record<string, boolean>,
): Promise<Record<string, AcceptanceIntegrityCheck>> {
  const checks: Record<string, AcceptanceIntegrityCheck> = {};
  for (const query of commonIntegrityQueries) {
    const violations = await getViolationCount(client, query.sql);
    checks[query.name] = { applicable: true, ok: violations === 0, violations };
  }
  for (const query of candidateIntegrityQueries) {
    const applicable = capabilities[query.capability] === true;
    const violations = applicable ? await getViolationCount(client, query.sql) : 0;
    checks[query.name] = { applicable, ok: !applicable || violations === 0, violations };
  }
  return checks;
}

async function getAdministratorCount(client: Client): Promise<number> {
  const result = await client.query<{ count: number }>(`
    SELECT COUNT(DISTINCT member."id")::integer AS "count"
    FROM "users" AS member
    WHERE member."status" = 'active'
      AND member."email_verified" = TRUE
      AND member."deletion_requested_at" IS NULL
      AND member."deletion_scheduled_at" IS NULL
      AND EXISTS (
        SELECT 1 FROM "auth_accounts" AS account
        WHERE account."user_id" = member."id"
          AND account."provider_id" = 'credential'
          AND account."password" IS NOT NULL
          AND account."password" <> ''
      )
      AND EXISTS (
        SELECT 1 FROM "community_role_assignments" AS role_assignment
        WHERE role_assignment."user_id" = member."id"
          AND role_assignment."role" = 'admin'
          AND role_assignment."scope_key" = 'site'
      )
      AND NOT EXISTS (
        SELECT 1 FROM "moderation_sanctions" AS sanction
        WHERE sanction."user_id" = member."id"
          AND sanction."type" IN ('suspend', 'ban')
          AND sanction."revoked_at" IS NULL
          AND sanction."starts_at" <= CURRENT_TIMESTAMP
          AND (sanction."ends_at" IS NULL OR sanction."ends_at" > CURRENT_TIMESTAMP)
      )
  `);
  const count = result.rows[0]?.count;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new Error("Administrator continuity query returned an invalid count");
  }
  return count;
}

const operationQueries: Array<{ name: string; sql: string }> = [
  { name: "users.total", sql: `SELECT COUNT(*)::integer AS "count" FROM "users"` },
  {
    name: "users.active",
    sql: `SELECT COUNT(*)::integer AS "count" FROM "users" WHERE "status" = 'active'`,
  },
  {
    name: "users.pending",
    sql: `SELECT COUNT(*)::integer AS "count" FROM "users" WHERE "status" = 'pending'`,
  },
  {
    name: "users.deleted",
    sql: `SELECT COUNT(*)::integer AS "count" FROM "users" WHERE "status" = 'deleted'`,
  },
  {
    name: "auth.credentials",
    sql: `SELECT COUNT(*)::integer AS "count" FROM "auth_accounts" WHERE "provider_id" = 'credential' AND "password" IS NOT NULL`,
  },
  { name: "auth.sessions", sql: `SELECT COUNT(*)::integer AS "count" FROM "auth_sessions"` },
  {
    name: "community.topics",
    sql: `SELECT COUNT(*)::integer AS "count" FROM "community_topics"`,
  },
  {
    name: "community.posts",
    sql: `SELECT COUNT(*)::integer AS "count" FROM "community_posts"`,
  },
  {
    name: "community.attachments",
    sql: `SELECT COUNT(*)::integer AS "count" FROM "community_attachments"`,
  },
  {
    name: "outbox.unpublished",
    sql: `SELECT COUNT(*)::integer AS "count" FROM "outbox_events" WHERE "published_at" IS NULL`,
  },
  {
    name: "worker.failures_unresolved",
    sql: `SELECT COUNT(*)::integer AS "count" FROM "worker_job_failures" WHERE "resolved_at" IS NULL`,
  },
  {
    name: "mail.pending_or_sending",
    sql: `SELECT COUNT(*)::integer AS "count" FROM "email_deliveries" WHERE "status" IN ('pending', 'sending')`,
  },
  {
    name: "mail.failed_or_unknown",
    sql: `SELECT COUNT(*)::integer AS "count" FROM "email_deliveries" WHERE "status" IN ('failed', 'outcome_unknown')`,
  },
  {
    name: "worker.scheduled_tasks",
    sql: `SELECT COUNT(*)::integer AS "count" FROM "worker_scheduled_tasks"`,
  },
  {
    name: "worker.heartbeats",
    sql: `SELECT COUNT(*)::integer AS "count" FROM "worker_heartbeats"`,
  },
];

async function getOperationCounts(client: Client): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const query of operationQueries) {
    const result = await client.query<{ count: number }>(query.sql);
    const count = result.rows[0]?.count;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Acceptance operation query ${query.name} returned an invalid count`);
    }
    counts[query.name] = count;
  }
  return counts;
}

async function verifyAttachmentObjects(
  rows: AttachmentObjectRow[],
  key: Buffer,
): Promise<AcceptanceStorageVerification> {
  const hash = createHmac("sha256", key);
  updateLengthPrefixed(hash, "nextbuf/acceptance-snapshot/v1/storage");
  let originals = 0;
  let processedObjects = 0;
  let missingOriginals = 0;
  let checksumMismatches = 0;
  let missingProcessedObjects = 0;

  for (const row of rows.sort((left, right) => left.id.localeCompare(right.id))) {
    if (row.storageDriver !== "local" && row.storageDriver !== "s3") {
      throw new Error("Attachment has an unsupported storage driver");
    }
    const driver = row.storageDriver as StorageDriver;
    originals += 1;
    const original = await readObject(driver, row.storageKey);
    updateLengthPrefixed(hash, row.id);
    updateLengthPrefixed(hash, row.storageDriver);
    updateLengthPrefixed(hash, row.storageKey);
    if (!original) {
      missingOriginals += 1;
      updateLengthPrefixed(hash, "missing-original");
    } else {
      const checksum = createHash("sha256").update(original).digest("hex");
      if (checksum !== row.checksumSha256.toLowerCase()) checksumMismatches += 1;
      updateLengthPrefixed(hash, checksum);
    }

    if (row.processedKey) {
      processedObjects += 1;
      updateLengthPrefixed(hash, row.processedKey);
      const processed = await readObject(driver, row.processedKey);
      if (!processed) {
        missingProcessedObjects += 1;
        updateLengthPrefixed(hash, "missing-processed");
      } else {
        updateLengthPrefixed(hash, createHash("sha256").update(processed).digest());
      }
    }
  }

  const ok = missingOriginals === 0 && checksumMismatches === 0 && missingProcessedObjects === 0;
  return {
    requested: true,
    ok,
    originals,
    processedObjects,
    missingOriginals,
    checksumMismatches,
    missingProcessedObjects,
    fingerprint: `${FINGERPRINT_PREFIX}${hash.digest("hex")}`,
  };
}

function skippedStorageVerification(): AcceptanceStorageVerification {
  return {
    requested: false,
    ok: null,
    originals: 0,
    processedObjects: 0,
    missingOriginals: 0,
    checksumMismatches: 0,
    missingProcessedObjects: 0,
    fingerprint: null,
  };
}

export async function captureAcceptanceSnapshot(
  options: CaptureAcceptanceSnapshotOptions = {},
): Promise<AcceptanceSnapshot> {
  const authEnvironment = getAuthEnvironment();
  const databaseEnvironment = getDatabaseEnvironment();
  const connectionString = options.connectionString ?? databaseEnvironment.DATABASE_URL;
  const schema = getMigrationDatabaseSchema(connectionString);
  const key = deriveFingerprintKey(options.authSecret ?? authEnvironment.AUTH_SECRET);
  const client = new Client({
    connectionString,
    statement_timeout: Math.max(databaseEnvironment.DATABASE_STATEMENT_TIMEOUT_MS, 120_000),
  });
  const tables: Record<string, AcceptanceFingerprint> = {};
  const attachments: AttachmentObjectRow[] = [];
  let capabilities: Record<string, boolean> = {};
  let migrationState: Awaited<ReturnType<typeof getMigrationState>> = { applied: [], failed: [] };
  let integrity: Record<string, AcceptanceIntegrityCheck> = {};
  let eligibleAdministrators = 0;
  let operations: Record<string, number> = {};
  let transactionReadOnly = false;

  await client.connect();
  try {
    await client.query("SELECT set_config('search_path', quote_ident($1), false)", [schema]);
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const transactionState = await client.query<{ transactionReadOnly: string }>(
      `SELECT current_setting('transaction_read_only') AS "transactionReadOnly"`,
    );
    transactionReadOnly = transactionState.rows[0]?.transactionReadOnly === "on";
    if (!transactionReadOnly) throw new Error("Acceptance snapshot transaction is not read-only");

    capabilities = await getCapabilities(client);
    migrationState = await getMigrationState(client);
    for (const spec of stableTableSpecs) {
      tables[spec.name] = await fingerprintTable(client, key, spec);
    }
    integrity = await getIntegrityChecks(client, capabilities);
    eligibleAdministrators = await getAdministratorCount(client);
    operations = await getOperationCounts(client);
    if (options.verifyObjects) {
      const result = await client.query<AttachmentObjectRow>(`
        SELECT
          "id"::text AS "id",
          "storage_driver" AS "storageDriver",
          "storage_key" AS "storageKey",
          "processed_key" AS "processedKey",
          "checksum_sha256" AS "checksumSha256"
        FROM "community_attachments"
        ORDER BY "id" ASC
      `);
      attachments.push(...result.rows);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }

  const groups: Record<string, AcceptanceFingerprint> = {};
  for (const group of [...new Set(stableTableSpecs.map((spec) => spec.group))].sort()) {
    groups[group] = combineFingerprints(
      key,
      `nextbuf/acceptance-snapshot/v1/group/${group}`,
      stableTableSpecs
        .filter((spec) => spec.group === group)
        .map((spec) => [spec.name, tables[spec.name]!] as [string, AcceptanceFingerprint]),
    );
  }
  const overall = combineFingerprints(
    key,
    "nextbuf/acceptance-snapshot/v1/overall",
    Object.entries(groups),
  );
  const continuity = evaluateAdministratorContinuity(eligibleAdministrators);
  const storage = options.verifyObjects
    ? await verifyAttachmentObjects(attachments, key)
    : skippedStorageVerification();

  return {
    format: ACCEPTANCE_SNAPSHOT_FORMAT,
    capturedAt: new Date().toISOString(),
    application: {
      version: PROJECT.version,
      configuredVersion: options.configuredVersion ?? authEnvironment.NEXTBUF_VERSION,
      commit: authEnvironment.NEXTBUF_COMMIT,
      buildTime: authEnvironment.NEXTBUF_BUILD_TIME || null,
    },
    database: {
      schemaNameFingerprint: hmacDigest(key, "nextbuf/acceptance-snapshot/v1/schema-name", schema),
      transactionReadOnly,
      expectedMigrations: V1_0_0_MIGRATIONS,
      appliedMigrations: migrationState.applied,
      failedMigrations: migrationState.failed,
    },
    privacy: {
      algorithm: "HMAC-SHA-256",
      keyId: hmacDigest(key, "nextbuf/acceptance-snapshot/v1/key-id", "key-id"),
      rawIdentifiersIncluded: false,
      secretsIncluded: false,
    },
    capabilities,
    stable: { tables, groups, overall },
    integrity,
    administratorContinuity: {
      eligibleAdministrators,
      state: continuity.state,
    },
    storage,
    operations,
  };
}

async function readSnapshotFile(file: string): Promise<AcceptanceSnapshot> {
  const metadata = await stat(file);
  if (!metadata.isFile() || metadata.size < 2 || metadata.size > MAX_SNAPSHOT_FILE_BYTES) {
    throw new Error(`Acceptance snapshot file has an invalid size: ${file}`);
  }
  const content = await readFile(file, "utf8");
  return parseAcceptanceSnapshot(JSON.parse(content) as unknown);
}

export async function acceptance(args: string[]): Promise<void> {
  const [action, ...rest] = args;
  if (action === "snapshot") {
    const verifyObjects = rest.includes("--verify-objects");
    if (rest.some((argument) => argument !== "--verify-objects")) {
      throw new Error("Usage: nextbuf acceptance snapshot [--verify-objects]");
    }
    const snapshot = await captureAcceptanceSnapshot({ verifyObjects });
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  if (action === "compare") {
    if (rest.length !== 2) {
      throw new Error("Usage: nextbuf acceptance compare <before.json> <after.json>");
    }
    const [beforeFile, afterFile] = rest as [string, string];
    const [before, after] = await Promise.all([
      readSnapshotFile(beforeFile),
      readSnapshotFile(afterFile),
    ]);
    const comparison = compareAcceptanceSnapshots(before, after);
    console.log(JSON.stringify(comparison, null, 2));
    if (comparison.status !== "pass") {
      throw new Error("NextBuf acceptance comparison found invariant changes");
    }
    return;
  }

  console.log(
    "Usage: nextbuf acceptance <snapshot [--verify-objects]|compare <before.json> <after.json>>",
  );
  if (action) process.exitCode = 1;
}
