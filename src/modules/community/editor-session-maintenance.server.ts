import "server-only";

import { getPrismaClient } from "@/infrastructure/database/client";
import { REPLY_EDITOR_SESSION_TOMBSTONE_RETENTION_MS } from "@/shared/community/editor-session";

const pruneBatchSize = 500;

export async function pruneReplyEditorSessionTombstones(now = new Date()): Promise<number> {
  const prisma = getPrismaClient();
  const expiredBefore = new Date(now.getTime() - REPLY_EDITOR_SESSION_TOMBSTONE_RETENTION_MS);
  const expired = await prisma.communityReplyEditorSession.findMany({
    where: {
      state: { in: ["cleared", "superseded"] },
      updatedAt: { lt: expiredBefore },
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: pruneBatchSize,
    select: { id: true },
  });
  if (expired.length === 0) return 0;
  const deleted = await prisma.communityReplyEditorSession.deleteMany({
    where: {
      id: { in: expired.map(({ id }) => id) },
      state: { in: ["cleared", "superseded"] },
      updatedAt: { lt: expiredBefore },
    },
  });
  return deleted.count;
}
