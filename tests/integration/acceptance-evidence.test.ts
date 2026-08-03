import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import {
  captureAcceptanceSnapshot,
  type CaptureAcceptanceSnapshotOptions,
} from "@/cli/commands/acceptance";
import { compareAcceptanceSnapshots } from "@/cli/acceptance-contract";
import { getDatabaseEnvironment } from "@/shared/config/runtime-env";
import {
  withIsolatedNextBufDatabase,
  withIsolatedV0_13_10Database,
} from "../support/isolated-nextbuf-database";

function databaseUrl(database: string): string {
  const environment = getDatabaseEnvironment();
  const url = new URL(environment.DATABASE_DIRECT_URL ?? environment.DATABASE_URL);
  url.pathname = `/${database}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

describe("acceptance evidence", () => {
  it("captures every stable table in a read-only, redacted snapshot", async () => {
    await withIsolatedNextBufDatabase("acceptance_evidence", async (prisma) => {
      const identity = {
        id: randomUUID(),
        username: "acceptance_member",
        email: "acceptance-member@nextbuf.test",
        name: "Acceptance member",
        password: "scrypt:acceptance-sensitive-password-hash",
        sessionToken: "acceptance-sensitive-session-token",
        verificationValue: JSON.stringify({ link: { userId: "placeholder" } }),
      };
      identity.verificationValue = JSON.stringify({ link: { userId: identity.id } });

      await prisma.user.create({
        data: {
          id: identity.id,
          username: identity.username,
          email: identity.email,
          name: identity.name,
          emailVerified: true,
          status: "active",
          activatedAt: new Date("2026-08-03T00:00:00.000Z"),
        },
      });
      await prisma.account.create({
        data: {
          accountId: identity.email,
          providerId: "credential",
          userId: identity.id,
          password: identity.password,
        },
      });
      const session = await prisma.session.create({
        data: {
          expiresAt: new Date("2026-09-03T00:00:00.000Z"),
          token: identity.sessionToken,
          userId: identity.id,
        },
      });
      await prisma.adminReauthentication.create({
        data: {
          sessionId: session.id,
          verifiedAt: new Date("2026-08-03T00:00:00.000Z"),
          expiresAt: new Date("2026-08-03T00:15:00.000Z"),
        },
      });
      await prisma.verification.create({
        data: {
          identifier: "a".repeat(64),
          value: identity.verificationValue,
          expiresAt: new Date("2026-08-04T00:00:00.000Z"),
        },
      });
      await prisma.communityRoleAssignment.create({
        data: {
          userId: identity.id,
          role: "admin",
          scopeKey: "site",
          reason: "Acceptance continuity fixture",
        },
      });

      const currentDatabase = await prisma.$queryRaw<Array<{ database: string }>>`
        SELECT current_database() AS "database"
      `;
      const options: CaptureAcceptanceSnapshotOptions = {
        authSecret: "acceptance-evidence-hmac-secret-at-least-32-characters",
        configuredVersion: "1.0.0",
        connectionString: databaseUrl(currentDatabase[0]!.database),
      };
      const before = await captureAcceptanceSnapshot(options);
      const encoded = JSON.stringify(before);

      expect(before.database.transactionReadOnly).toBe(true);
      expect(before.database.failedMigrations).toEqual([]);
      expect(before.capabilities).toEqual({
        accountDeletionFinalization: true,
        outboxProcessedStatus: true,
        emailAttemptFencing: true,
      });
      expect(before.administratorContinuity).toMatchObject({
        eligibleAdministrators: 1,
        state: "redundancy_warning",
      });
      expect(Object.values(before.integrity).every((check) => check.ok)).toBe(true);
      expect(before.stable.tables).toHaveProperty("users_active.rows", 1);
      expect(before.stable.tables).toHaveProperty("auth_accounts_active.rows", 1);
      expect(before.stable.tables).toHaveProperty("auth_sessions_active.rows", 1);
      expect(before.stable.tables).toHaveProperty("auth_verifications_non_deleted.rows", 1);
      for (const sensitive of Object.values(identity)) {
        expect(encoded).not.toContain(sensitive);
      }

      const unchanged = await captureAcceptanceSnapshot(options);
      expect(compareAcceptanceSnapshots(before, unchanged).status).toBe("pass");

      await prisma.user.update({
        where: { id: identity.id },
        data: { name: "Changed after snapshot" },
      });
      const changed = await captureAcceptanceSnapshot(options);
      const comparison = compareAcceptanceSnapshots(before, changed);
      expect(comparison.status).toBe("fail");
      expect(comparison.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "stable_data_changed", subject: "users_active" }),
        ]),
      );
    });
  });

  it("compares a real v0.13.10 database through the three candidate migrations", async () => {
    await withIsolatedV0_13_10Database(
      "acceptance_migration_regression",
      async ({ connectionString, deployCandidateMigrations }) => {
        const client = new Client({ connectionString });
        await client.connect();
        try {
          const now = new Date("2026-08-03T00:00:00.000Z");
          const administratorId = randomUUID();
          const memberId = randomUUID();
          const deletedMemberId = randomUUID();
          const nodeId = randomUUID();
          const topicId = randomUUID();
          const firstPostId = randomUUID();
          const replyId = randomUUID();
          const firstRevisionId = randomUUID();
          const replyRevisionId = randomUUID();
          const draftId = randomUUID();
          const attachmentId = randomUUID();
          const processedEventId = randomUUID();
          const mailEventId = randomUUID();
          const processedJobId = randomUUID();
          const deliveryId = randomUUID();
          const notificationId = randomUUID();
          const notificationDeliveryId = randomUUID();
          const workerFailureId = randomUUID();

          await client.query(
            `INSERT INTO "users" (
              "id", "username", "name", "email", "email_verified", "status",
              "activated_at", "created_at", "updated_at"
            ) VALUES
              ($1, 'acceptance_admin', 'Acceptance administrator', 'admin@acceptance.test', TRUE, 'active', $4, $4, $4),
              ($2, 'acceptance_member', 'Acceptance member', 'member@acceptance.test', TRUE, 'active', $4, $4, $4),
              ($3, 'legacy_deleted', 'Legacy deleted member', 'legacy-deleted@acceptance.test', FALSE, 'deleted', NULL, $4, $4)`,
            [administratorId, memberId, deletedMemberId, now],
          );
          await client.query(
            `UPDATE "users"
             SET "deletion_requested_at" = $2, "deletion_scheduled_at" = $2
             WHERE "id" = $1`,
            [deletedMemberId, now],
          );
          await client.query(
            `UPDATE "profiles"
             SET "bio" = 'Stable profile', "is_public" = TRUE,
                 "show_activity" = TRUE, "created_at" = $2, "updated_at" = $2
             WHERE "user_id" = $1`,
            [administratorId, now],
          );
          await client.query(
            `INSERT INTO "username_aliases" ("id", "username", "user_id", "created_at")
             VALUES ($1, 'acceptance_old', $2, $3)`,
            [randomUUID(), administratorId, now],
          );
          await client.query(
            `INSERT INTO "auth_accounts" (
              "id", "account_id", "provider_id", "user_id", "password", "created_at", "updated_at"
            ) VALUES
              ($1, 'admin@acceptance.test', 'credential', $2, 'scrypt:stable-admin-password', $4, $4),
              ($3, 'legacy-deleted@acceptance.test', 'credential', $5, 'scrypt:deleted-password', $4, $4)`,
            [randomUUID(), administratorId, randomUUID(), now, deletedMemberId],
          );
          await client.query(
            `INSERT INTO "auth_sessions" (
              "id", "expires_at", "token", "created_at", "updated_at", "user_id"
            ) VALUES
              ($1, $3, 'stable-admin-session-token', $2, $2, $4),
              ($5, $3, 'deleted-session-token', $2, $2, $6)`,
            [
              randomUUID(),
              now,
              new Date("2026-09-03T00:00:00.000Z"),
              administratorId,
              randomUUID(),
              deletedMemberId,
            ],
          );
          await client.query(
            `INSERT INTO "auth_verifications" (
              "id", "identifier", "value", "expires_at", "created_at", "updated_at"
            ) VALUES
              ($1, repeat('a', 64), $2, $4, $3, $3),
              ($5, repeat('b', 64), $6, $4, $3, $3)`,
            [
              randomUUID(),
              JSON.stringify({ link: { userId: administratorId } }),
              now,
              new Date("2026-08-04T00:00:00.000Z"),
              randomUUID(),
              JSON.stringify({ link: { userId: deletedMemberId } }),
            ],
          );
          await client.query(
            `INSERT INTO "community_role_assignments" (
              "id", "user_id", "role", "scope_key", "reason", "created_at"
            ) VALUES ($1, $2, 'admin', 'site', 'Acceptance continuity', $3)`,
            [randomUUID(), administratorId, now],
          );
          await client.query(
            `INSERT INTO "community_nodes" (
              "id", "slug", "name", "description", "color", "icon", "sort_order", "visibility", "created_at", "updated_at"
            ) VALUES ($1, 'acceptance', 'Acceptance', 'Stable acceptance node', '#123456', 'hash', 0, 'public', $2, $2)`,
            [nodeId, now],
          );
          await client.query(
            `INSERT INTO "community_topics" (
              "id", "node_id", "author_id", "title", "status", "reply_count", "view_count", "bookmark_count",
              "next_post_position", "last_activity_at", "published_at", "created_at", "updated_at"
            ) VALUES ($1, $2, $3, 'Stable acceptance topic', 'published', 1, 7, 1, 3, $4, $4, $4, $4)`,
            [topicId, nodeId, administratorId, now],
          );
          await client.query(
            `INSERT INTO "community_posts" (
              "id", "topic_id", "author_id", "position", "status", "body_source", "revision_count", "like_count", "created_at", "updated_at"
            ) VALUES
              ($1, $2, $3, 1, 'published', 'Stable first post', 1, 1, $5, $5),
              ($4, $2, $6, 2, 'published', 'Stable reply', 1, 0, $5, $5)`,
            [firstPostId, topicId, administratorId, replyId, now, memberId],
          );
          await client.query(
            `INSERT INTO "community_post_revisions" (
              "id", "post_id", "editor_id", "version", "title", "body_source", "source", "created_at"
            ) VALUES
              ($1, $2, $3, 1, 'Stable acceptance topic', 'Stable first post', 'create', $5),
              ($4, $6, $7, 1, NULL, 'Stable reply', 'create', $5)`,
            [
              firstRevisionId,
              firstPostId,
              administratorId,
              replyRevisionId,
              now,
              replyId,
              memberId,
            ],
          );
          await client.query(
            `INSERT INTO "community_post_drafts" (
              "id", "topic_id", "author_id", "body_source", "created_at", "updated_at"
            ) VALUES ($1, $2, $3, 'Stable draft', $4, $4)`,
            [draftId, topicId, memberId, now],
          );
          await client.query(
            `INSERT INTO "community_post_mentions" ("post_id", "mentioned_user_id", "created_at")
             VALUES ($1, $2, $3)`,
            [replyId, administratorId, now],
          );
          await client.query(
            `INSERT INTO "community_attachments" (
              "id", "uploader_id", "storage_driver", "storage_key", "original_name", "content_type", "kind", "status",
              "size_bytes", "checksum_sha256", "created_at", "updated_at"
            ) VALUES ($1, $2, 'local', 'acceptance-proof.txt', 'acceptance-proof.txt', 'text/plain', 'file', 'ready', 16, repeat('c', 64), $3, $3)`,
            [attachmentId, administratorId, now],
          );
          await client.query(
            `INSERT INTO "community_post_attachments" ("post_id", "attachment_id", "created_at")
             VALUES ($1, $2, $3)`,
            [replyId, attachmentId, now],
          );
          await client.query(
            `INSERT INTO "community_revision_attachments" ("revision_id", "attachment_id", "created_at")
             VALUES ($1, $2, $3)`,
            [replyRevisionId, attachmentId, now],
          );
          await client.query(
            `INSERT INTO "community_post_draft_attachments" ("draft_id", "attachment_id", "created_at")
             VALUES ($1, $2, $3)`,
            [draftId, attachmentId, now],
          );
          await client.query(
            `INSERT INTO "interaction_post_likes" ("user_id", "post_id", "created_at")
             VALUES ($1, $2, $3)`,
            [memberId, firstPostId, now],
          );
          await client.query(
            `INSERT INTO "interaction_topic_bookmarks" ("user_id", "topic_id", "created_at")
             VALUES ($1, $2, $3)`,
            [memberId, topicId, now],
          );
          await client.query(
            `INSERT INTO "community_audit_events" ("id", "actor_id", "action", "topic_id", "post_id", "node_id", "created_at")
             VALUES ($1, $2, 'topic.created', $3, $4, $5, $6)`,
            [randomUUID(), administratorId, topicId, firstPostId, nodeId, now],
          );
          await client.query(
            `INSERT INTO "outbox_events" (
              "id", "topic", "payload", "idempotency_key", "occurred_at", "available_at", "published_at", "created_at", "updated_at"
            ) VALUES
              ($1, 'nextbuf.test.processed', '{}'::jsonb, 'acceptance-processed', $3, $3, $3, $3, $3),
              ($2, 'nextbuf.mail.delivery.send', jsonb_build_object('deliveryId', $4::text), 'acceptance-mail', $3, $3, NULL, $3, $3)`,
            [processedEventId, mailEventId, now, deliveryId],
          );
          await client.query(
            `INSERT INTO "processed_jobs" (
              "id", "queue_name", "job_name", "idempotency_key", "completed_at"
            ) VALUES ($1, 'system', 'outbox', $2, $3)`,
            [processedJobId, `outbox-${processedEventId}`, now],
          );
          await client.query(
            `INSERT INTO "email_deliveries" (
              "id", "kind", "recipient", "subject", "ciphertext", "initialization_vector", "auth_tag", "status", "attempts", "created_at", "updated_at"
            ) VALUES ($1, 'notification', 'member@acceptance.test', 'Acceptance mail', 'ciphertext', '012345678901234567890123', '012345678901234567890123', 'sending', 2, $2, $2)`,
            [deliveryId, now],
          );
          await client.query(
            `INSERT INTO "notifications" (
              "id", "recipient_id", "actor_id", "type", "dedupe_key", "snapshot", "created_at", "updated_at"
            ) VALUES ($1, $2, $3, 'reply', 'acceptance-mail-notification', '{}'::jsonb, $4, $4)`,
            [notificationId, administratorId, memberId, now],
          );
          await client.query(
            `INSERT INTO "notification_deliveries" (
              "id", "notification_id", "channel", "status", "email_delivery_id", "created_at", "updated_at"
            ) VALUES ($1, $2, 'email', 'queued', $3, $4, $4)`,
            [notificationDeliveryId, notificationId, deliveryId, now],
          );
          await client.query(
            `INSERT INTO "worker_job_failures" (
              "id", "queue_name", "job_id", "job_name", "outbox_event_id", "attempts", "last_error", "failed_at", "created_at", "updated_at"
            ) VALUES ($1, 'mail', 'acceptance-mail-job', 'mail.send', $2, 2, 'raw SMTP failure', $3, $3, $3)`,
            [workerFailureId, mailEventId, now],
          );

          const options: CaptureAcceptanceSnapshotOptions = {
            authSecret: "acceptance-migration-hmac-secret-at-least-32-characters",
            configuredVersion: "0.13.10",
            connectionString,
          };
          const before = await captureAcceptanceSnapshot(options);
          expect(before.database.appliedMigrations).toHaveLength(13);
          expect(before.capabilities).toEqual({
            accountDeletionFinalization: false,
            outboxProcessedStatus: false,
            emailAttemptFencing: false,
          });

          await deployCandidateMigrations();

          const after = await captureAcceptanceSnapshot({
            ...options,
            configuredVersion: "1.0.0",
          });
          expect(after.database.appliedMigrations).toHaveLength(16);
          expect(after.capabilities).toEqual({
            accountDeletionFinalization: true,
            outboxProcessedStatus: true,
            emailAttemptFencing: true,
          });
          expect(compareAcceptanceSnapshots(before, after).status).toBe("pass");

          const transformed = await client.query<{
            processedAt: Date | null;
            status: string;
            attemptGeneration: number;
            linkedDeliveryId: string | null;
            notificationStatus: string;
            notificationEmailDeliveryId: string | null;
            deletedAccounts: number;
            deletedSessions: number;
            deletedVerifications: number;
            legacyAlias: number;
          }>(
            `SELECT
              (SELECT "processed_at" FROM "outbox_events" WHERE "id" = $1) AS "processedAt",
              (SELECT "status" FROM "email_deliveries" WHERE "id" = $2) AS "status",
              (SELECT "attempt_generation" FROM "email_deliveries" WHERE "id" = $2) AS "attemptGeneration",
              (SELECT "email_delivery_id" FROM "worker_job_failures" WHERE "id" = $3)::text AS "linkedDeliveryId",
              (SELECT "status" FROM "notification_deliveries" WHERE "id" = $5) AS "notificationStatus",
              (SELECT "email_delivery_id" FROM "notification_deliveries" WHERE "id" = $5)::text AS "notificationEmailDeliveryId",
              (SELECT COUNT(*)::integer FROM "auth_accounts" WHERE "user_id" = $4) AS "deletedAccounts",
              (SELECT COUNT(*)::integer FROM "auth_sessions" WHERE "user_id" = $4) AS "deletedSessions",
              (SELECT COUNT(*)::integer FROM "auth_verifications" WHERE "value"::jsonb #>> '{link,userId}' = $4::text) AS "deletedVerifications",
              (SELECT COUNT(*)::integer FROM "username_aliases" WHERE "user_id" = $4 AND "username" = 'legacy_deleted') AS "legacyAlias"`,
            [
              processedEventId,
              deliveryId,
              workerFailureId,
              deletedMemberId,
              notificationDeliveryId,
            ],
          );
          expect(transformed.rows[0]).toMatchObject({
            processedAt: now,
            status: "outcome_unknown",
            attemptGeneration: 2,
            linkedDeliveryId: deliveryId,
            notificationStatus: "failed",
            notificationEmailDeliveryId: deliveryId,
            deletedAccounts: 0,
            deletedSessions: 0,
            deletedVerifications: 0,
            legacyAlias: 1,
          });

          await client.query(
            `UPDATE "outbox_events"
             SET "processed_at" = "processed_at" + INTERVAL '1 millisecond'
             WHERE "id" = $1`,
            [processedEventId],
          );
          await client.query(
            `UPDATE "email_deliveries"
             SET "attempt_generation" = "attempt_generation" + 1
             WHERE "id" = $1`,
            [deliveryId],
          );
          const normalRuntimeState = await captureAcceptanceSnapshot({
            ...options,
            configuredVersion: "1.0.0",
          });
          expect(normalRuntimeState.integrity.outbox_processed_linkage).toMatchObject({
            applicable: true,
            ok: true,
            violations: 0,
          });
          expect(normalRuntimeState.integrity.email_attempt_fencing_state).toMatchObject({
            applicable: true,
            ok: true,
            violations: 0,
          });

          await client.query(
            `UPDATE "email_deliveries"
             SET "updated_at" = "updated_at" + INTERVAL '1 day'
             WHERE "id" = $1`,
            [deliveryId],
          );
          await client.query(
            `UPDATE "notification_deliveries"
             SET "updated_at" = "updated_at" + INTERVAL '1 day'
             WHERE "id" = $1`,
            [notificationDeliveryId],
          );
          await client.query(
            `UPDATE "outbox_events"
             SET "updated_at" = "updated_at" + INTERVAL '1 day'
             WHERE "id" = $1`,
            [mailEventId],
          );
          await client.query(
            `UPDATE "worker_job_failures"
             SET "updated_at" = "updated_at" + INTERVAL '1 day'
             WHERE "id" = $1`,
            [workerFailureId],
          );
          const updatedAtChanged = await captureAcceptanceSnapshot({
            ...options,
            configuredVersion: "1.0.0",
          });
          expect(compareAcceptanceSnapshots(normalRuntimeState, updatedAtChanged).issues).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                code: "stable_data_changed",
                subject: "email_deliveries_preserved",
              }),
              expect.objectContaining({
                code: "stable_data_changed",
                subject: "notification_deliveries_structure",
              }),
              expect.objectContaining({
                code: "stable_data_changed",
                subject: "outbox_events_structure",
              }),
              expect.objectContaining({
                code: "stable_data_changed",
                subject: "worker_job_failures_structure",
              }),
            ]),
          );

          await client.query(`UPDATE "email_deliveries" SET "status" = 'failed' WHERE "id" = $1`, [
            deliveryId,
          ]);
          await client.query(
            `UPDATE "notification_deliveries" SET "status" = 'delivered' WHERE "id" = $1`,
            [notificationDeliveryId],
          );
          await client.query(
            `UPDATE "outbox_events" SET "last_error" = 'corrupted' WHERE "id" = $1`,
            [processedEventId],
          );
          await client.query(
            `UPDATE "worker_job_failures" SET "last_error" = 'corrupted' WHERE "id" = $1`,
            [workerFailureId],
          );
          await client.query(`UPDATE "community_posts" SET "status" = 'hidden' WHERE "id" = $1`, [
            replyId,
          ]);
          const changed = await captureAcceptanceSnapshot({
            ...options,
            configuredVersion: "1.0.0",
          });
          const comparison = compareAcceptanceSnapshots(updatedAtChanged, changed);
          expect(comparison.status).toBe("fail");
          expect(comparison.issues).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ code: "stable_data_changed", subject: "community_posts" }),
              expect.objectContaining({
                code: "stable_data_changed",
                subject: "email_deliveries_preserved",
              }),
              expect.objectContaining({
                code: "stable_data_changed",
                subject: "notification_deliveries_structure",
              }),
              expect.objectContaining({
                code: "stable_data_changed",
                subject: "outbox_events_structure",
              }),
              expect.objectContaining({
                code: "stable_data_changed",
                subject: "worker_job_failures_structure",
              }),
            ]),
          );
        } finally {
          await client.end();
        }
      },
    );
  }, 120_000);
});
