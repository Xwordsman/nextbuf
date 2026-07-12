import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { CommunityError } from "@/modules/community/errors";

type AuthorizationDatabase = Pick<Prisma.TransactionClient, "user" | "communityRoleAssignment">;

export type CommunityPermissions = {
  active: boolean;
  isAdmin: boolean;
  isGlobalModerator: boolean;
  isNodeModerator: boolean;
  canModerate: boolean;
};

export async function getCommunityPermissions(
  database: AuthorizationDatabase,
  userId: string,
  nodeId?: string,
): Promise<CommunityPermissions> {
  const [user, assignments] = await Promise.all([
    database.user.findUnique({ where: { id: userId }, select: { status: true } }),
    database.communityRoleAssignment.findMany({
      where: {
        userId,
        OR: [{ scopeKey: "site" }, ...(nodeId ? [{ nodeId }] : [])],
      },
      select: { role: true, nodeId: true },
    }),
  ]);
  const isAdmin = assignments.some((assignment) => assignment.role === "admin");
  const isGlobalModerator = assignments.some(
    (assignment) => assignment.role === "global_moderator",
  );
  const isNodeModerator = Boolean(
    nodeId &&
    assignments.some(
      (assignment) => assignment.role === "node_moderator" && assignment.nodeId === nodeId,
    ),
  );

  return {
    active: user?.status === "active",
    isAdmin,
    isGlobalModerator,
    isNodeModerator,
    canModerate: isAdmin || isGlobalModerator || isNodeModerator,
  };
}

export async function requireActiveCommunityActor(
  database: AuthorizationDatabase,
  userId: string,
  nodeId?: string,
): Promise<CommunityPermissions> {
  const permissions = await getCommunityPermissions(database, userId, nodeId);
  if (!permissions.active) throw new CommunityError("forbidden", 403);
  return permissions;
}
