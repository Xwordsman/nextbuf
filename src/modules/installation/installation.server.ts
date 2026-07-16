import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { getAuth, getInternalRegistrationHeader } from "@/infrastructure/auth/better-auth";
import { getPrismaClient } from "@/infrastructure/database/client";
import { validateUsername } from "@/modules/profiles/username-policy";
import { getAuthEnvironment } from "@/shared/config/runtime-env";

const INSTALLATION_COMPLETE_KEY = "installation.completed";
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

function claimValue(value: Prisma.JsonValue): {
  email?: string;
  username?: string;
  claimedAt?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as { email?: string; username?: string; claimedAt?: string };
}

export async function isInstallationComplete(): Promise<boolean> {
  return Boolean(
    await getPrismaClient().systemState.findUnique({
      where: { key: INSTALLATION_COMPLETE_KEY },
      select: { key: true },
    }),
  );
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
    await transaction.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${INSTALLATION_LOCK}))`,
    );
    const administrators = await transaction.communityRoleAssignment.count({
      where: { role: "admin", scopeKey: "site" },
    });
    if (administrators < 1) return;

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

async function acquireClaim(input: { email: string; username: string }): Promise<boolean> {
  return getPrismaClient().$transaction(async (transaction) => {
    await transaction.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${INSTALLATION_LOCK}))`,
    );
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

    if (claim) {
      const value = claimValue(claim.value);
      const claimedAt = value.claimedAt ? new Date(value.claimedAt).getTime() : Number.NaN;
      const stale = !Number.isFinite(claimedAt) || Date.now() - claimedAt >= CLAIM_TIMEOUT_MS;
      if (!stale) throw new InstallationError("setup_in_progress", 409);
      if (value.email !== input.email || value.username !== input.username) {
        throw new InstallationError("existing_users_require_recovery", 409);
      }
    }

    await transaction.systemState.upsert({
      where: { key: INSTALLATION_CLAIM_KEY },
      create: {
        key: INSTALLATION_CLAIM_KEY,
        value: { ...input, claimedAt: new Date().toISOString() },
      },
      update: { value: { ...input, claimedAt: new Date().toISOString() } },
    });
    return users.length === 1;
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
  const existingUser = await acquireClaim({ email, username: username.username });

  try {
    if (!existingUser) {
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
    }

    return await getPrismaClient().$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${INSTALLATION_LOCK}))`,
      );
      const user = await transaction.user.findUnique({ where: { email } });
      if (!user || user.username !== username.username) {
        throw new InstallationError("administrator_creation_failed", 500);
      }
      const administrators = await transaction.communityRoleAssignment.count({
        where: { role: "admin", scopeKey: "site" },
      });
      if (administrators > 0) throw new InstallationError("already_complete", 409);

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
      await transaction.systemState.deleteMany({ where: { key: INSTALLATION_CLAIM_KEY } });
      return { uid: user.uid, username: user.username, email: user.email };
    });
  } catch (error) {
    if (!(error instanceof InstallationError && error.code === "already_complete")) {
      await getPrismaClient().systemState.deleteMany({
        where: { key: INSTALLATION_CLAIM_KEY },
      });
    }
    throw error;
  }
}
