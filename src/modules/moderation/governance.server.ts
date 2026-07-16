import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import {
  getCommunityPermissions,
  type CommunityPermissions,
} from "@/modules/community/authorization.server";
import { ModerationError } from "@/modules/moderation/errors";

export type CommunityRole = "admin" | "global_moderator" | "node_moderator";

export function governanceActorRoles(permissions: CommunityPermissions): Prisma.InputJsonArray {
  return permissions.roles;
}

export async function requireSiteAdmin(
  database: Prisma.TransactionClient,
  actorId: string,
): Promise<CommunityPermissions> {
  const permissions = await getCommunityPermissions(database, actorId);
  if (!permissions.active || !permissions.isAdmin) throw new ModerationError("forbidden", 403);
  return permissions;
}

export async function writeGovernanceAudit(
  database: Prisma.TransactionClient,
  input: {
    actorId: string;
    actorRoles: Prisma.InputJsonArray;
    action: string;
    targetType: string;
    targetKey: string;
    reason: string;
    beforeState: Prisma.InputJsonObject;
    afterState: Prisma.InputJsonObject;
    requestId: string;
  },
): Promise<void> {
  await database.governanceAuditEvent.create({ data: input });
}

export async function grantCommunityRole(input: {
  actorId: string;
  targetUserId: string;
  role: CommunityRole;
  nodeId?: string;
  reason: string;
  requestId: string;
}) {
  return getPrismaClient().$transaction(async (transaction) => {
    const permissions = await requireSiteAdmin(transaction, input.actorId);
    const nodeId = input.role === "node_moderator" ? input.nodeId : undefined;
    if (input.role === "node_moderator" && !nodeId) {
      throw new ModerationError("invalid_action", 400);
    }
    if (input.role !== "node_moderator" && input.nodeId) {
      throw new ModerationError("invalid_action", 400);
    }
    const [user, node] = await Promise.all([
      transaction.user.findUnique({ where: { id: input.targetUserId }, select: { id: true } }),
      nodeId
        ? transaction.communityNode.findUnique({ where: { id: nodeId }, select: { id: true } })
        : Promise.resolve(null),
    ]);
    if (!user || (nodeId && !node)) throw new ModerationError("role_not_found", 404);
    const scopeKey = nodeId ?? "site";
    const existing = await transaction.communityRoleAssignment.findUnique({
      where: {
        userId_role_scopeKey: { userId: input.targetUserId, role: input.role, scopeKey },
      },
    });
    if (existing) return existing;
    const assignment = await transaction.communityRoleAssignment.create({
      data: {
        userId: input.targetUserId,
        role: input.role,
        nodeId,
        scopeKey,
        grantedById: input.actorId,
        reason: input.reason,
      },
    });
    await writeGovernanceAudit(transaction, {
      actorId: input.actorId,
      actorRoles: governanceActorRoles(permissions),
      action: "role.granted",
      targetType: "role_assignment",
      targetKey: assignment.id,
      reason: input.reason,
      beforeState: { assigned: false },
      afterState: { assigned: true, userId: input.targetUserId, role: input.role, scopeKey },
      requestId: input.requestId,
    });
    return assignment;
  });
}

export async function revokeCommunityRole(input: {
  actorId: string;
  assignmentId: string;
  reason: string;
  requestId: string;
}): Promise<void> {
  await getPrismaClient().$transaction(async (transaction) => {
    const permissions = await requireSiteAdmin(transaction, input.actorId);
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "community_role_assignments" WHERE "role" = 'admin' FOR UPDATE`,
    );
    const assignment = await transaction.communityRoleAssignment.findUnique({
      where: { id: input.assignmentId },
    });
    if (!assignment) throw new ModerationError("role_not_found", 404);
    if (
      assignment.role === "admin" &&
      (await transaction.communityRoleAssignment.count({ where: { role: "admin" } })) <= 1
    ) {
      throw new ModerationError("last_admin", 409);
    }
    await transaction.communityRoleAssignment.delete({ where: { id: assignment.id } });
    await writeGovernanceAudit(transaction, {
      actorId: input.actorId,
      actorRoles: governanceActorRoles(permissions),
      action: "role.revoked",
      targetType: "role_assignment",
      targetKey: assignment.id,
      reason: input.reason,
      beforeState: {
        assigned: true,
        userId: assignment.userId,
        role: assignment.role,
        scopeKey: assignment.scopeKey,
      },
      afterState: { assigned: false },
      requestId: input.requestId,
    });
  });
}
