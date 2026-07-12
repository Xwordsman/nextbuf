import type { Prisma } from "@/generated/prisma/client";
import { RUNTIME_PROBE_TOPIC, type OutboxJobData } from "@/infrastructure/queue/contracts";

type OutboxHandler = (
  transaction: Prisma.TransactionClient,
  job: OutboxJobData,
) => Promise<Prisma.InputJsonValue | undefined>;

const handlers = new Map<string, OutboxHandler>();

function handlerKey(topic: string, version: number): string {
  return `${topic}@${version}`;
}

handlers.set(handlerKey(RUNTIME_PROBE_TOPIC, 1), async (transaction, job) => {
  const processedAt = new Date().toISOString();
  await transaction.systemState.upsert({
    where: { key: "runtime.last_probe" },
    create: {
      key: "runtime.last_probe",
      value: { eventId: job.eventId, payload: job.payload, processedAt },
    },
    update: {
      value: { eventId: job.eventId, payload: job.payload, processedAt },
    },
  });

  return { eventId: job.eventId, processedAt };
});

export function getOutboxHandler(topic: string, version: number): OutboxHandler {
  const handler = handlers.get(handlerKey(topic, version));

  if (!handler) {
    throw new Error(`No worker handler registered for ${topic}@${version}`);
  }

  return handler;
}
