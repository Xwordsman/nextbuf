import "server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { getAuth, getInternalRegistrationHeader } from "@/infrastructure/auth/better-auth";
import { getPrismaClient } from "@/infrastructure/database/client";
import {
  acquireAdministratorContinuityLock,
  getAdministratorContinuityStatus,
} from "@/modules/admin/continuity.server";
import {
  INSTALLATION_COMPLETE_KEY,
  isInstallationComplete,
} from "@/modules/installation/status.server";
import { validateUsername } from "@/modules/profiles/username-policy";
import { getAuthEnvironment } from "@/shared/config/runtime-env";

const INSTALLATION_CLAIM_KEY = "installation.claim";
const INSTALLATION_LOCK = "nextbuf.installation";
const CLAIM_TIMEOUT_MS = 10 * 60 * 1_000;

export class InstallationError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "InstallationError";
  }
}

export type InstallationStatus = {
  complete: boolean;
  setupAvailable: boolean;
  administrators: number;
  users: number;
};

function tokenMatches(expected: string, actual: string): boolean {
  const expectedDigest = createHash("sha256").update(expected).digest();
  const actualDigest = createHash("sha256").update(actual).digest();
  return timingSafeEqual(expectedDigest, actualDigest);
}

type InstallationClaimValue = {
  version?: number;
  claimId?: string;
  email?: string;
  username?: string;
  claimedAt?: string;
  leaseExpiresAt?: string;
};

function claimValue(value: Prisma.JsonValue): InstallationClaimValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as InstallationClaimValue;
}

function claimIsStale(value: InstallationClaimValue, databaseNow: Date): boolean {
  const leaseExpiresAt = value.leaseExpiresAt
    ? new Date(value.leaseExpiresAt).getTime()
    : Number.NaN;
  if (value.version === 1) {
    return !Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= databaseNow.getTime();
  }

  const claimedAt = value.claimedAt ? new Date(value.claimedAt).getTime() : Number.NaN;
  return !Number.isFinite(claimedAt) || claimedAt + CLAIM_TIMEOUT_MS <= databaseNow.getTime();
}

