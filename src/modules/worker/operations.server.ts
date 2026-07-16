import "server-only";

import { getPrismaClient } from "@/infrastructure/database/client";
import { queueTestEmail } from "@/infrastructure/mail/queue";
import { getSystemQueueHealth } from "@/infrastructure/queue/health";
import { getCommunityPermissions } from "@/modules/community/authorization.server";
import { getErrorMessage } from "@/shared/errors/error-message";
import { requestWorkerReplay } from "@/worker/failures.server";

export class WorkerOperationsError extends Error {
  constructor(
    public readonly code: "forbidden" | "failure_not_replayable",
    public readonly status: 403 | 409,
  ) {
    super(code);
  }
}

export async function requireWorkerOperator(userId: string): Promise<void> {
  const permissions = await getCommunityPermissions(getPrismaClient(), userId);
  if (!permissions.active || !permissions.isAdmin) {
    throw new WorkerOperationsError("forbidden", 403);
  }
}

export async function getWorkerOperationsSummary(userId: string) {
  await requireWorkerOperator(userId);
  const prisma = getPrismaClient();
  const [outboxPending, outboxErrors, failures, workers, tasks, pendingMail, failedMail] =
    await Promise.all([
      prisma.outboxEvent.count({ where: { publishedAt: null } }),
      prisma.outboxEvent.count({ where: { publishedAt: null, lastError: { not: null } } }),
      prisma.workerJobFailure.findMany({
        where: { resolvedAt: null },
        orderBy: { failedAt: "desc" },
        take: 50,
      }),
      prisma.workerHeartbeat.findMany({ orderBy: { heartbeatAt: "desc" }, take: 20 }),
      prisma.workerScheduledTask.findMany({ orderBy: { name: "asc" } }),
      prisma.emailDelivery.count({ where: { status: { in: ["pending", "sending"] } } }),
      prisma.emailDelivery.count({ where: { status: "failed" } }),
    ]);
  let queue:
    | { available: true; counts: Awaited<ReturnType<typeof getSystemQueueHealth>> }
    | { available: false; error: string };
  try {
    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error("Queue health check timed out")), 2_000);
      timer.unref();
    });
    queue = { available: true, counts: await Promise.race([getSystemQueueHealth(), timeout]) };
  } catch (error) {
    queue = { available: false, error: getErrorMessage(error) };
  }
  return {
    queue,
    outbox: { pending: outboxPending, dispatchErrors: outboxErrors },
    mail: { pending: pendingMail, failed: failedMail },
    failures,
    workers,
    tasks,
  };
}

export async function requestReplayAsOperator(userId: string, failureId: string): Promise<void> {
  await requireWorkerOperator(userId);
  if (!(await requestWorkerReplay(failureId, userId))) {
    throw new WorkerOperationsError("failure_not_replayable", 409);
  }
}

export async function queueTestEmailAsOperator(userId: string): Promise<void> {
  await requireWorkerOperator(userId);
  const user = await getPrismaClient().user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  });
  if (!user?.emailVerified) throw new WorkerOperationsError("forbidden", 403);
  await queueTestEmail(user.email);
  await getPrismaClient().communityAuditEvent.create({
    data: { actorId: userId, action: "worker.test_email.queued" },
  });
}
