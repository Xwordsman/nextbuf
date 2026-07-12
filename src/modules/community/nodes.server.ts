import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { requireActiveCommunityActor } from "@/modules/community/authorization.server";
import { CommunityError } from "@/modules/community/errors";

type UpdateNodeInput = {
  name: string;
  description: string;
  color: string;
  icon: string;
  sortOrder: number;
  visibility: "public" | "hidden";
  archived: boolean;
};

export async function updateCommunityNode(
  context: { userId: string; requestId?: string },
  slug: string,
  input: UpdateNodeInput,
) {
  return getPrismaClient().$transaction(async (transaction) => {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "community_nodes" WHERE "slug" = ${slug} FOR UPDATE`,
    );
    const node = await transaction.communityNode.findUnique({ where: { slug } });
    if (!node) throw new CommunityError("node_unavailable", 404);
    const permissions = await requireActiveCommunityActor(transaction, context.userId, node.id);
    if (!permissions.isAdmin) throw new CommunityError("forbidden", 403);
    const updated = await transaction.communityNode.update({
      where: { id: node.id },
      data: {
        name: input.name.trim(),
        description: input.description.trim(),
        color: input.color.toLowerCase(),
        icon: input.icon,
        sortOrder: input.sortOrder,
        visibility: input.visibility,
        archivedAt: input.archived ? (node.archivedAt ?? new Date()) : null,
      },
    });
    await transaction.communityAuditEvent.create({
      data: {
        actorId: context.userId,
        action: "node.updated",
        nodeId: node.id,
        requestId: context.requestId,
        metadata: {
          slug,
          visibility: input.visibility,
          archived: input.archived,
          sortOrder: input.sortOrder,
        },
      },
    });
    return updated;
  });
}
