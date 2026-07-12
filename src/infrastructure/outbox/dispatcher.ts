import type { OutboxEvent, Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { OUTBOX_JOB_NAME } from "@/infrastructure/queue/contracts";
import { getSystemQueue } from "@/infrastructure/queue/system-queue";
import { getServiceEnvironment } from "@/shared/config/runtime-env";
import { getErrorMessage } from "@/shared/errors/error-message";

type DispatchResult = {
  dispatched: number;
  failed: number;
};

function asJobPayload(event: OutboxEvent): Prisma.InputJsonObject {
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    throw new Error(`Outbox event ${event.id} payload must be a JSON object`);
  }

  return event.payload as Prisma.InputJsonObject;
}

async function claimNextEvent(lockOwner: string): Promise<OutboxEvent | null> {
  const environment = getServiceEnvironment();
  const prisma = getPrismaClient();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - environment.OUTBOX_LOCK_TIMEOUT_MS);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = await prisma.outboxEvent.findFirst({
      where: {
        publishedAt: null,
        availableAt: { lte: now },
        OR: [{ lockedAt: null }, { lockedAt: { lte: staleBefore } }],
      },
      orderBy: [{ availableAt: "asc" }, { occurredAt: "asc" }],
    });

    if (!candidate) {
      return null;
    }

    const claimed = await prisma.outboxEvent.updateMany({
      where: {
        id: candidate.id,
        publishedAt: null,
        OR: [{ lockedAt: null }, { lockedAt: { lte: staleBefore } }],
      },
      data: {
        lockedAt: now,
        lockOwner,
        attempts: { increment: 1 },
        lastError: null,
      },
    });

    if (claimed.count === 1) {
      return { ...candidate, lockedAt: now, lockOwner, attempts: candidate.attempts + 1 };
    }
  }

  return null;
}

export async function dispatchOutboxBatch(lockOwner: string): Promise<DispatchResult> {
  const environment = getServiceEnvironment();
  const prisma = getPrismaClient();
  const queue = getSystemQueue();
  const result: DispatchResult = { dispatched: 0, failed: 0 };

  for (let index = 0; index < environment.OUTBOX_BATCH_SIZE; index += 1) {
    const event = await claimNextEvent(lockOwner);

    if (!event) {
      break;
    }

    try {
      await queue.add(
        OUTBOX_JOB_NAME,
        {
          eventId: event.id,
          topic: event.topic,
          version: event.version,
          payload: asJobPayload(event),
        },
        {
          jobId: event.id,
          attempts: 5,
          backoff: { type: "exponential", delay: 1_000 },
          removeOnComplete: { count: environment.JOB_REMOVE_COMPLETE_AFTER },
          removeOnFail: { count: environment.JOB_REMOVE_FAILED_AFTER },
        },
      );

      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          publishedAt: new Date(),
          lockedAt: null,
          lockOwner: null,
          lastError: null,
        },
      });
      result.dispatched += 1;
    } catch (error) {
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          lockedAt: null,
          lockOwner: null,
          lastError: getErrorMessage(error).slice(0, 4_000),
        },
      });
      result.failed += 1;
    }
  }

  return result;
}
