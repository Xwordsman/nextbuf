import "server-only";

import { getPrismaClient } from "@/infrastructure/database/client";
import { processReplayRequests } from "@/worker/failures.server";
import { getServiceEnvironment } from "@/shared/config/runtime-env";
import { getErrorMessage } from "@/shared/errors/error-message";

export const WORKER_MAINTENANCE_TASK = "worker.maintenance";

export async function ensureWorkerScheduledTasks(): Promise<void> {
  await getPrismaClient().workerScheduledTask.upsert({
    where: { name: WORKER_MAINTENANCE_TASK },
    create: { name: WORKER_MAINTENANCE_TASK, intervalSeconds: 60, nextRunAt: new Date() },
    update: {},
  });
}

async function executeTask(name: string, workerId: string, now: Date): Promise<void> {
  if (name !== WORKER_MAINTENANCE_TASK) throw new Error(`Unknown scheduled task: ${name}`);
  const replayed = await processReplayRequests();
  await getPrismaClient().systemState.upsert({
    where: { key: "worker.last_maintenance" },
    create: {
      key: "worker.last_maintenance",
      value: { workerId, replayed, completedAt: now.toISOString() },
    },
    update: { value: { workerId, replayed, completedAt: now.toISOString() } },
  });
}

export async function runScheduledTasks(workerId: string, now = new Date()): Promise<number> {
  const prisma = getPrismaClient();
  const staleBefore = new Date(now.getTime() - getServiceEnvironment().WORKER_TASK_LOCK_TIMEOUT_MS);
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

  try {
    await executeTask(task.name, workerId, now);
    await prisma.workerScheduledTask.update({
      where: { name: task.name },
      data: {
        nextRunAt: new Date(now.getTime() + task.intervalSeconds * 1_000),
        lockedAt: null,
        lockOwner: null,
        lastCompletedAt: new Date(),
        lastError: null,
        runCount: { increment: 1 },
      },
    });
  } catch (error) {
    await prisma.workerScheduledTask.update({
      where: { name: task.name },
      data: {
        nextRunAt: new Date(now.getTime() + Math.min(task.intervalSeconds, 30) * 1_000),
        lockedAt: null,
        lockOwner: null,
        lastError: getErrorMessage(error).slice(0, 8_000),
      },
    });
    throw error;
  }
  return 1;
}
