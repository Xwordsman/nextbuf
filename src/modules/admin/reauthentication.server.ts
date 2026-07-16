import "server-only";

import { getAuth } from "@/infrastructure/auth/better-auth";
import { getPrismaClient } from "@/infrastructure/database/client";
import type { Prisma } from "@/generated/prisma/client";
import { AdminError } from "@/modules/admin/errors";
import { requireAdministrator } from "@/modules/admin/authorization.server";
import { governanceActorRoles, writeGovernanceAudit } from "@/modules/moderation/governance.server";

const REAUTHENTICATION_TTL_MS = 10 * 60_000;

export function requireConfirmation(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new AdminError("confirmation_required", 400, { expected });
  }
}

export async function reauthenticateAdministrator(input: {
  actorId: string;
  sessionId: string;
  password: string;
  headers: Headers;
  requestId: string;
}): Promise<{ expiresAt: Date }> {
  const prisma = getPrismaClient();
  await prisma.$transaction((transaction) => requireAdministrator(transaction, input.actorId));
  const session = await prisma.session.findUnique({
    where: { id: input.sessionId },
    select: { userId: true, expiresAt: true },
  });
  if (!session || session.userId !== input.actorId || session.expiresAt <= new Date()) {
    throw new AdminError("forbidden", 403);
  }

  try {
    await getAuth().api.verifyPassword({
      body: { password: input.password },
      headers: input.headers,
    });
  } catch {
    throw new AdminError("invalid_password", 401);
  }

  const verifiedAt = new Date();
  const expiresAt = new Date(verifiedAt.getTime() + REAUTHENTICATION_TTL_MS);
  await prisma.$transaction(async (transaction) => {
    const permissions = await requireAdministrator(transaction, input.actorId);
    await transaction.adminReauthentication.upsert({
      where: { sessionId: input.sessionId },
      create: { sessionId: input.sessionId, verifiedAt, expiresAt },
      update: { verifiedAt, expiresAt },
    });
    await writeGovernanceAudit(transaction, {
      actorId: input.actorId,
      actorRoles: governanceActorRoles(permissions),
      action: "admin.reauthentication.succeeded",
      targetType: "session",
      targetKey: input.sessionId,
      reason: "管理员完成高风险操作二次验证",
      beforeState: { verified: false },
      afterState: { verified: true, expiresAt: expiresAt.toISOString() },
      requestId: input.requestId,
    });
  });
  return { expiresAt };
}

export async function requireElevatedSiteAdmin(
  transaction: Prisma.TransactionClient,
  input: { actorId: string; sessionId: string },
) {
  const permissions = await requireAdministrator(transaction, input.actorId);
  const elevation = await transaction.adminReauthentication.findUnique({
    where: { sessionId: input.sessionId },
    include: { session: { select: { userId: true, expiresAt: true } } },
  });
  const now = new Date();
  if (
    !elevation ||
    elevation.session.userId !== input.actorId ||
    elevation.session.expiresAt <= now ||
    elevation.expiresAt <= now
  ) {
    throw new AdminError("reauthentication_required", 403);
  }
  return permissions;
}

export async function getAdministratorReauthenticationState(input: {
  actorId: string;
  sessionId: string;
}) {
  const prisma = getPrismaClient();
  await prisma.$transaction((transaction) => requireAdministrator(transaction, input.actorId));
  const elevation = await prisma.adminReauthentication.findUnique({
    where: { sessionId: input.sessionId },
    select: { verifiedAt: true, expiresAt: true },
  });
  return {
    verifiedAt: elevation?.verifiedAt ?? null,
    expiresAt: elevation && elevation.expiresAt > new Date() ? elevation.expiresAt : null,
  };
}
