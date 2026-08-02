import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { createOutboxEvent } from "@/infrastructure/outbox/create-event";
import { deleteAvatarFromUrl } from "@/infrastructure/storage/avatar-storage";
import {
  acquireAdministratorContinuityLock,
  assertAdministratorHandoverComplete,
} from "@/modules/admin/continuity.server";
import { ATTACHMENT_COLLECT_TOPIC } from "@/modules/community/attachments.server";
import { getTopicViewUserKeyHashesForDeletion } from "@/modules/interactions/topic-view-identity.server";
import { getErrorMessage } from "@/shared/errors/error-message";
import {
  ACCOUNT_TOMBSTONE_EMAIL_DOMAIN,
  ACCOUNT_TOMBSTONE_USERNAME_PREFIX,
  isAccountTombstoneUsername,
} from "@/modules/identity/account-tombstone-policy";

export const ACCOUNT_DELETION_GRACE_DAYS = 14;
export const ACCOUNT_DELETION_BATCH_SIZE = 10;
export const ACCOUNT_DELETION_AVATAR_COLLECT_TOPIC =
  "nextbuf.identity.account-deletion.avatar.collect";

const claimLeaseMs = 5 * 60_000;
const finalizationTransactionTimeoutMs = 2 * 60_000;
const minimumRetryMs = 60_000;
const maximumRetryMs = 24 * 60 * 60_000;
const deletedAccountName = "已注销用户";

type DeletionTransaction = Prisma.TransactionClient;
type ClaimedAccountDeletion = {
  id: string;
  deletionAttemptCount: number;
  deletionNextAttemptAt: Date;
};

export class AccountDeletionError extends Error {
  constructor(
    public readonly code: "account_already_deleted" | "account_deletion_not_due",
    public readonly status: number,
  ) {
    super(code);
  }
}

export type AccountDeletionBatchResult = {
  claimed: number;
  finalized: number;
  failed: number;
  skipped: number;
};

function deletedEmail(userId: string): string {
  return `deleted+${userId}@${ACCOUNT_TOMBSTONE_EMAIL_DOMAIN}`;
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(
    maximumRetryMs,
    minimumRetryMs * 2 ** Math.min(Math.max(attemptCount - 1, 0), 10),
  );
}

