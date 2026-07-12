import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type DatabaseClient = Prisma.TransactionClient | PrismaClient;

export type CreateOutboxEventInput = {
  topic: string;
  version?: number;
  idempotencyKey: string;
  payload: Prisma.InputJsonObject;
  availableAt?: Date;
};

export async function createOutboxEvent(client: DatabaseClient, input: CreateOutboxEventInput) {
  return client.outboxEvent.create({
    data: {
      topic: input.topic,
      version: input.version ?? 1,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      availableAt: input.availableAt,
    },
  });
}
