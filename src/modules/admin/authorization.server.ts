import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  getCommunityPermissions,
  type CommunityPermissions,
} from "@/modules/community/authorization.server";
import { AdminError } from "@/modules/admin/errors";

export async function requireAdministrator(
  database: Prisma.TransactionClient,
  actorId: string,
): Promise<CommunityPermissions> {
  const permissions = await getCommunityPermissions(database, actorId);
  if (!permissions.active || !permissions.isAdmin) throw new AdminError("forbidden", 403);
  return permissions;
}
