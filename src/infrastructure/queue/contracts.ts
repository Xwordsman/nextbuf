import type { Prisma } from "@/generated/prisma/client";

export const SYSTEM_QUEUE_NAME = "system";
export const OUTBOX_JOB_NAME = "outbox-event";
export const RUNTIME_PROBE_TOPIC = "nextbuf.runtime.probe";

export type OutboxJobData = {
  eventId: string;
  topic: string;
  version: number;
  payload: Prisma.InputJsonObject;
};
