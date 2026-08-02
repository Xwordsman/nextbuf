import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { logger } from "@/infrastructure/observability/logger";
import { getServiceEnvironment } from "@/shared/config/runtime-env";
import { getErrorMessage } from "@/shared/errors/error-message";

export const OUTBOX_PROCESSING_OWNER_PREFIX = "outbox-processing:";

export class OutboxProcessingLeaseLostError extends Error {
  constructor(eventId: string) {
    super(`Outbox processing lease was lost for event ${eventId}`);
    this.name = "OutboxProcessingLeaseLostError";
  }
}

export type OutboxProcessingLease = {
  assertActive: (transaction?: Prisma.TransactionClient) => Promise<void>;
  assertCommit: (transaction: Prisma.TransactionClient) => Promise<void>;
  release: () => Promise<void>;
};

export async function acquireOutboxProcessingLease(
  eventId: string,
): Promise<OutboxProcessingLease | null> {
  const prisma = getPrismaClient();
  const environment = getServiceEnvironment();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - environment.OUTBOX_LOCK_TIMEOUT_MS);
  const owner = `${OUTBOX_PROCESSING_OWNER_PREFIX}${process.pid}:${randomUUID()}`;
  const claimed = await prisma.outboxEvent.updateMany({
    where: {
      id: eventId,
      OR: [
        { lockedAt: null },
        { lockOwner: null },
        { lockedAt: { lte: staleBefore } },
        // Publication locks end once Redis hands the job to a processor. Only another
        // processing lease must expire before the same side effect can run again.
        { NOT: { lockOwner: { startsWith: OUTBOX_PROCESSING_OWNER_PREFIX } } },
      ],
    },
    data: { lockedAt: now, lockOwner: owner },
  });

  if (claimed.count !== 1) return null;

  const heartbeatIntervalMs = Math.max(250, Math.floor(environment.OUTBOX_LOCK_TIMEOUT_MS / 3));
  let heartbeatWork = Promise.resolve();
  let leaseLost = false;

  const markLeaseLost = () => {
    leaseLost = true;
    clearInterval(heartbeat);
  };
  const throwIfLost = () => {
    if (leaseLost) throw new OutboxProcessingLeaseLostError(eventId);
  };
  const verifyOwner = async (transaction?: Prisma.TransactionClient) => {
    await heartbeatWork;
    throwIfLost();
    try {
      const active = await (transaction ?? prisma).outboxEvent.count({
        where: { id: eventId, lockOwner: owner },
      });
      if (active !== 1) markLeaseLost();
    } catch (error) {
      markLeaseLost();
      logger.error("Outbox processing lease ownership check failed", {
        eventId,
        error: getErrorMessage(error),
      });
    }
    throwIfLost();
  };

  const heartbeat = setInterval(() => {
    heartbeatWork = heartbeatWork
      .then(async () => {
        const result = await prisma.outboxEvent.updateMany({
          where: { id: eventId, lockOwner: owner },
          data: { lockedAt: new Date() },
        });
        if (result.count !== 1) markLeaseLost();
      })
      .catch((error) => {
        markLeaseLost();
        logger.error("Outbox processing lease heartbeat failed", {
          eventId,
          error: getErrorMessage(error),
        });
      });
  }, heartbeatIntervalMs);
  heartbeat.unref();

  return {
    assertActive: verifyOwner,
    assertCommit: async (transaction) => {
      await heartbeatWork;
      throwIfLost();
      const owned = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "outbox_events"
        WHERE "id" = CAST(${eventId} AS uuid)
          AND "lock_owner" = ${owner}
        FOR UPDATE
      `);
      if (owned.length !== 1) {
        markLeaseLost();
        throwIfLost();
      }
    },
    release: async () => {
      clearInterval(heartbeat);
      await heartbeatWork;
      try {
        await prisma.outboxEvent.updateMany({
          where: { id: eventId, lockOwner: owner },
          data: { lockedAt: null, lockOwner: null },
        });
      } catch (error) {
        logger.error("Outbox processing lease release failed", {
          eventId,
          error: getErrorMessage(error),
        });
      }
    },
  };
}