async function lockUser(transaction: DeletionTransaction, userId: string): Promise<void> {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "users" WHERE "id" = CAST(${userId} AS uuid) FOR UPDATE`,
  );
}

async function deleteAuthVerifications(
  transaction: DeletionTransaction,
  userId: string,
): Promise<void> {
  await transaction.$executeRaw(
    Prisma.sql`DELETE FROM "auth_verifications"
      WHERE nextbuf_auth_verification_owner_id("value") = CAST(${userId} AS uuid)`,
  );
}

export async function updateAccountDeletionRequest(
  userId: string,
  action: "request" | "cancel",
  now = new Date(),
): Promise<Date | null> {
  return getPrismaClient().$transaction(async (transaction) => {
    if (action === "request") {
      await assertAdministratorHandoverComplete(transaction, userId);
    } else {
      await acquireAdministratorContinuityLock(transaction);
    }
    await lockUser(transaction, userId);
    const user = await transaction.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        status: true,
        deletionRequestedAt: true,
        deletionScheduledAt: true,
        deletionFinalizedAt: true,
      },
    });
    if (user.status === "deleted" || user.deletionFinalizedAt) {
      throw new AccountDeletionError("account_already_deleted", 409);
    }

    if (action === "cancel") {
      await transaction.user.update({
        where: { id: userId },
        data: {
          deletionRequestedAt: null,
          deletionScheduledAt: null,
          deletionAttemptCount: 0,
          deletionNextAttemptAt: null,
          deletionLastError: null,
        },
      });
      return null;
    }

    const scheduledAt =
      user.deletionScheduledAt ??
      new Date(now.getTime() + ACCOUNT_DELETION_GRACE_DAYS * 86_400_000);
    await transaction.user.update({
      where: { id: userId },
      data: {
        deletionRequestedAt: user.deletionRequestedAt ?? now,
        deletionScheduledAt: scheduledAt,
      },
    });
    return scheduledAt;
  });
}

function deletedUsername(uid: number): string {
  return `${ACCOUNT_TOMBSTONE_USERNAME_PREFIX}${uid}`;
}

async function queuePrivateAttachmentCollection(
  transaction: DeletionTransaction,
  userId: string,
  now: Date,
): Promise<void> {
  // Compute post-deletion liveness before cascades remove the only link from a
  // private draft to an attachment uploaded by another member.
  await transaction.$executeRaw(
    Prisma.sql`WITH private_topics AS MATERIALIZED (
        SELECT topic."id"
        FROM "community_topics" AS topic
        WHERE topic."author_id" = CAST(${userId} AS uuid)
          AND (
            topic."status" = 'draft'
            OR (
              topic."status" = 'deleted'
              AND (
                topic."deleted_from_status" IS NULL
                OR topic."deleted_from_status" NOT IN ('published', 'closed', 'hidden')
              )
            )
          )
      ), private_posts AS MATERIALIZED (
        SELECT post."id"
        FROM "community_posts" AS post
        WHERE (post."author_id" = CAST(${userId} AS uuid) AND post."status" = 'draft')
           OR EXISTS (
             SELECT 1 FROM private_topics WHERE private_topics."id" = post."topic_id"
           )
      ), private_drafts AS MATERIALIZED (
        SELECT draft."id"
        FROM "community_post_drafts" AS draft
        WHERE draft."author_id" = CAST(${userId} AS uuid)
           OR EXISTS (
             SELECT 1 FROM private_topics WHERE private_topics."id" = draft."topic_id"
           )
      ), candidate_attachments AS MATERIALIZED (
        SELECT attachment."id"
        FROM "community_attachments" AS attachment
        WHERE attachment."uploader_id" = CAST(${userId} AS uuid)
        UNION
        SELECT reference."attachment_id"
        FROM "community_post_attachments" AS reference
        INNER JOIN private_posts ON private_posts."id" = reference."post_id"
        UNION
        SELECT reference."attachment_id"
        FROM "community_revision_attachments" AS reference
        INNER JOIN "community_post_revisions" AS revision
          ON revision."id" = reference."revision_id"
        INNER JOIN private_posts ON private_posts."id" = revision."post_id"
        UNION
        SELECT reference."attachment_id"
        FROM "community_post_draft_attachments" AS reference
        INNER JOIN private_drafts ON private_drafts."id" = reference."draft_id"
      ), orphaned AS (
        UPDATE "community_attachments" AS attachment
        SET "orphaned_at" = TIMESTAMPTZ '1970-01-01 00:00:00+00',
            "original_name" = 'deleted',
            "updated_at" = ${now}
        WHERE EXISTS (
            SELECT 1 FROM candidate_attachments
            WHERE candidate_attachments."id" = attachment."id"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "community_post_attachments" AS reference
            WHERE reference."attachment_id" = attachment."id"
              AND NOT EXISTS (
                SELECT 1 FROM private_posts WHERE private_posts."id" = reference."post_id"
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "community_revision_attachments" AS reference
            INNER JOIN "community_post_revisions" AS revision
              ON revision."id" = reference."revision_id"
            WHERE reference."attachment_id" = attachment."id"
              AND NOT EXISTS (
                SELECT 1 FROM private_posts WHERE private_posts."id" = revision."post_id"
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "community_post_draft_attachments" AS reference
            WHERE reference."attachment_id" = attachment."id"
              AND NOT EXISTS (
                SELECT 1 FROM private_drafts WHERE private_drafts."id" = reference."draft_id"
              )
          )
        RETURNING attachment."id"
      )
      INSERT INTO "outbox_events" (
        "id", "topic", "idempotency_key", "payload", "available_at", "updated_at"
      )
      SELECT
        gen_random_uuid(),
        ${ATTACHMENT_COLLECT_TOPIC},
        ${`identity-deletion-attachment-collect:${userId}:`} || orphaned."id"::text,
        jsonb_build_object('attachmentId', orphaned."id"::text),
        ${now},
        ${now}
      FROM orphaned
      ON CONFLICT ("idempotency_key") DO NOTHING`,
  );
}

async function deletePrivateContent(
  transaction: DeletionTransaction,
  userId: string,
): Promise<void> {
  await transaction.$executeRaw(
    Prisma.sql`WITH private_topics AS MATERIALIZED (
        SELECT topic."id"
        FROM "community_topics" AS topic
        WHERE topic."author_id" = CAST(${userId} AS uuid)
          AND (
            topic."status" = 'draft'
            OR (
              topic."status" = 'deleted'
              AND (
                topic."deleted_from_status" IS NULL
                OR topic."deleted_from_status" NOT IN ('published', 'closed', 'hidden')
              )
            )
          )
      ), private_posts AS MATERIALIZED (
        SELECT post."id"
        FROM "community_posts" AS post
        WHERE (post."author_id" = CAST(${userId} AS uuid) AND post."status" = 'draft')
           OR EXISTS (
             SELECT 1 FROM private_topics WHERE private_topics."id" = post."topic_id"
           )
      )
      UPDATE "community_audit_events" AS audit
      SET "request_id" = NULL, "metadata" = NULL
      WHERE EXISTS (
          SELECT 1 FROM private_topics WHERE private_topics."id" = audit."topic_id"
        )
         OR EXISTS (
          SELECT 1 FROM private_posts WHERE private_posts."id" = audit."post_id"
        )`,
  );
  for (const table of ["moderation_reports", "moderation_cases", "moderation_actions"] as const) {
    await transaction.$executeRaw(
      Prisma.sql`WITH private_topics AS MATERIALIZED (
          SELECT topic."id"
          FROM "community_topics" AS topic
          WHERE topic."author_id" = CAST(${userId} AS uuid)
            AND (
              topic."status" = 'draft'
              OR (
                topic."status" = 'deleted'
                AND (
                  topic."deleted_from_status" IS NULL
                  OR topic."deleted_from_status" NOT IN ('published', 'closed', 'hidden')
                )
              )
            )
        ), private_posts AS MATERIALIZED (
          SELECT post."id"
          FROM "community_posts" AS post
          WHERE (post."author_id" = CAST(${userId} AS uuid) AND post."status" = 'draft')
             OR EXISTS (
               SELECT 1 FROM private_topics WHERE private_topics."id" = post."topic_id"
             )
        )
        UPDATE ${Prisma.raw(`"${table}"`)} AS target
        SET "topic_id" = CASE
              WHEN EXISTS (
                SELECT 1 FROM private_topics WHERE private_topics."id" = target."topic_id"
              ) THEN NULL
              ELSE target."topic_id"
            END,
            "post_id" = NULL
        WHERE EXISTS (
            SELECT 1 FROM private_topics WHERE private_topics."id" = target."topic_id"
          )
           OR EXISTS (
            SELECT 1 FROM private_posts WHERE private_posts."id" = target."post_id"
          )`,
    );
  }

  await transaction.communityPostDraft.deleteMany({ where: { authorId: userId } });
  await transaction.communityReplyEditorSession.deleteMany({ where: { authorId: userId } });
  await transaction.communityPost.deleteMany({ where: { authorId: userId, status: "draft" } });
  await transaction.$executeRaw(
    Prisma.sql`DELETE FROM "community_topics"
      WHERE "author_id" = CAST(${userId} AS uuid)
        AND (
          "status" = 'draft'
          OR (
            "status" = 'deleted'
            AND (
              "deleted_from_status" IS NULL
              OR "deleted_from_status" NOT IN ('published', 'closed', 'hidden')
            )
          )
        )`,
  );
}

async function anonymizeCommunityAuditEvents(
  transaction: DeletionTransaction,
  userId: string,
): Promise<void> {
  await transaction.communityAuditEvent.updateMany({
    where: { actorId: userId },
    data: { requestId: null, metadata: Prisma.DbNull },
  });
}

async function deletePrivateInteractions(
  transaction: DeletionTransaction,
  userId: string,
): Promise<void> {
  await transaction.$executeRaw(
    Prisma.sql`WITH removed AS (
        DELETE FROM "interaction_post_likes"
        WHERE "user_id" = CAST(${userId} AS uuid)
        RETURNING "post_id"
      ), totals AS (
        SELECT "post_id", COUNT(*)::integer AS "count" FROM removed GROUP BY "post_id"
      )
      UPDATE "community_posts" AS p
      SET "like_count" = GREATEST(0, p."like_count" - totals."count"),
          "updated_at" = CURRENT_TIMESTAMP
      FROM totals WHERE p."id" = totals."post_id"`,
  );
  await transaction.$executeRaw(
    Prisma.sql`WITH removed AS (
        DELETE FROM "interaction_topic_bookmarks"
        WHERE "user_id" = CAST(${userId} AS uuid)
        RETURNING "topic_id"
      ), totals AS (
        SELECT "topic_id", COUNT(*)::integer AS "count" FROM removed GROUP BY "topic_id"
      )
      UPDATE "community_topics" AS t
      SET "bookmark_count" = GREATEST(0, t."bookmark_count" - totals."count"),
          "updated_at" = CURRENT_TIMESTAMP
      FROM totals WHERE t."id" = totals."topic_id"`,
  );
  await transaction.interactionUserFollow.deleteMany({
    where: { OR: [{ followerId: userId }, { followedId: userId }] },
  });
  await transaction.interactionTopicFollow.deleteMany({ where: { userId } });
  await transaction.interactionTopicReadState.deleteMany({ where: { userId } });
  await transaction.communityPostMention.deleteMany({ where: { mentionedUserId: userId } });

  const viewerKeyHashes = getTopicViewUserKeyHashesForDeletion(userId);
  await transaction.interactionTopicView.deleteMany({
    where: { viewerKeyHash: { in: viewerKeyHashes } },
  });
}

async function anonymizeNotifications(
  transaction: DeletionTransaction,
  userId: string,
  deletedUsername: string,
): Promise<void> {
  await transaction.notification.deleteMany({ where: { recipientId: userId } });
  await transaction.notificationPreference.deleteMany({ where: { userId } });
  await transaction.$executeRaw(
    Prisma.sql`UPDATE "notifications"
      SET "actor_id" = NULL,
          "snapshot" = jsonb_set(
            jsonb_set("snapshot", '{actorName}', to_jsonb(CAST(${deletedAccountName} AS text)), true),
            '{actorUsername}', to_jsonb(CAST(${deletedUsername} AS text)), true
          ),
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "actor_id" = CAST(${userId} AS uuid)`,
  );
}

async function deletePrivateEmailData(
  transaction: DeletionTransaction,
  userId: string,
  email: string,
): Promise<void> {
  // Mail claim, completion, failure and replay all lock EmailDelivery before their
  // failure and Outbox facts. Aggregate the ordered lock set to one result row so
  // account size does not materialize an ID array in the Worker.
  const [lockSummary] = await transaction.$queryRaw<Array<{ hasUnresolved: boolean }>>(
    Prisma.sql`WITH locked_deliveries AS MATERIALIZED (
        SELECT delivery."id", delivery."status"
        FROM "email_deliveries" AS delivery
        WHERE lower(delivery."recipient") = lower(${email})
           OR EXISTS (
             SELECT 1
             FROM "notification_deliveries" AS notification_delivery
             INNER JOIN "notifications" AS notification
               ON notification."id" = notification_delivery."notification_id"
             WHERE notification_delivery."email_delivery_id" = delivery."id"
               AND notification."actor_id" = CAST(${userId} AS uuid)
           )
        ORDER BY delivery."id"
        FOR UPDATE OF delivery
      )
      SELECT COALESCE(
        bool_or(locked_deliveries."status" IN ('sending', 'outcome_unknown')),
        FALSE
      ) AS "hasUnresolved"
      FROM locked_deliveries`,
  );
  if (lockSummary?.hasUnresolved) {
    throw new Error("Account deletion is waiting for an unresolved email delivery outcome");
  }

  await transaction.$executeRaw(
    Prisma.sql`WITH target_deliveries AS MATERIALIZED (
        SELECT delivery."id"
        FROM "email_deliveries" AS delivery
        WHERE lower(delivery."recipient") = lower(${email})
           OR EXISTS (
             SELECT 1
             FROM "notification_deliveries" AS notification_delivery
             INNER JOIN "notifications" AS notification
               ON notification."id" = notification_delivery."notification_id"
             WHERE notification_delivery."email_delivery_id" = delivery."id"
               AND notification."actor_id" = CAST(${userId} AS uuid)
           )
      )
      DELETE FROM "worker_job_failures" AS failure
      USING "outbox_events" AS event
      WHERE failure."outbox_event_id" = event."id"
        AND event."topic" IN (
          'nextbuf.identity.email.send',
          'nextbuf.mail.delivery.send'
        )
        AND EXISTS (
          SELECT 1 FROM target_deliveries
          WHERE target_deliveries."id"::text = event."payload"->>'deliveryId'
        )`,
  );
  await transaction.$executeRaw(
    Prisma.sql`WITH target_deliveries AS MATERIALIZED (
        SELECT delivery."id"
        FROM "email_deliveries" AS delivery
        WHERE lower(delivery."recipient") = lower(${email})
           OR EXISTS (
             SELECT 1
             FROM "notification_deliveries" AS notification_delivery
             INNER JOIN "notifications" AS notification
               ON notification."id" = notification_delivery."notification_id"
             WHERE notification_delivery."email_delivery_id" = delivery."id"
               AND notification."actor_id" = CAST(${userId} AS uuid)
           )
      )
      UPDATE "outbox_events" AS event
      SET "last_error" = NULL, "updated_at" = CURRENT_TIMESTAMP
      WHERE event."topic" IN (
          'nextbuf.identity.email.send',
          'nextbuf.mail.delivery.send'
        )
        AND EXISTS (
          SELECT 1 FROM target_deliveries
          WHERE target_deliveries."id"::text = event."payload"->>'deliveryId'
        )`,
  );
  await transaction.$executeRaw(
    Prisma.sql`DELETE FROM "email_deliveries" AS delivery
      WHERE lower(delivery."recipient") = lower(${email})
         OR EXISTS (
           SELECT 1
           FROM "notification_deliveries" AS notification_delivery
           INNER JOIN "notifications" AS notification
             ON notification."id" = notification_delivery."notification_id"
           WHERE notification_delivery."email_delivery_id" = delivery."id"
             AND notification."actor_id" = CAST(${userId} AS uuid)
         )`,
  );
}

async function detachMutableGovernanceAssignments(
  transaction: DeletionTransaction,
  userId: string,
): Promise<void> {
  await transaction.moderationCase.updateMany({
    where: { assignedToId: userId },
    data: { assignedToId: null },
  });
}

async function finalizeClaimedAccount(
  claim: ClaimedAccountDeletion,
  now: Date,
): Promise<"finalized" | "skipped"> {
  return getPrismaClient().$transaction(
    async (transaction) => {
      await transaction.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '110s'`);
      await acquireAdministratorContinuityLock(transaction);
      await lockUser(transaction, claim.id);
      const user = await transaction.user.findUniqueOrThrow({ where: { id: claim.id } });
      if (user.deletionFinalizedAt) return "skipped";
      if (
        user.deletionAttemptCount !== claim.deletionAttemptCount ||
        user.deletionNextAttemptAt?.getTime() !== claim.deletionNextAttemptAt.getTime()
      ) {
        return "skipped";
      }
      if (!user.deletionScheduledAt || user.deletionScheduledAt > now) return "skipped";
      await assertAdministratorHandoverComplete(transaction, claim.id);
      const tombstoneUsername = deletedUsername(user.uid);
      await queuePrivateAttachmentCollection(transaction, user.id, now);
      await deletePrivateContent(transaction, user.id);
      await anonymizeCommunityAuditEvents(transaction, user.id);
      await deletePrivateInteractions(transaction, user.id);
      await deletePrivateEmailData(transaction, user.id, user.email);
      await anonymizeNotifications(transaction, user.id, tombstoneUsername);
      await detachMutableGovernanceAssignments(transaction, user.id);

      await transaction.session.deleteMany({ where: { userId: user.id } });
      await transaction.account.deleteMany({ where: { userId: user.id } });
      await deleteAuthVerifications(transaction, user.id);
      await transaction.profile.deleteMany({ where: { userId: user.id } });
      await transaction.trustUserState.deleteMany({ where: { userId: user.id } });
      await transaction.workerJobFailure.updateMany({
        where: { replayRequestedById: user.id },
        data: { replayRequestedById: null },
      });
      await transaction.communityRoleAssignment.updateMany({
        where: { grantedById: user.id },
        data: { grantedById: null },
      });
      await transaction.communityRoleAssignment.deleteMany({ where: { userId: user.id } });

      await transaction.$executeRaw(
        Prisma.sql`UPDATE "identity_audit_events"
          SET "session_id" = NULL, "ip_hash" = NULL, "metadata" = NULL
          WHERE "user_id" = CAST(${user.id} AS uuid)`,
      );
      await transaction.identityAuditEvent.create({
        data: { eventType: "identity.deletion.finalized", userId: user.id },
      });

      if (!isAccountTombstoneUsername(user.username)) {
        const existingAlias = await transaction.usernameAlias.findUnique({
          where: { username: user.username },
          select: { userId: true },
        });
        if (!existingAlias) {
          await transaction.usernameAlias.create({
            data: { username: user.username, userId: user.id },
          });
        } else if (existingAlias.userId !== user.id) {
          throw new Error("Current username is owned by another account alias");
        }
      }
      await transaction.user.update({
        where: { id: user.id },
        data: {
          username: tombstoneUsername,
          name: deletedAccountName,
          email: deletedEmail(user.id),
          emailVerified: false,
          image: null,
          status: "deleted",
          activatedAt: null,
          usernameChangedAt: null,
          deletionRequestedAt: null,
          deletionScheduledAt: null,
          deletionFinalizedAt: now,
          deletionNextAttemptAt: null,
          deletionLastError: null,
        },
      });
      if (user.image?.startsWith("/api/media/avatars/")) {
        await createOutboxEvent(transaction, {
          topic: ACCOUNT_DELETION_AVATAR_COLLECT_TOPIC,
          idempotencyKey: `identity-deletion-avatar-collect:${user.id}`,
          payload: { url: user.image },
          availableAt: now,
        });
      }
      return "finalized";
    },
    { timeout: finalizationTransactionTimeoutMs },
  );
}

