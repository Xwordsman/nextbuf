import "server-only";

import type { Prisma } from "@/generated/prisma/client";

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

  await transaction.$executeRaw`
    DELETE FROM "interaction_topic_views"
    WHERE "id" IN (
      SELECT "id"
      FROM "interaction_topic_views"
      WHERE "counted_at" IS NOT NULL
        AND "created_at" < CURRENT_TIMESTAMP - INTERVAL '30 days'
      ORDER BY "created_at" ASC
      LIMIT 500
    )
  `;
  return { viewId, counted: Boolean(topic) };
}
