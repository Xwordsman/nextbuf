import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { TrustMetrics } from "@/modules/trust/policy";

export async function collectTrustMetrics(
  database: Prisma.TransactionClient,
  userId: string,
  violationWindowDays: number,
  now: Date,
): Promise<TrustMetrics> {
  const user = await database.user.findUnique({
    where: { id: userId },
    select: { activatedAt: true, createdAt: true },
  });
  if (!user) throw new Error(`Trust metrics user not found: ${userId}`);
  const violationStart = new Date(now.getTime() - violationWindowDays * 86_400_000);
  const [readTopics, posts, likesReceived, recentViolations] = await Promise.all([
    database.interactionTopicReadState.count({ where: { userId } }),
    database.communityPost.count({
      where: {
        authorId: userId,
        status: "published",
        topic: { status: { in: ["published", "closed"] }, node: { visibility: "public" } },
      },
    }),
    database.interactionPostLike.count({
      where: {
        post: {
          authorId: userId,
          status: "published",
          topic: { status: { in: ["published", "closed"] }, node: { visibility: "public" } },
        },
      },
    }),
    database.moderationSanction.count({
      where: { userId, revokedAt: null, createdAt: { gte: violationStart } },
    }),
  ]);
  const accountStart = user.activatedAt ?? user.createdAt;
  return {
    accountAgeDays: Math.max(0, Math.floor((now.getTime() - accountStart.getTime()) / 86_400_000)),
    readTopics,
    posts,
    likesReceived,
    recentViolations,
  };
}
