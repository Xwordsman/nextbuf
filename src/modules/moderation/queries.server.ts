import "server-only";

import { getPrismaClient } from "@/infrastructure/database/client";
import { getCommunityPermissions } from "@/modules/community/authorization.server";
import { ModerationError } from "@/modules/moderation/errors";

async function getModerationScope(actorId: string) {
  const prisma = getPrismaClient();
  const [permissions, nodeRoles] = await Promise.all([
    getCommunityPermissions(prisma, actorId),
    prisma.communityRoleAssignment.findMany({
      where: { userId: actorId, role: "node_moderator", nodeId: { not: null } },
      select: { nodeId: true },
    }),
  ]);
  if (!permissions.active) throw new ModerationError("forbidden", 403);
  const nodeIds = nodeRoles.flatMap((role) => (role.nodeId ? [role.nodeId] : []));
  if (!permissions.isAdmin && !permissions.isGlobalModerator && nodeIds.length === 0) {
    throw new ModerationError("forbidden", 403);
  }
  return { permissions, nodeIds };
}

export async function listModerationCases(actorId: string, status = "open") {
  const scope = await getModerationScope(actorId);
  return getPrismaClient().moderationCase.findMany({
    where: {
      status: status === "all" ? undefined : status,
      ...(!scope.permissions.isAdmin && !scope.permissions.isGlobalModerator
        ? { topic: { nodeId: { in: scope.nodeIds } } }
        : {}),
    },
    orderBy: [{ priorityScore: "desc" }, { createdAt: "asc" }],
    take: 100,
    include: {
      topic: { include: { node: true } },
      post: { select: { position: true, authorId: true } },
      reportedUser: { select: { uid: true, username: true, name: true } },
      _count: { select: { reports: true, actions: true } },
    },
  });
}

export async function getModerationCaseDetail(actorId: string, caseNumber: number) {
  const scope = await getModerationScope(actorId);
  const moderationCase = await getPrismaClient().moderationCase.findUnique({
    where: { number: caseNumber },
    include: {
      topic: { include: { node: true } },
      post: true,
      reportedUser: { select: { id: true, uid: true, username: true, name: true } },
      reports: {
        orderBy: { createdAt: "asc" },
        include: { reporter: { select: { uid: true, username: true, name: true } } },
      },
      actions: {
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { uid: true, username: true, name: true } } },
      },
      sanctions: {
        orderBy: { createdAt: "desc" },
        include: { user: { select: { uid: true, username: true, name: true } } },
      },
    },
  });
  if (!moderationCase) throw new ModerationError("case_not_found", 404);
  if (
    !scope.permissions.isAdmin &&
    !scope.permissions.isGlobalModerator &&
    (!moderationCase.topic || !scope.nodeIds.includes(moderationCase.topic.nodeId))
  ) {
    throw new ModerationError("forbidden", 403);
  }
  return { moderationCase, permissions: scope.permissions };
}

export async function getUserModerationHistory(userId: string) {
  return getPrismaClient().moderationSanction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      type: true,
      reason: true,
      startsAt: true,
      endsAt: true,
      revokedAt: true,
      revocationReason: true,
      node: { select: { name: true, slug: true } },
    },
  });
}
