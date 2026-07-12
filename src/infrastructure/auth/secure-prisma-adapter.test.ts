import { describe, expect, it } from "vitest";
import { hashVerificationIdentifier } from "@/infrastructure/auth/secure-prisma-adapter";

describe("verification identifier hashing", () => {
  it("creates a stable keyed digest without retaining the token", () => {
    const identifier = "reset-password:plain-reset-token";
    const digest = hashVerificationIdentifier("test-secret", identifier);

    expect(digest).toHaveLength(64);
    expect(digest).toBe(hashVerificationIdentifier("test-secret", identifier));
    expect(digest).not.toContain("plain-reset-token");
    expect(digest).not.toBe(hashVerificationIdentifier("different-secret", identifier));
  });
});
