import "server-only";

import { Prisma } from "@/generated/prisma/client";
import {
  evaluateAdministratorContinuity,
  type AdministratorContinuityStatus,
} from "@/modules/admin/continuity-policy";

// Two fixed signed 32-bit keys keep every continuity-changing transaction on one lock.
const ADMINISTRATOR_CONTINUITY_LOCK_NAMESPACE = 1_314_283_853;
const ADMINISTRATOR_CONTINUITY_LOCK_RESOURCE = 1;

type ContinuityQueryClient = Pick<Prisma.TransactionClient, "$queryRaw">;

type CountRow = { count: number };
type RemovalImpactRow = {
  eligibleAdministrators: number;
  remainingEligibleAdministrators: number;
};
type EligibilityRow = { eligible: boolean };

export type AdministratorContinuityRemovalImpact = {
  targetEligible: boolean;
  eligibleAdministrators: number;
  remainingEligibleAdministrators: number;
  allowed: boolean;
};

export class AdministratorContinuityError extends Error {
  readonly status = 409;

  constructor(
    readonly code: "last_admin" | "administrator_handover_required" | "administrator_not_eligible",
  ) {
    super(code);
    this.name = "AdministratorContinuityError";
  }
}

function administratorCandidatesSql(now: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT DISTINCT u."id"
    FROM "users" AS u
    WHERE u."status" = 'active'
      AND u."email_verified" = TRUE
      AND u."deletion_requested_at" IS NULL
      AND u."deletion_scheduled_at" IS NULL
      AND EXISTS (
        SELECT 1
        FROM "auth_accounts" AS account
        WHERE account."user_id" = u."id"
          AND account."provider_id" = 'credential'
          AND account."password" IS NOT NULL
          AND account."password" <> ''
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "moderation_sanctions" AS sanction
        WHERE sanction."user_id" = u."id"
          AND sanction."type" IN ('suspend', 'ban')
          AND sanction."revoked_at" IS NULL
          AND sanction."starts_at" <= ${now}
          AND (sanction."ends_at" IS NULL OR sanction."ends_at" > ${now})
      )`;
}

function eligibleAdministratorsSql(now: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT candidate."id"
    FROM (${administratorCandidatesSql(now)}) AS candidate
    WHERE EXISTS (
      SELECT 1
      FROM "community_role_assignments" AS role
      WHERE role."user_id" = candidate."id"
        AND role."role" = 'admin'
        AND role."scope_key" = 'site'
    )`;
}

export async function acquireAdministratorContinuityLock(
  transaction: Prisma.TransactionClient,
): Promise<void> {
  await transaction.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(
      CAST(${ADMINISTRATOR_CONTINUITY_LOCK_NAMESPACE} AS integer),
      CAST(${ADMINISTRATOR_CONTINUITY_LOCK_RESOURCE} AS integer)
    )`,
  );
}

export async function getAdministratorContinuityStatus(
  database: ContinuityQueryClient,
  now = new Date(),
): Promise<AdministratorContinuityStatus> {
  const rows = await database.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT COUNT(*)::integer AS "count"
    FROM (${eligibleAdministratorsSql(now)}) AS eligible`);
  return evaluateAdministratorContinuity(rows[0]?.count ?? 0);
}

export async function getAdministratorContinuityRemovalImpact(
  transaction: Prisma.TransactionClient,
  targetUserId: string,
  now = new Date(),
): Promise<AdministratorContinuityRemovalImpact> {
  await acquireAdministratorContinuityLock(transaction);
  const rows = await transaction.$queryRaw<RemovalImpactRow[]>(Prisma.sql`
    SELECT
      COUNT(*)::integer AS "eligibleAdministrators",
      COUNT(*) FILTER (
        WHERE eligible."id" <> CAST(${targetUserId} AS uuid)
      )::integer AS "remainingEligibleAdministrators"
    FROM (${eligibleAdministratorsSql(now)}) AS eligible`);
  const eligibleAdministrators = rows[0]?.eligibleAdministrators ?? 0;
  const remainingEligibleAdministrators = rows[0]?.remainingEligibleAdministrators ?? 0;
  const targetEligible = remainingEligibleAdministrators < eligibleAdministrators;
  return {
    targetEligible,
    eligibleAdministrators,
    remainingEligibleAdministrators,
    allowed: !targetEligible || remainingEligibleAdministrators > 0,
  };
}

export async function assertAdministratorContinuityAfterExcludingUser(
  transaction: Prisma.TransactionClient,
  targetUserId: string,
  now = new Date(),
): Promise<void> {
  const impact = await getAdministratorContinuityRemovalImpact(transaction, targetUserId, now);
  if (!impact.allowed) throw new AdministratorContinuityError("last_admin");
}

export async function assertAdministratorContinuityAfterRoleRevocation(
  transaction: Prisma.TransactionClient,
  targetUserId: string,
  now = new Date(),
): Promise<void> {
  const impact = await getAdministratorContinuityRemovalImpact(transaction, targetUserId, now);
  if (impact.remainingEligibleAdministrators < 1) {
    throw new AdministratorContinuityError("last_admin");
  }
}

export async function assertAdministratorHandoverComplete(
  transaction: Prisma.TransactionClient,
  targetUserId: string,
): Promise<void> {
  await acquireAdministratorContinuityLock(transaction);
  const assignment = await transaction.communityRoleAssignment.findFirst({
    where: { userId: targetUserId, role: "admin", scopeKey: "site" },
    select: { id: true },
  });
  if (assignment) {
    throw new AdministratorContinuityError("administrator_handover_required");
  }
}

export async function assertUserEligibleForAdministratorRole(
  transaction: Prisma.TransactionClient,
  targetUserId: string,
  now = new Date(),
): Promise<void> {
  await acquireAdministratorContinuityLock(transaction);
  const rows = await transaction.$queryRaw<EligibilityRow[]>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1
      FROM (${administratorCandidatesSql(now)}) AS candidate
      WHERE candidate."id" = CAST(${targetUserId} AS uuid)
    ) AS "eligible"`);
  if (!rows[0]?.eligible) {
    throw new AdministratorContinuityError("administrator_not_eligible");
  }
}
