import "server-only";

import { getPrismaClient } from "@/infrastructure/database/client";
import { getSystemQueueHealth } from "@/infrastructure/queue/health";
import { requireAdministrator } from "@/modules/admin/authorization.server";
import { getErrorMessage } from "@/shared/errors/error-message";

export async function getAdminDashboard(actorId: string) {
  const prisma = getPrismaClient();
  await prisma.$transaction((transaction) => requireAdministrator(transaction, actorId));
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
  const staleWorkerAt = new Date(now.getTime() - 30_000);

  const [
    totalUsers,
    registrationsToday,
    registrations30d,
    activeUsers30d,
    totalTopics,
    totalReplies,
    topicsToday,
    repliesToday,
    openReports,
    openCases,
    pendingOutbox,
    failedOutbox,
    pendingMail,
    failedMail,
    unresolvedJobs,
    activeWorkers,
    trustBatches,
    recentUsers,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.user.count({
      where: {
        OR: [
          { communityPosts: { some: { createdAt: { gte: thirtyDaysAgo } } } },
          { interactionReadStates: { some: { lastReadAt: { gte: thirtyDaysAgo } } } },
          { interactionPostLikes: { some: { createdAt: { gte: thirtyDaysAgo } } } },
        ],
      },
    }),
    prisma.communityTopic.count(),
    prisma.communityPost.count({ where: { position: { gt: 1 } } }),
    prisma.communityTopic.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.communityPost.count({ where: { position: { gt: 1 }, createdAt: { gte: dayAgo } } }),
    prisma.moderationReport.count({ where: { status: "open" } }),
    prisma.moderationCase.count({ where: { status: { in: ["open", "in_review"] } } }),
    prisma.outboxEvent.count({ where: { publishedAt: null } }),
    prisma.outboxEvent.count({ where: { publishedAt: null, lastError: { not: null } } }),
    prisma.emailDelivery.count({ where: { status: { in: ["pending", "sending"] } } }),
    prisma.emailDelivery.count({ where: { status: "failed" } }),
    prisma.workerJobFailure.count({ where: { resolvedAt: null } }),
    prisma.workerHeartbeat.count({
      where: { status: "running", heartbeatAt: { gte: staleWorkerAt } },
    }),
    prisma.trustRecalculationBatch.count({ where: { status: { in: ["pending", "running"] } } }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { uid: true, username: true, name: true, status: true, createdAt: true },
    }),
  ]);

  let queue:
    | { available: true; waiting: number; active: number; failed: number }
    | { available: false; error: string };
  try {
    const counts = await getSystemQueueHealth();
    queue = {
      available: true,
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      failed: counts.failed ?? 0,
    };
  } catch (error) {
    queue = { available: false, error: getErrorMessage(error) };
  }

  return {
    generatedAt: now,
    users: {
      total: totalUsers,
      today: registrationsToday,
      thirtyDays: registrations30d,
      active30d: activeUsers30d,
    },
    content: { topics: totalTopics, replies: totalReplies, topicsToday, repliesToday },
    moderation: { openReports, openCases },
    operations: {
      pendingOutbox,
      failedOutbox,
      pendingMail,
      failedMail,
      unresolvedJobs,
      activeWorkers,
      trustBatches,
    },
    queue,
    recentUsers,
  };
}
