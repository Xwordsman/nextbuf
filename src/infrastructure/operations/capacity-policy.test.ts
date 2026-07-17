import { describe, expect, it } from "vitest";
import { buildOperationalAlerts } from "@/infrastructure/operations/capacity-policy";

describe("operational capacity alerts", () => {
  it("returns no alert for a healthy small installation", () => {
    expect(
      buildOperationalAlerts({
        activeWorkers: 1,
        pendingOutbox: 0,
        failedOutbox: 0,
        pendingMail: 0,
        failedMail: 0,
        unresolvedJobs: 0,
        queue: { available: true, waiting: 0, active: 0, failed: 0 },
      }),
    ).toEqual([]);
  });

  it("surfaces unavailable workers, queue backlog and persistent failures", () => {
    const alerts = buildOperationalAlerts({
      activeWorkers: 0,
      pendingOutbox: 700,
      failedOutbox: 2,
      pendingMail: 20,
      failedMail: 3,
      unresolvedJobs: 4,
      queue: { available: true, waiting: 600, active: 5, failed: 6 },
    });

    expect(alerts.map((alert) => alert.code)).toEqual([
      "worker_unavailable",
      "queue_backlog",
      "queue_failures",
      "outbox_backlog",
      "persistent_failures",
    ]);
    expect(alerts[0]?.severity).toBe("critical");
  });
});
