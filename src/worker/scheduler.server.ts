import "server-only";

import { getPrismaClient } from "@/infrastructure/database/client";
import { recoverPublishedOutboxBatch } from "@/infrastructure/outbox/dispatcher";
import { processReplayRequests } from "@/worker/failures.server";
import { getServiceEnvironment } from "@/shared/config/runtime-env";
import { getErrorMessage } from "@/shared/errors/error-message";
import { WORKER_MAINTENANCE_TASK } from "@/worker/contracts";
import { TRUST_DAILY_TASK } from "@/modules/trust/contracts";
import { scheduleDailyTrustRecalculation } from "@/modules/trust/trust.server";
import { restoreExpiredSuspensions } from "@/modules/moderation/actions.server";
import { pruneReplyEditorSessionTombstones } from "@/modules/community/editor-session-maintenance.server";
import { finalizeDueAccountDeletions } from "@/modules/identity/account-deletion.server";
import { pruneCountedTopicViews } from "@/modules/interactions/view-worker.server";

export async function ensureWorkerScheduledTasks(): Promise<void> {
  await Promise.all([
    getPrismaClient().workerScheduledTask.upsert({
      where: { name: WORKER_MAINTENANCE_TASK },
      create: { name: WORKER_MAINTENANCE_TASK, intervalSeconds: 60, nextRunAt: new Date() },
      update: {},
    }),
    getPrismaClient().workerScheduledTask.upsert({
      where: { name: TRUST_DAILY_TASK },
      create: { name: TRUST_DAILY_TASK, intervalSeconds: 86_400, nextRunAt: new Date() },
      update: {},
    }),
  ]);
}

type LeaseAssertion = () => void;
type ScheduledTaskExecutor = (
  name: string,
  workerId: string,
  now: Date,
  assertLease: LeaseAssertion,
) => Promise<Record<string, unknown>>;

async function executeTask(
  name: string,
  workerId: string,
  now: Date,
  assertLease: LeaseAssertion,
): Promise<Record<string, unknown>> {
  let result: Record<string, unknown>;
  if (name === WORKER_MAINTENANCE_TASK) {
    const [
      replayed,
      restoredSuspensions,
      prunedReplyEditorSessions,
      prunedTopicViews,
      outboxRecovery,
    ] = await Promise.all([
      processReplayRequests(),
      restoreExpiredSuspensions(),
      pruneReplyEditorSessionTombstones(now),
      pruneCountedTopicViews(now),
      recoverPublishedOutboxBatch(workerId, now),
    ]);
    assertLease();
    const accountDeletions = await finalizeDueAccountDeletions(now);
    assertLease();
    result = {
      replayed,
      restoredSuspensions,
      prunedReplyEditorSessions,
      prunedTopicViews,
      outboxRecovery,
      accountDeletions,
    };
  } else if (name === TRUST_DAILY_TASK) {
    assertLease();
    result = { batchId: await scheduleDailyTrustRecalculation() };
  } else {
    throw new Error(`Unknown scheduled task: ${name}`);
  }
  assertLease();
  return result;
}

export async function runScheduledTasks(
  workerId: string,
  now = new Date(),
  taskExecutor: ScheduledTaskExecutor = executeTask,
): Promise<number> {
  const prisma = getPrismaClient();
  const taskLockTimeoutMs = getServiceEnvironment().WORKER_TASK_LOCK_TIMEOUT_MS;
  const staleBefore = new Date(now.getTime() - taskLockTimeoutMs);
  const task = await prisma.workerScheduledTask.findFirst({
    where: {
      nextRunAt: { lte: now },
      OR: [{ lockedAt: null }, { lockedAt: { lte: staleBefore } }],
    },
    orderBy: { nextRunAt: "asc" },
  });
  if (!task) return 0;
  const claimed = await prisma.workerScheduledTask.updateMany({
    where: {
      name: task.name,
      nextRunAt: { lte: now },
      OR: [{ lockedAt: null }, { lockedAt: { lte: staleBefore } }],
    },
    data: { lockedAt: now, lockOwner: workerId, lastStartedAt: now, lastError: null },
  });
  if (claimed.count !== 1) return 0;

  const heartbeatIntervalMs = Math.max(250, Math.floor(taskLockTimeoutMs / 3));
  let leaseLost = false;
  let heartbeatWork = Promise.resolve();
  const heartbeat = setInterval(() => {
    heartbeatWork = heartbeatWork
      .then(async () => {
        const renewed = await prisma.workerScheduledTask.updateMany({
          where: { name: task.name, lockOwner: workerId },
          data: { lockedAt: new Date() },
        });
        if (renewed.count !== 1) leaseLost = true;
      })
      .catch(() => {
        leaseLost = true;
      });
  }, heartbeatIntervalMs);
  heartbeat.unref();
  const assertLease = () => {
    if (leaseLost) throw new Error("Scheduled task lease was lost");
  };

  try {
    const result = await taskExecutor(task.name, workerId, now, assertLease);
    clearInterval(heartbeat);
    await heartbeatWork;
    assertLease();
    const completedAt = new Date();
    await prisma.$transaction(async (transaction) => {
      const completed = await transaction.workerScheduledTask.updateMany({
        where: { name: task.name, lockOwner: workerId },
        data: {
          nextRunAt: new Date(now.getTime() + task.intervalSeconds * 1_000),
          lockedAt: null,
          lockOwner: null,
          lastCompletedAt: completedAt,
          lastError: null,
          runCount: { increment: 1 },
        },
      });
      if (completed.count !== 1) throw new Error("Scheduled task lease was lost");
      await transaction.systemState.upsert({
        where: { key: `worker.last_task.${task.name}` },
        create: {
          key: `worker.last_task.${task.name}`,
          value: { workerId, ...result, completedAt: completedAt.toISOString() },
        },
        update: { value: { workerId, ...result, completedAt: completedAt.toISOString() } },
      });
    });
  } catch (error) {
    clearInterval(heartbeat);
    await heartbeatWork;
    if (!leaseLost) {
      await prisma.workerScheduledTask.updateMany({
        where: { name: task.name, lockOwner: workerId },
        data: {
          nextRunAt: new Date(now.getTime() + Math.min(task.intervalSeconds, 30) * 1_000),
          lockedAt: null,
          lockOwner: null,
          lastError: getErrorMessage(error).slice(0, 8_000),
        },
      });
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
    await heartbeatWork;
  }
  return 1;
}