async function acquireInstallationLock(transaction: Prisma.TransactionClient): Promise<void> {
  await transaction.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${INSTALLATION_LOCK}))`,
  );
}

type InitialAdministratorCandidate = {
  id: string;
  uid: number;
  username: string;
  email: string;
  eligible: boolean;
};

export async function assertInitialAdministratorCandidate(
  transaction: Prisma.TransactionClient,
  userId: string,
  now = new Date(),
): Promise<InitialAdministratorCandidate> {
  await acquireAdministratorContinuityLock(transaction);
  const rows = await transaction.$queryRaw<InitialAdministratorCandidate[]>(Prisma.sql`
    SELECT
      u."id",
      u."uid",
      u."username",
      u."email",
      (
        u."status" IN ('pending', 'active')
        AND u."deletion_requested_at" IS NULL
        AND u."deletion_scheduled_at" IS NULL
        AND u."deletion_finalized_at" IS NULL
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
        )
      ) AS "eligible"
    FROM "users" AS u
    WHERE u."id" = CAST(${userId} AS uuid)
    FOR UPDATE`);
  const candidate = rows[0];
  if (!candidate?.eligible) {
    throw new InstallationError("initial_administrator_not_eligible", 409);
  }
  return candidate;
}

export async function getInstallationStatus(): Promise<InstallationStatus> {
  const prisma = getPrismaClient();
  const [complete, administrators, users] = await Promise.all([
    isInstallationComplete(),
    prisma.communityRoleAssignment.count({ where: { role: "admin", scopeKey: "site" } }),
    prisma.user.count(),
  ]);
  return {
    complete,
    setupAvailable: !complete && Boolean(getAuthEnvironment().SETUP_TOKEN),
    administrators,
    users,
  };
}

export async function reconcileInstallationState(): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.$transaction(async (transaction) => {
    await acquireAdministratorContinuityLock(transaction);
    await acquireInstallationLock(transaction);
    const continuity = await getAdministratorContinuityStatus(transaction);
    if (continuity.eligibleAdministrators < 1) return;

    await transaction.systemState.upsert({
      where: { key: INSTALLATION_COMPLETE_KEY },
      create: {
        key: INSTALLATION_COMPLETE_KEY,
        value: {
          completedAt: new Date().toISOString(),
          source: "existing-administrator",
        },
      },
      update: {},
    });
    await transaction.systemState.deleteMany({ where: { key: INSTALLATION_CLAIM_KEY } });
  });
}

async function getDatabaseTime(transaction: Prisma.TransactionClient): Promise<Date> {
  const rows = await transaction.$queryRaw<Array<{ databaseNow: Date }>>(
    Prisma.sql`SELECT clock_timestamp() AS "databaseNow"`,
  );
  const databaseNow = rows[0]?.databaseNow;
  if (!databaseNow) throw new InstallationError("installation_clock_unavailable", 500);
  return databaseNow;
}

async function deleteOwnedClaim(
  transaction: Prisma.TransactionClient,
  claimId: string,
): Promise<number> {
  return transaction.$executeRaw(
    Prisma.sql`DELETE FROM "system_state"
      WHERE "key" = ${INSTALLATION_CLAIM_KEY}
        AND "value"->>'claimId' = ${claimId}`,
  );
}

async function releaseInstallationClaim(claimId: string): Promise<void> {
  await getPrismaClient().$transaction(async (transaction) => {
    await acquireInstallationLock(transaction);
    await deleteOwnedClaim(transaction, claimId);
  });
}

async function assertInstallationClaimOwnership(
  transaction: Prisma.TransactionClient,
  input: { claimId: string; email: string; username: string },
): Promise<void> {
  await acquireInstallationLock(transaction);
  const databaseNow = await getDatabaseTime(transaction);
  const currentClaim = await transaction.systemState.findUnique({
    where: { key: INSTALLATION_CLAIM_KEY },
  });
  const value = currentClaim ? claimValue(currentClaim.value) : {};
  if (
    value.version !== 1 ||
    value.claimId !== input.claimId ||
    value.email !== input.email ||
    value.username !== input.username ||
    claimIsStale(value, databaseNow)
  ) {
    throw new InstallationError("setup_claim_lost", 409);
  }
}

type AcquiredInstallationClaim = {
  claimId: string;
  existingUser: boolean;
};

type CompleteInitialAdministratorClaimInput = {
  claimId: string;
  email: string;
  username: string;
  password: string;
  requestId: string;
};

async function assertInitialAdministratorPassword(
  transaction: Prisma.TransactionClient,
  userId: string,
  password: string,
): Promise<void> {
  await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "auth_accounts"
    WHERE "user_id" = CAST(${userId} AS uuid)
      AND "provider_id" = 'credential'
    FOR UPDATE`);
  const accounts = await transaction.account.findMany({
    where: { userId },
    select: { providerId: true, password: true },
  });
  const credential = accounts.find((account) => account.providerId === "credential");
  if (!credential?.password) {
    throw new InstallationError("initial_administrator_not_eligible", 409);
  }

  const context = await getAuth().$context;
  const valid = await context.password.verify({
    password,
    hash: credential.password,
  });
  if (!valid) {
    throw new InstallationError("initial_administrator_password_mismatch", 409);
  }
}

async function acquireClaim(input: {
  email: string;
  username: string;
}): Promise<AcquiredInstallationClaim> {
  return getPrismaClient().$transaction(async (transaction) => {
    await acquireAdministratorContinuityLock(transaction);
    await acquireInstallationLock(transaction);
    const databaseNow = await getDatabaseTime(transaction);
    const [complete, administrators, users, claim] = await Promise.all([
      transaction.systemState.findUnique({ where: { key: INSTALLATION_COMPLETE_KEY } }),
      transaction.communityRoleAssignment.count({ where: { role: "admin", scopeKey: "site" } }),
      transaction.user.findMany({
        take: 2,
        orderBy: { createdAt: "asc" },
        select: { id: true, email: true, username: true },
      }),
      transaction.systemState.findUnique({ where: { key: INSTALLATION_CLAIM_KEY } }),
    ]);
    if (complete || administrators > 0) throw new InstallationError("already_complete", 409);
    if (
      users.length > 1 ||
      (users[0] && (users[0].email !== input.email || users[0].username !== input.username))
    ) {
      throw new InstallationError("existing_users_require_recovery", 409);
    }
    if (users[0]) {
      const candidate = await assertInitialAdministratorCandidate(transaction, users[0].id);
      if (candidate.email !== input.email || candidate.username !== input.username) {
        throw new InstallationError("existing_users_require_recovery", 409);
      }
    }

    if (claim) {
      const value = claimValue(claim.value);
      if (!claimIsStale(value, databaseNow)) {
        throw new InstallationError("setup_in_progress", 409);
      }
      if (value.email !== input.email || value.username !== input.username) {
        throw new InstallationError("existing_users_require_recovery", 409);
      }
    }

    const claimId = randomUUID();
    const claimedAt = databaseNow.toISOString();
    const leaseExpiresAt = new Date(databaseNow.getTime() + CLAIM_TIMEOUT_MS).toISOString();
    const value = {
      version: 1,
      claimId,
      ...input,
      claimedAt,
      leaseExpiresAt,
    } satisfies Prisma.InputJsonObject;
    await transaction.systemState.upsert({
      where: { key: INSTALLATION_CLAIM_KEY },
      create: {
        key: INSTALLATION_CLAIM_KEY,
        value,
      },
      update: { value },
    });
    return { claimId, existingUser: users.length === 1 };
  });
}

