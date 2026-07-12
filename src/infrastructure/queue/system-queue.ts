import { Queue } from "bullmq";
import type IORedis from "ioredis";
import { createBullRedisConnection } from "@/infrastructure/cache/redis";
import { getRedisKeyspaces } from "@/infrastructure/cache/keys";
import { SYSTEM_QUEUE_NAME, type OutboxJobData } from "@/infrastructure/queue/contracts";

let systemQueue: Queue<OutboxJobData> | undefined;
let systemQueueConnection: IORedis | undefined;

export function getSystemQueue(): Queue<OutboxJobData> {
  if (!systemQueue) {
    systemQueueConnection = createBullRedisConnection();
    systemQueue = new Queue<OutboxJobData>(SYSTEM_QUEUE_NAME, {
      connection: systemQueueConnection,
      prefix: getRedisKeyspaces().queue,
    });
  }

  return systemQueue;
}

export async function closeSystemQueue(): Promise<void> {
  if (!systemQueue) {
    return;
  }

  await systemQueue.close();
  systemQueue = undefined;

  if (systemQueueConnection && systemQueueConnection.status !== "end") {
    await systemQueueConnection.quit();
  }
  systemQueueConnection = undefined;
}
