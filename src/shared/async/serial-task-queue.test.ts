import { describe, expect, it } from "vitest";
import { SerialTaskQueue } from "@/shared/async/serial-task-queue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("SerialTaskQueue", () => {
  it("runs queued writes strictly one at a time", async () => {
    const queue = new SerialTaskQueue();
    const gate = deferred();
    const events: string[] = [];
    let active = 0;
    let maxActive = 0;

    const first = queue.run(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push("first:start");
      await gate.promise;
      events.push("first:end");
      active -= 1;
    });
    const second = queue.run(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push("second");
      active -= 1;
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    gate.resolve();
    await Promise.all([first, second, queue.onIdle()]);
    expect(events).toEqual(["first:start", "first:end", "second"]);
    expect(maxActive).toBe(1);
  });

  it("continues after a failed write and exposes a settled idle barrier", async () => {
    const queue = new SerialTaskQueue();
    const error = new Error("save failed");
    const events: string[] = [];
    const failed = queue.run(async () => {
      events.push("failed");
      throw error;
    });
    const recovered = queue.run(async () => {
      events.push("recovered");
      return 42;
    });

    await expect(failed).rejects.toBe(error);
    await expect(recovered).resolves.toBe(42);
    await expect(queue.onIdle()).resolves.toBeUndefined();
    expect(events).toEqual(["failed", "recovered"]);
  });
});
