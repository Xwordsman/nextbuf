import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";

export const TOPIC_VIEW_RETENTION_DAYS = 30;
const topicViewRetentionMs = TOPIC_VIEW_RETENTION_DAYS * 86_400_000;

export async function aggregateTopicView(transaction: Prisma.TransactionClient, viewId: string) {
  const view = await transaction.interactionTopicView.findUnique({ where: { id: viewId } });
  if (!view || view.countedAt) return { viewId, counted: false };

  const topic = await transaction.communityTopic.findFirst({
    where: {
      id: view.topicId,
      status: { in: ["published", "closed"] },
      node: { visibility: "public" },
    },
    select: { id: true },
  });
  if (topic) {
    await transaction.communityTopic.update({
      where: { id: topic.id },
      data: { viewCount: { increment: 1 } },
    });
  }
  await transaction.interactionTopicView.update({
    where: { id: view.id },
    data: { countedAt: new Date() },
  });

  return { viewId, counted: Boolean(topic) };
}

export async function pruneCountedTopicViews(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - topicViewRetentionMs);
  const deleted = await getPrismaClient().$queryRaw<Array<{ id: string }>>`
    WITH expired AS MATERIALIZED (
      SELECT "id"
      FROM "interaction_topic_views"
      WHERE "counted_at" IS NOT NULL
        AND "created_at" < ${cutoff}
      ORDER BY "created_at" ASC, "id" ASC
      LIMIT 500
    )
    DELETE FROM "interaction_topic_views" AS target
    USING expired
    WHERE target."id" = expired."id"
    RETURNING target."id"
  `;
  return deleted.length;
}
