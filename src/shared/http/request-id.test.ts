import { describe, expect, it } from "vitest";
import { resolveRequestId } from "./request-id";

describe("resolveRequestId", () => {
  it("keeps a safe upstream request id", () => {
    expect(resolveRequestId("request-123")).toBe("request-123");
  });

  it("replaces unsafe values", () => {
    expect(resolveRequestId("bad request id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
