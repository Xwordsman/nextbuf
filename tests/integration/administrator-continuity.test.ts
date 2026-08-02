import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setup } from "@/cli/commands/setup";
import { Prisma } from "@/generated/prisma/client";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { disconnectPrismaClient, getPrismaClient } from "@/infrastructure/database/client";
import {
  assertInitialAdministratorCandidate,
  createInitialAdministrator,
  reconcileInstallationState,
} from "@/modules/installation/installation.server";
import { INSTALLATION_COMPLETE_KEY } from "@/modules/installation/status.server";
import {
  acquireAdministratorContinuityLock,
  assertAdministratorHandoverComplete,
  getAdministratorContinuityStatus,
} from "@/modules/admin/continuity.server";
import { getAdminDashboard } from "@/modules/admin/dashboard.server";
import {
  applyModerationAction,
  restoreExpiredSuspensions,
} from "@/modules/moderation/actions.server";
import { grantCommunityRole, revokeCommunityRole } from "@/modules/moderation/governance.server";
import { createModerationReport } from "@/modules/moderation/reports.server";
import { getAuthEnvironment } from "@/shared/config/runtime-env";

const emailPrefix = "administrator-continuity+";
const emailDomain = "@nextbuf.test";

async function cleanup(): Promise<void> {
  const prisma = getPrismaClient();
  const deliveries = await prisma.emailDelivery.findMany({
    where: { recipient: { startsWith: emailPrefix, endsWith: emailDomain } },
    select: { id: true },
  });
  const deliveryIds = deliveries.map(({ id }) => id);
  if (deliveryIds.length > 0) {
    await prisma.outboxEvent.deleteMany({
      where: {
        idempotencyKey: { in: deliveryIds.map((id) => `identity-email:${id}`) },
      },
    });
    await prisma.emailDelivery.deleteMany({ where: { id: { in: deliveryIds } } });
  }
  const users = await prisma.user.findMany({
    where: { email: { startsWith: emailPrefix, endsWith: emailDomain } },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);
  if (userIds.length === 0) return;
  const cases = await prisma.moderationCase.findMany({
    where: {
      OR: [
        { createdById: { in: userIds } },
        { reportedUserId: { in: userIds } },
        { reports: { some: { reporterId: { in: userIds } } } },
      ],
    },
    select: { id: true },
  });
  const caseIds = cases.map(({ id }) => id);
  await prisma.moderationSanction.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.moderationAction.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.moderationReport.deleteMany({ where: { caseId: { in: caseIds } } });
  await prisma.moderationCase.deleteMany({ where: { id: { in: caseIds } } });
  await prisma.governanceAuditEvent.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.communityRoleAssignment.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { grantedById: { in: userIds } }] },
  });
  await prisma.identityAuditEvent.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function createUser(
  label: string,
  credential = true,
  password = "integration-password-hash",
) {
  const prisma = getPrismaClient();
  const suffix = label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  const email = `${emailPrefix}${suffix}${emailDomain}`;
  const user = await prisma.user.create({
    data: {
      name: `Continuity ${label}`,
      username: `continuity_${suffix}`.slice(0, 24),
      email,
      emailVerified: true,
      status: "active",
      activatedAt: new Date(),
    },
  });
  if (credential) {
    await prisma.account.create({
      data: {
        userId: user.id,
        providerId: "credential",
        accountId: email,
        password,
      },
    });
  }
  return user;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function grantAdmin(userId: string) {
  return getPrismaClient().communityRoleAssignment.create({
    data: { userId, role: "admin", scopeKey: "site", reason: "continuity integration" },
  });
}

describe("administrator continuity integration", () => {
  beforeAll(async () => {
    await setup();
  });

  beforeEach(cleanup);
  afterEach(cleanup);

  afterAll(async () => {
    await disconnectPrismaClient();
  });

  it("counts only administrators that can take over and requires role handover before deletion", async () => {
    const prisma = getPrismaClient();
    const [first, second] = await Promise.all([createUser("first"), createUser("second")]);
    const firstRole = await grantAdmin(first.id);
    await grantAdmin(second.id);

    await expect(getAdministratorContinuityStatus(prisma)).resolves.toMatchObject({
      eligibleAdministrators: 2,
      state: "healthy",
    });
    await prisma.user.update({
      where: { id: second.id },
      data: { deletionRequestedAt: new Date(), deletionScheduledAt: new Date(Date.now() + 60_000) },
    });
    await expect(getAdministratorContinuityStatus(prisma)).resolves.toMatchObject({
      eligibleAdministrators: 1,
      state: "redundancy_warning",
    });
    await prisma.user.update({
      where: { id: second.id },
      data: { deletionRequestedAt: null, deletionScheduledAt: null },
    });

    await expect(
      prisma.$transaction((transaction) =>
        assertAdministratorHandoverComplete(transaction, first.id),
      ),
    ).rejects.toMatchObject({ code: "administrator_handover_required", status: 409 });
    await prisma.communityRoleAssignment.delete({ where: { id: firstRole.id } });
    await expect(
      prisma.$transaction((transaction) =>
        assertAdministratorHandoverComplete(transaction, first.id),
      ),
    ).resolves.toBeUndefined();
  });

  it("serializes concurrent administrator revocations and preserves one eligible administrator", async () => {
    const [first, second] = await Promise.all([
      createUser("revoke_first"),
      createUser("revoke_second"),
    ]);
    const [firstRole, secondRole] = await Promise.all([
      grantAdmin(first.id),
      grantAdmin(second.id),
    ]);

    const results = await Promise.allSettled([
      revokeCommunityRole({
        actorId: second.id,
        assignmentId: firstRole.id,
        reason: "concurrent continuity test",
        requestId: "continuity-revoke-first",
      }),
      revokeCommunityRole({
        actorId: first.id,
        assignmentId: secondRole.id,
        reason: "concurrent continuity test",
        requestId: "continuity-revoke-second",
      }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    await expect(getAdministratorContinuityStatus(getPrismaClient())).resolves.toMatchObject({
      eligibleAdministrators: 1,
      state: "redundancy_warning",
    });
  });

  it("keeps an administrator role available while continuity is already broken", async () => {
    const [actor, target] = await Promise.all([
      createUser("broken_actor", false),
      createUser("broken_target", false),
    ]);
    await grantAdmin(actor.id);
    const targetRole = await grantAdmin(target.id);

    await expect(
      revokeCommunityRole({
        actorId: actor.id,
        assignmentId: targetRole.id,
        reason: "preserve recovery access",
        requestId: "continuity-broken-revoke",
      }),
    ).rejects.toMatchObject({ code: "last_admin", status: 409 });
  });

  it("rejects administrator grants to accounts that cannot take over the site", async () => {
    const prisma = getPrismaClient();
    const [actor, target] = await Promise.all([
      createUser("grant_actor"),
      createUser("grant_target", false),
    ]);
    await grantAdmin(actor.id);
    const grantInput = {
      actorId: actor.id,
      targetUserId: target.id,
      role: "admin" as const,
      reason: "continuity eligibility integration",
      requestId: "continuity-admin-grant",
    };

    await expect(grantCommunityRole(grantInput)).rejects.toMatchObject({
      code: "administrator_not_eligible",
      status: 409,
    });
    await prisma.account.create({
      data: {
        userId: target.id,
        providerId: "credential",
        accountId: target.email,
        password: "",
      },
    });
    await expect(grantCommunityRole(grantInput)).rejects.toMatchObject({
      code: "administrator_not_eligible",
      status: 409,
    });
    await expect(getAdministratorContinuityStatus(prisma)).resolves.toMatchObject({
      eligibleAdministrators: 1,
      state: "redundancy_warning",
    });
    await prisma.account.updateMany({
      where: { userId: target.id, providerId: "credential" },
      data: { password: "integration-password-hash" },
    });
    await prisma.user.update({
      where: { id: target.id },
      data: { deletionRequestedAt: new Date(), deletionScheduledAt: new Date(Date.now() + 60_000) },
    });
    await expect(grantCommunityRole(grantInput)).rejects.toMatchObject({
      code: "administrator_not_eligible",
      status: 409,
    });
    await prisma.user.update({
      where: { id: target.id },
      data: { deletionRequestedAt: null, deletionScheduledAt: null },
    });
    await expect(grantCommunityRole(grantInput)).resolves.toMatchObject({
      userId: target.id,
      role: "admin",
      scopeKey: "site",
    });
  });

  it("requires a usable password credential before granting the initial administrator", async () => {
    const prisma = getPrismaClient();
    const candidate = await createUser("initial_candidate", false);

    await expect(
      prisma.$transaction((transaction) =>
        assertInitialAdministratorCandidate(transaction, candidate.id),
      ),
    ).rejects.toMatchObject({ code: "initial_administrator_not_eligible", status: 409 });

    await prisma.account.create({
      data: {
        userId: candidate.id,
        providerId: "credential",
        accountId: candidate.email,
        password: "integration-password-hash",
      },
    });
    await expect(
      prisma.$transaction((transaction) =>
        assertInitialAdministratorCandidate(transaction, candidate.id),
      ),
    ).resolves.toMatchObject({ id: candidate.id, eligible: true });

    await prisma.user.update({
      where: { id: candidate.id },
      data: {
        deletionRequestedAt: new Date(),
        deletionScheduledAt: new Date(Date.now() + 60_000),
      },
    });
    await expect(
      prisma.$transaction((transaction) =>
        assertInitialAdministratorCandidate(transaction, candidate.id),
      ),
    ).rejects.toMatchObject({ code: "initial_administrator_not_eligible", status: 409 });
  });

  it("backfills installation completion only for an administrator that can take over", async () => {
    const prisma = getPrismaClient();
    const previousState = await prisma.systemState.findUnique({
      where: { key: INSTALLATION_COMPLETE_KEY },
    });
    await prisma.systemState.deleteMany({ where: { key: INSTALLATION_COMPLETE_KEY } });

    try {
      const candidate = await createUser("installation_reconcile", false);
      await grantAdmin(candidate.id);

      await reconcileInstallationState();
      await expect(
        prisma.systemState.findUnique({ where: { key: INSTALLATION_COMPLETE_KEY } }),
      ).resolves.toBeNull();

      await prisma.account.create({
        data: {
          userId: candidate.id,
          providerId: "credential",
          accountId: candidate.email,
          password: "integration-password-hash",
        },
      });
      await reconcileInstallationState();
      await expect(
        prisma.systemState.findUnique({ where: { key: INSTALLATION_COMPLETE_KEY } }),
      ).resolves.toMatchObject({
        value: expect.objectContaining({ source: "existing-administrator" }),
      });
    } finally {
      await prisma.systemState.deleteMany({ where: { key: INSTALLATION_COMPLETE_KEY } });
      if (previousState) {
        await prisma.systemState.create({
          data: {
            ...previousState,
            value: previousState.value === null ? Prisma.JsonNull : previousState.value,
          },
        });
      }
    }
  });

  it("fences a delayed setup request after its PostgreSQL lease is taken over", async () => {
    const prisma = getPrismaClient();
    const claimKey = "installation.claim";
    const candidate = await createUser("claim_race");
    await prisma.user.update({
      where: { id: candidate.id },
      data: { emailVerified: false, status: "pending", activatedAt: null },
    });
    const [previousClaim, previousComplete] = await Promise.all([
      prisma.systemState.findUnique({ where: { key: claimKey } }),
      prisma.systemState.findUnique({ where: { key: INSTALLATION_COMPLETE_KEY } }),
    ]);
    await prisma.systemState.deleteMany({
      where: { key: { in: [claimKey, INSTALLATION_COMPLETE_KEY] } },
    });
    const setupToken = getAuthEnvironment().SETUP_TOKEN;
    if (!setupToken) throw new Error("SETUP_TOKEN is required for the setup race integration test");
    const firstAuthStarted = deferred();
    const secondAuthStarted = deferred();
    const releaseFirstAuth = deferred();
    const releaseSecondAuth = deferred();
    let authCalls = 0;
    let firstRequest: ReturnType<typeof createInitialAdministrator> | undefined;
    let secondRequest: ReturnType<typeof createInitialAdministrator> | undefined;
    const verificationSpy = vi
      .spyOn(getAuth().api, "sendVerificationEmail")
      .mockImplementation(async () => {
        authCalls += 1;
        if (authCalls === 1) {
          firstAuthStarted.resolve();
          await releaseFirstAuth.promise;
        } else if (authCalls === 2) {
          secondAuthStarted.resolve();
          await releaseSecondAuth.promise;
        } else {
          throw new Error(`Unexpected verification call ${authCalls}`);
        }
        return { status: true };
      });
    const setupInput = {
      token: setupToken,
      name: candidate.name,
      username: candidate.username,
      email: candidate.email,
      password: "claim-race-password-12345",
    };

    try {
      await expect(
        prisma.communityRoleAssignment.count({ where: { role: "admin", scopeKey: "site" } }),
      ).resolves.toBe(0);
      firstRequest = createInitialAdministrator({
        ...setupInput,
        requestId: "claim-race-old-owner",
      });
      await firstAuthStarted.promise;

      const firstClaim = await prisma.systemState.findUniqueOrThrow({ where: { key: claimKey } });
      const firstClaimValue = firstClaim.value as {
        claimId?: string;
        claimedAt?: string;
        leaseExpiresAt?: string;
      };
      expect(firstClaimValue.claimId).toEqual(expect.any(String));
      expect(firstClaimValue.claimedAt).toEqual(expect.any(String));
      expect(firstClaimValue.leaseExpiresAt).toEqual(expect.any(String));
      const firstClaimId = firstClaimValue.claimId!;
      const expiredRows = await prisma.$executeRaw(Prisma.sql`
        UPDATE "system_state"
        SET "value" = jsonb_set(
          "value",
          '{leaseExpiresAt}',
          to_jsonb((clock_timestamp() - INTERVAL '1 second')::text)
        )
        WHERE "key" = ${claimKey}
          AND "value"->>'claimId' = ${firstClaimId}`);
      expect(expiredRows).toBe(1);

      secondRequest = createInitialAdministrator({
        ...setupInput,
        requestId: "claim-race-current-owner",
      });
      await secondAuthStarted.promise;
      const secondClaim = await prisma.systemState.findUniqueOrThrow({ where: { key: claimKey } });
      expect(secondClaim.value).toMatchObject({
        version: 1,
        email: candidate.email,
        username: candidate.username,
      });
      const secondClaimId = (secondClaim.value as { claimId?: string }).claimId;
      expect(secondClaimId).toEqual(expect.any(String));
      expect(secondClaimId).not.toBe(firstClaimId);

      const firstRejection = expect(firstRequest).rejects.toMatchObject({
        code: "setup_claim_lost",
        status: 409,
      });
      releaseFirstAuth.resolve();
      await firstRejection;
      await expect(
        prisma.communityRoleAssignment.count({
          where: { userId: candidate.id, role: "admin", scopeKey: "site" },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.governanceAuditEvent.count({
          where: { actorId: candidate.id, action: "installation.administrator.created" },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.systemState.findUnique({ where: { key: INSTALLATION_COMPLETE_KEY } }),
      ).resolves.toBeNull();
      await expect(
        prisma.systemState.findUniqueOrThrow({ where: { key: claimKey } }),
      ).resolves.toMatchObject({
        value: expect.objectContaining({ claimId: secondClaimId }),
      });

      releaseSecondAuth.resolve();
      await expect(secondRequest).resolves.toMatchObject({
        uid: candidate.uid,
        username: candidate.username,
        email: candidate.email,
      });
      await expect(
        prisma.communityRoleAssignment.count({
          where: { userId: candidate.id, role: "admin", scopeKey: "site" },
        }),
      ).resolves.toBe(1);
      await expect(
        prisma.governanceAuditEvent.findMany({
          where: { actorId: candidate.id, action: "installation.administrator.created" },
          select: { requestId: true },
        }),
      ).resolves.toEqual([{ requestId: "claim-race-current-owner" }]);
      await expect(
        prisma.systemState.findUniqueOrThrow({ where: { key: INSTALLATION_COMPLETE_KEY } }),
      ).resolves.toMatchObject({
        value: expect.objectContaining({ administratorId: candidate.id }),
      });
      await expect(prisma.systemState.findUnique({ where: { key: claimKey } })).resolves.toBeNull();
      expect(verificationSpy).toHaveBeenCalledTimes(2);
    } finally {
      releaseFirstAuth.resolve();
      releaseSecondAuth.resolve();
      await Promise.allSettled(
        [firstRequest, secondRequest].filter(
          (request): request is ReturnType<typeof createInitialAdministrator> => Boolean(request),
        ),
      );
      verificationSpy.mockRestore();
      await prisma.systemState.deleteMany({
        where: { key: { in: [claimKey, INSTALLATION_COMPLETE_KEY] } },
      });
      for (const state of [previousClaim, previousComplete]) {
        if (state) {
          await prisma.systemState.create({
            data: {
              ...state,
              value: state.value === null ? Prisma.JsonNull : state.value,
            },
          });
        }
      }
    }
  });

  it("rejects a taken-over setup when the delayed request created a different password", async () => {
    const prisma = getPrismaClient();
    const claimKey = "installation.claim";
    const email = `${emailPrefix}claim_password_race${emailDomain}`;
    const username = "continuity_claim_password";
    const [previousClaim, previousComplete] = await Promise.all([
      prisma.systemState.findUnique({ where: { key: claimKey } }),
      prisma.systemState.findUnique({ where: { key: INSTALLATION_COMPLETE_KEY } }),
    ]);
    await prisma.systemState.deleteMany({
      where: { key: { in: [claimKey, INSTALLATION_COMPLETE_KEY] } },
    });
    const setupToken = getAuthEnvironment().SETUP_TOKEN;
    if (!setupToken) throw new Error("SETUP_TOKEN is required for the setup race integration test");
    const firstAuthStarted = deferred();
    const secondAuthStarted = deferred();
    const releaseFirstAuth = deferred();
    const releaseSecondAuth = deferred();
    const auth = getAuth();
    const originalSignUpEmail = auth.api.signUpEmail.bind(auth.api);
    const signInSpy = vi.spyOn(auth.api, "signInEmail");
    let authCalls = 0;
    let firstRequest: ReturnType<typeof createInitialAdministrator> | undefined;
    let secondRequest: ReturnType<typeof createInitialAdministrator> | undefined;
    const signUpSpy = vi.spyOn(auth.api, "signUpEmail").mockImplementation(async (options) => {
      authCalls += 1;
      if (authCalls === 1) {
        firstAuthStarted.resolve();
        await releaseFirstAuth.promise;
      } else if (authCalls === 2) {
        secondAuthStarted.resolve();
        await releaseSecondAuth.promise;
      } else {
        throw new Error(`Unexpected sign-up call ${authCalls}`);
      }
      return originalSignUpEmail(options);
    });
    const oldPassword = "old-setup-password-12345";
    const newPassword = "new-setup-password-67890";
    const setupInput = {
      token: setupToken,
      name: "Continuity Claim Password",
      username,
      email,
    };

    try {
      firstRequest = createInitialAdministrator({
        ...setupInput,
        password: oldPassword,
        requestId: "claim-password-old-owner",
      });
      await firstAuthStarted.promise;

      const firstClaim = await prisma.systemState.findUniqueOrThrow({ where: { key: claimKey } });
      const firstClaimId = (firstClaim.value as { claimId?: string }).claimId;
      expect(firstClaimId).toEqual(expect.any(String));
      const expiredRows = await prisma.$executeRaw(Prisma.sql`
        UPDATE "system_state"
        SET "value" = jsonb_set(
          "value",
          '{leaseExpiresAt}',
          to_jsonb((clock_timestamp() - INTERVAL '1 second')::text)
        )
        WHERE "key" = ${claimKey}
          AND "value"->>'claimId' = ${firstClaimId!}`);
      expect(expiredRows).toBe(1);

      secondRequest = createInitialAdministrator({
        ...setupInput,
        password: newPassword,
        requestId: "claim-password-current-owner",
      });
      await secondAuthStarted.promise;
      await expect(prisma.user.count({ where: { email } })).resolves.toBe(0);
      const secondClaim = await prisma.systemState.findUniqueOrThrow({ where: { key: claimKey } });
      const secondClaimId = (secondClaim.value as { claimId?: string }).claimId;
      expect(secondClaimId).toEqual(expect.any(String));
      expect(secondClaimId).not.toBe(firstClaimId);

      const firstRejection = expect(firstRequest).rejects.toMatchObject({
        code: "setup_claim_lost",
        status: 409,
      });
      releaseFirstAuth.resolve();
      await firstRejection;

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      await expect(
        prisma.communityRoleAssignment.count({
          where: { userId: user.id, role: "admin", scopeKey: "site" },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.systemState.findUniqueOrThrow({ where: { key: claimKey } }),
      ).resolves.toMatchObject({
        value: expect.objectContaining({ claimId: secondClaimId }),
      });

      releaseSecondAuth.resolve();
      await expect(secondRequest).rejects.toMatchObject({
        code: "initial_administrator_password_mismatch",
        status: 409,
      });

      const credential = await prisma.account.findFirstOrThrow({
        where: { userId: user.id, providerId: "credential" },
        select: { password: true },
      });
      expect(credential.password).toEqual(expect.any(String));
      const context = await auth.$context;
      await expect(
        context.password.verify({ password: oldPassword, hash: credential.password! }),
      ).resolves.toBe(true);
      await expect(
        context.password.verify({ password: newPassword, hash: credential.password! }),
      ).resolves.toBe(false);
      await expect(
        prisma.communityRoleAssignment.count({ where: { role: "admin", scopeKey: "site" } }),
      ).resolves.toBe(0);
      await expect(
        prisma.systemState.findUnique({ where: { key: INSTALLATION_COMPLETE_KEY } }),
      ).resolves.toBeNull();
      await expect(prisma.systemState.findUnique({ where: { key: claimKey } })).resolves.toBeNull();
      await expect(prisma.session.count({ where: { userId: user.id } })).resolves.toBe(0);
      await expect(
        prisma.identityAuditEvent.count({
          where: { userId: user.id, eventType: "identity.session.created" },
        }),
      ).resolves.toBe(0);
      expect(signInSpy).not.toHaveBeenCalled();
      expect(signUpSpy).toHaveBeenCalledTimes(2);
    } finally {
      releaseFirstAuth.resolve();
      releaseSecondAuth.resolve();
      await Promise.allSettled(
        [firstRequest, secondRequest].filter(
          (request): request is ReturnType<typeof createInitialAdministrator> => Boolean(request),
        ),
      );
      signUpSpy.mockRestore();
      signInSpy.mockRestore();
      await prisma.systemState.deleteMany({
        where: { key: { in: [claimKey, INSTALLATION_COMPLETE_KEY] } },
      });
      for (const state of [previousClaim, previousComplete]) {
        if (state) {
          await prisma.systemState.create({
            data: {
              ...state,
              value: state.value === null ? Prisma.JsonNull : state.value,
            },
          });
        }
      }
    }
  });

  it("waits for a deletion transition and rejects every new role for that account", async () => {
    const prisma = getPrismaClient();
    const [actor, target] = await Promise.all([
      createUser("grant_deletion_actor"),
      createUser("grant_deletion_target"),
    ]);
    await grantAdmin(actor.id);
    const lockAcquired = deferred();
    const releaseDeletion = deferred();
    const deletionTransition = prisma.$transaction(async (transaction) => {
      await acquireAdministratorContinuityLock(transaction);
      lockAcquired.resolve();
      await releaseDeletion.promise;
      const now = new Date();
      await transaction.user.update({
        where: { id: target.id },
        data: {
          deletionRequestedAt: now,
          deletionScheduledAt: new Date(now.getTime() + 60_000),
        },
      });
    });
    await lockAcquired.promise;

    let grantSettled = false;
    const grantAttempt = grantCommunityRole({
      actorId: actor.id,
      targetUserId: target.id,
      role: "global_moderator",
      reason: "deletion serialization integration",
      requestId: "continuity-grant-during-deletion",
    })
      .then(
        (value) => ({ status: "fulfilled" as const, value }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      )
      .finally(() => {
        grantSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(grantSettled).toBe(false);

    releaseDeletion.resolve();
    await deletionTransition;
    await expect(grantAttempt).resolves.toMatchObject({
      status: "rejected",
      error: { code: "invalid_action", status: 409 },
    });
    await expect(
      prisma.communityRoleAssignment.count({ where: { userId: target.id } }),
    ).resolves.toBe(0);
  });

  it("blocks suspension of the last eligible administrator and allows it after handover", async () => {
    const prisma = getPrismaClient();
    const [target, actingAdmin, reporter] = await Promise.all([
      createUser("sanction_target"),
      createUser("sanction_actor", false),
      createUser("sanction_reporter", false),
    ]);
    await Promise.all([grantAdmin(target.id), grantAdmin(actingAdmin.id)]);
    const report = await createModerationReport({
      reporterId: reporter.id,
      target: { type: "user", username: target.username },
      reason: "abuse",
      details: "Verify continuity protection for account sanctions.",
    });
    const actionInput = {
      actorId: actingAdmin.id,
      caseNumber: report.caseNumber,
      action: "suspend" as const,
      reason: "continuity integration suspension",
      endsAt: new Date(Date.now() + 86_400_000),
      requestId: "continuity-suspend",
    };

    await expect(applyModerationAction(actionInput)).rejects.toMatchObject({
      code: "last_admin",
      status: 409,
    });
    await expect(prisma.moderationSanction.count({ where: { userId: target.id } })).resolves.toBe(
      0,
    );

    await prisma.account.create({
      data: {
        userId: actingAdmin.id,
        providerId: "credential",
        accountId: actingAdmin.email,
        password: "integration-password-hash",
      },
    });
    await expect(applyModerationAction(actionInput)).resolves.toMatchObject({ action: "suspend" });
    await expect(getAdministratorContinuityStatus(prisma)).resolves.toMatchObject({
      eligibleAdministrators: 1,
      state: "redundancy_warning",
    });
    await prisma.moderationSanction.updateMany({
      where: { userId: target.id, type: "suspend", revokedAt: null },
      data: { endsAt: new Date(Date.now() - 1) },
    });
    await expect(restoreExpiredSuspensions()).resolves.toBeGreaterThanOrEqual(1);
    await expect(prisma.user.findUnique({ where: { id: target.id } })).resolves.toMatchObject({
      status: "active",
    });
    await expect(getAdministratorContinuityStatus(prisma)).resolves.toMatchObject({
      eligibleAdministrators: 2,
      state: "healthy",
    });
  });

  it("surfaces the same redundancy warning on the administrator dashboard", async () => {
    const administrator = await createUser("dashboard");
    await grantAdmin(administrator.id);

    const dashboard = await getAdminDashboard(administrator.id);

    expect(dashboard.administratorContinuity).toMatchObject({
      eligibleAdministrators: 1,
      state: "redundancy_warning",
    });
    expect(dashboard.alerts).toContainEqual(
      expect.objectContaining({
        code: "administrator_continuity_redundancy",
        severity: "warning",
      }),
    );
  });
});