async function recordFinalizationFailure(
  claim: ClaimedAccountDeletion,
  now: Date,
  error: unknown,
): Promise<void> {
  await getPrismaClient().user.updateMany({
    where: {
      id: claim.id,
      deletionFinalizedAt: null,
      deletionScheduledAt: { not: null },
      deletionAttemptCount: claim.deletionAttemptCount,
      deletionNextAttemptAt: claim.deletionNextAttemptAt,
    },
    data: {
      deletionNextAttemptAt: new Date(
        Math.max(Date.now(), now.getTime()) + retryDelayMs(claim.deletionAttemptCount),
      ),
      deletionLastError: getErrorMessage(error).slice(0, 8_000),
    },
  });
}

async function claimNextDueAccountDeletion(now: Date): Promise<ClaimedAccountDeletion | null> {
  const leaseBase = Math.max(Date.now(), now.getTime());
  const leaseUntil = new Date(leaseBase + claimLeaseMs);
  const [claimed] = await getPrismaClient().$transaction((transaction) =>
    transaction.$queryRaw<ClaimedAccountDeletion[]>(
      Prisma.sql`WITH due AS (
          SELECT "id" FROM "users"
          WHERE "deletion_scheduled_at" <= ${now}
            AND "deletion_finalized_at" IS NULL
            AND ("deletion_next_attempt_at" IS NULL OR "deletion_next_attempt_at" <= ${now})
          ORDER BY "deletion_scheduled_at" ASC, "id" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE "users" AS u
        SET "deletion_attempt_count" = u."deletion_attempt_count" + 1,
            "deletion_next_attempt_at" = ${leaseUntil},
            "deletion_last_error" = NULL,
            "updated_at" = ${now}
        FROM due
        WHERE u."id" = due."id"
        RETURNING
          u."id",
          u."deletion_attempt_count" AS "deletionAttemptCount",
          u."deletion_next_attempt_at" AS "deletionNextAttemptAt"`,
    ),
  );
  return claimed ?? null;
}

export async function finalizeDueAccountDeletions(
  now = new Date(),
): Promise<AccountDeletionBatchResult> {
  const result: AccountDeletionBatchResult = {
    claimed: 0,
    finalized: 0,
    failed: 0,
    skipped: 0,
  };
  while (result.claimed < ACCOUNT_DELETION_BATCH_SIZE) {
    const candidate = await claimNextDueAccountDeletion(now);
    if (!candidate) break;
    result.claimed += 1;
    try {
      const status = await finalizeClaimedAccount(candidate, now);
      result[status] += 1;
    } catch (error) {
      result.failed += 1;
      await recordFinalizationFailure(candidate, now, error);
    }
  }
  return result;
}

export async function collectDeletedAccountAvatar(url: string): Promise<Prisma.InputJsonObject> {
  await deleteAvatarFromUrl(url);
  return { status: "collected" };
}