async function completeInitialAdministratorClaim(
  input: CompleteInitialAdministratorClaimInput,
): Promise<{ uid: number; username: string; email: string }> {
  return getPrismaClient().$transaction(async (transaction) => {
    await acquireAdministratorContinuityLock(transaction);
    await acquireInstallationLock(transaction);
    const complete = await transaction.systemState.findUnique({
      where: { key: INSTALLATION_COMPLETE_KEY },
    });
    if (complete) throw new InstallationError("already_complete", 409);
    await assertInstallationClaimOwnership(transaction, input);
    const user = await transaction.user.findUnique({ where: { email: input.email } });
    if (!user || user.username !== input.username) {
      throw new InstallationError("administrator_creation_failed", 500);
    }
    const administrators = await transaction.communityRoleAssignment.count({
      where: { role: "admin", scopeKey: "site" },
    });
    if (administrators > 0) throw new InstallationError("already_complete", 409);
    const candidate = await assertInitialAdministratorCandidate(transaction, user.id);
    if (candidate.email !== input.email || candidate.username !== input.username) {
      throw new InstallationError("administrator_creation_failed", 500);
    }
    await assertInitialAdministratorPassword(transaction, user.id, input.password);

    await transaction.communityRoleAssignment.create({
      data: {
        userId: user.id,
        role: "admin",
        scopeKey: "site",
        reason: "首次安装管理员",
      },
    });
    await transaction.governanceAuditEvent.create({
      data: {
        actorId: user.id,
        actorRoles: ["admin"],
        action: "installation.administrator.created",
        targetType: "user",
        targetKey: user.id,
        reason: "受保护的首次安装流程",
        beforeState: { administrator: false },
        afterState: { administrator: true, uid: user.uid, username: user.username },
        requestId: input.requestId,
      },
    });
    await transaction.systemState.upsert({
      where: { key: INSTALLATION_COMPLETE_KEY },
      create: {
        key: INSTALLATION_COMPLETE_KEY,
        value: {
          completedAt: new Date().toISOString(),
          administratorId: user.id,
          administratorUid: user.uid,
        },
      },
      update: {},
    });
    if ((await deleteOwnedClaim(transaction, input.claimId)) !== 1) {
      throw new InstallationError("setup_claim_lost", 409);
    }
    return { uid: candidate.uid, username: candidate.username, email: candidate.email };
  });
}

export async function createInitialAdministrator(input: {
  token: string;
  name: string;
  username: string;
  email: string;
  password: string;
  requestId: string;
}): Promise<{ uid: number; username: string; email: string }> {
  if (await isInstallationComplete()) throw new InstallationError("already_complete", 409);
  const environment = getAuthEnvironment();
  if (!environment.SETUP_TOKEN) throw new InstallationError("setup_disabled", 503);
  if (!tokenMatches(environment.SETUP_TOKEN, input.token)) {
    throw new InstallationError("invalid_setup_token", 403);
  }
  const username = validateUsername(input.username);
  if (!username.ok) throw new InstallationError(username.code, 400);
  const email = input.email.trim().toLowerCase();
  const claim = await acquireClaim({ email, username: username.username });

  try {
    if (!claim.existingUser) {
      await getAuth().api.signUpEmail({
        body: {
          name: input.name.trim(),
          username: username.username,
          email,
          password: input.password,
          callbackURL: "/auth/verified",
        },
        headers: new Headers({
          origin: environment.APP_URL,
          "x-nextbuf-registration": getInternalRegistrationHeader(),
        }),
      });
    } else {
      await getAuth().api.sendVerificationEmail({
        body: { email, callbackURL: "/auth/verified" },
        headers: new Headers({ origin: environment.APP_URL }),
      });
    }

    return await completeInitialAdministratorClaim({
      claimId: claim.claimId,
      email,
      username: username.username,
      password: input.password,
      requestId: input.requestId,
    });
  } catch (error) {
    await releaseInstallationClaim(claim.claimId);
    throw error;
  }
}
