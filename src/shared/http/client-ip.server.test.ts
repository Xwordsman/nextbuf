import { describe, expect, it } from "vitest";
import { resolveForwardedClientIp } from "@/shared/http/client-ip.server";

describe("client IP forwarding", () => {
  it("accepts a single address from an overwriting reverse proxy", () => {
    expect(resolveForwardedClientIp("192.0.2.10")).toBe("192.0.2.10");
  });

  it("rejects an untrusted multi-hop chain instead of using its leftmost value", () => {
    expect(resolveForwardedClientIp("198.51.100.20, 203.0.113.10")).toBeUndefined();
  });

  it("walks a chain from the right through configured proxy networks", () => {
    expect(resolveForwardedClientIp("198.51.100.20, 10.20.30.40", ["10.0.0.0/8"])).toBe(
      "198.51.100.20",
    );
  });

  it("does not accept a chain made entirely of trusted hops", () => {
    expect(resolveForwardedClientIp("10.20.30.40, 10.30.40.50", ["10.0.0.0/8"])).toBeUndefined();
  });
});
