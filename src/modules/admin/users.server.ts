import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { requireAdministrator } from "@/modules/admin/authorization.server";
import { BULK_SESSION_CONFIRMATION } from "@/shared/admin-contracts";
import { AdminError } from "@/modules/admin/errors";
import {
  requireConfirmation,
  requireElevatedSiteAdmin,
} from "@/modules/admin/reauthentication.server";
import { managedReplyWhere, managedTopicWhere } from "@/modules/community/topic-visibility";
import { governanceActorRoles, writeGovernanceAudit } from "@/modules/moderation/governance.server";

export async function listAdminUsers(
  actorId: string,
  input: { query?: string; status?: string; beforeUid?: number; pageSize?: number },
) {
  const prisma = getPrismaClient();
  await prisma.$transaction((transaction) => requireAdministrator(transaction, actorId));
  const query = input.query?.trim() ?? "";
  const pageSize = Math.min(Math.max(input.pageSize ?? 25, 1), 50);
  const numericUid = /^\d+$/.test(query) ? Number(query) : null;
  const where: Prisma.UserWhereInput = {
    ...(input.status && input.status !== "all" ? { status: input.status } : {}),
    ...(input.beforeUid ? { uid: { lt: input.beforeUid } } : {}),
    ...(query
      ? {
          OR: [
            ...(numericUid && Number.isSafeInteger(numericUid) ? [{ uid: numericUid }] : []),
            { username: { contains: query, mode: "insensitive" as const } },
            { name: { contains: query, mode: "insensitive" as const } },
            { email: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const users = await prisma.user.findMany({
    where,
    orderBy: { uid: "desc" },
    take: pageSize + 1,
    select: {
      id: true,
      uid: true,
      username: true,
      name: true,
      email: true,
      emailVerified: true,
      status: true,
      createdAt: true,
      trustState: { select: { currentLevel: true } },
      communityRoles: { select: { role: true, scopeKey: true } },
      _count: {
        select: {
          communityTopics: { where: managedTopicWhere() },
          communityPosts: { where: managedReplyWhere() },
          sessions: true,
        },
      },
    },
  });
  const hasMore = users.length > pageSize;
  const items = users.slice(0, pageSize);
  return { items, nextBeforeUid: hasMore ? (items.at(-1)?.uid ?? null) : null };
}

export async function getAdminUserDetail(actorId: string, uid: number) {
  const prisma = getPrismaClient();
  await prisma.$transaction((transaction) => requireAdministrator(transaction, actorId));
  const user = await prisma.user.findUnique({
    where: { uid },
    include: {
      profile: true,
      accounts: { select: { id: true, providerId: true, createdAt: true, updatedAt: true } },
      sessions: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          expiresAt: true,
          ipAddress: true,
          userAgent: true,
        },
      },
      communityRoles: {
        orderBy: { createdAt: "desc" },
        include: {
          node: { select: { slug: true, name: true } },
          grantedBy: { select: { uid: true, username: true } },
        },
      },
      sanctions: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          node: { select: { slug: true, name: true } },
          case: { select: { number: true } },
        },
      },
      trustState: { include: { ruleVersion: { select: { version: true } } } },
      trustHistories: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          ruleVersion: { select: { version: true } },
          actor: { select: { uid: true, username: true } },
        },
      },
      _count: {
        select: {
          communityTopics: { where: managedTopicWhere() },
          communityPosts: { where: managedReplyWhere() },
          interactionPostLikes: true,
          moderationReports: true,
        },
      },
    },
  });
  if (!user) throw new AdminError("user_not_found", 404);
  return user;
}

export async function bulkRevokeUserSessions(input: {
  actorId: string;
  sessionId: string;
  userIds: string[];
  confirmation: string;
  reason: string;
  requestId: string;
}) {
  requireConfirmation(input.confirmation, BULK_SESSION_CONFIRMATION);
  const userIds = [...new Set(input.userIds)];
  if (userIds.length < 1 || userIds.length > 50) {
    throw new AdminError("invalid_operation", 400, { maxUsers: 50 });
  }
  return getPrismaClient().$transaction(async (transaction) => {
    const permissions = await requireElevatedSiteAdmin(transaction, input);
    const users = await transaction.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, uid: true },
    });
    if (users.length !== userIds.length) throw new AdminError("user_not_found", 404);
    const result = await transaction.session.deleteMany({ where: { userId: { in: userIds } } });
    await writeGovernanceAudit(transaction, {
      actorId: input.actorId,
      actorRoles: governanceActorRoles(permissions),
      action: "user.sessions.bulk_revoked",
      targetType: "users",
      targetKey: users
        .map((user) => user.uid)
        .sort((a, b) => a - b)
        .join(","),
      reason: input.reason,
      beforeState: { userCount: users.length },
      afterState: { revokedSessions: result.count },
      requestId: input.requestId,
    });
    return { userCount: users.length, revokedSessions: result.count };
  });
}
