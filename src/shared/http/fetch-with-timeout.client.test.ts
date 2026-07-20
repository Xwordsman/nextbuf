import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "@/shared/http/fetch-with-timeout.client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchWithTimeout", () => {
  it("leaves a completed response body available to the caller", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, value: "available" })),
    );

    const response = await fetchWithTimeout("https://nextbuf.test/complete", {}, 1_000);

    expect(response).not.toBeNull();
    await expect(response?.json()).resolves.toEqual({ ok: true, value: "available" });
  });

  it("keeps the timeout active until the response body is readable", async () => {
    let signal: AbortSignal | undefined;
    const response = {
      clone: () => ({
        arrayBuffer: () =>
          new Promise<ArrayBuffer>((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Request aborted", "AbortError")),
              { once: true },
            );
          }),
      }),
    } as Response;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return response;
      }),
    );

    await expect(fetchWithTimeout("https://nextbuf.test/stream", {}, 10)).resolves.toBeNull();
    expect(signal?.aborted).toBe(true);
  });
});
