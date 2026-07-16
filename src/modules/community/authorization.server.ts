import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { CommunityError } from "@/modules/community/errors";

type AuthorizationDatabase = Pick<
  Prisma.TransactionClient,
  "user" | "communityRoleAssignment" | "moderationSanction"
>;

export type CommunityPermissions = {
  active: boolean;
  isAdmin: boolean;
  isGlobalModerator: boolean;
  isNodeModerator: boolean;
  canModerate: boolean;
  hasModerationRole: boolean;
  siteMuted: boolean;
  nodeMuted: boolean;
  suspended: boolean;
  banned: boolean;
  canCreateContent: boolean;
  roles: Array<"admin" | "global_moderator" | "node_moderator">;
};

export async function getCommunityPermissions(
  database: AuthorizationDatabase,
  userId: string,
  nodeId?: string,
): Promise<CommunityPermissions> {
  const now = new Date();
  const [user, assignments, sanctions] = await Promise.all([
    database.user.findUnique({ where: { id: userId }, select: { status: true } }),
    database.communityRoleAssignment.findMany({
      where: nodeId ? { userId, OR: [{ scopeKey: "site" }, { nodeId }] } : { userId },
      select: { role: true, nodeId: true },
    }),
    database.moderationSanction.findMany({
      where: {
        userId,
        revokedAt: null,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      select: { type: true, nodeId: true },
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
  const roles = [
    ...(isAdmin ? (["admin"] as const) : []),
    ...(isGlobalModerator ? (["global_moderator"] as const) : []),
    ...(isNodeModerator ? (["node_moderator"] as const) : []),
  ];
  const siteMuted = sanctions.some((sanction) => sanction.type === "site_mute");
  const nodeMuted = Boolean(
    nodeId &&
    sanctions.some((sanction) => sanction.type === "node_mute" && sanction.nodeId === nodeId),
  );
  const suspended = sanctions.some((sanction) => sanction.type === "suspend");
  const banned = sanctions.some((sanction) => sanction.type === "ban");
  const active = user?.status === "active" && !suspended && !banned;

  return {
    active,
    isAdmin,
    isGlobalModerator,
    isNodeModerator,
    canModerate: isAdmin || isGlobalModerator || isNodeModerator,
    hasModerationRole:
      isAdmin ||
      isGlobalModerator ||
      assignments.some((assignment) => assignment.role === "node_moderator"),
    siteMuted,
    nodeMuted,
    suspended,
    banned,
    canCreateContent: active && !siteMuted && !nodeMuted,
    roles,
  };
}

export async function requireCommunityContentActor(
  database: AuthorizationDatabase,
  userId: string,
  nodeId?: string,
): Promise<CommunityPermissions> {
  const permissions = await getCommunityPermissions(database, userId, nodeId);
  if (!permissions.canCreateContent) throw new CommunityError("forbidden", 403);
  return permissions;
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
