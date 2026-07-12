import { getSystemQueue } from "@/infrastructure/queue/system-queue";

export async function getSystemQueueHealth() {
  const counts = await getSystemQueue().getJobCounts(
    "active",
    "completed",
    "delayed",
    "failed",
    "prioritized",
    "waiting",
    "waiting-children",
  );

  return counts;
}
