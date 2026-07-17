import { describe, expect, it } from "vitest";
import { createContentSecurityPolicy } from "@/shared/http/security-headers";

describe("Content Security Policy", () => {
  it("uses a per-request script nonce without allowing inline scripts", () => {
    const policy = createContentSecurityPolicy({
      nonce: "request-nonce",
      development: false,
      secure: true,
    });

    const scriptDirective = policy.split("; ").find((part) => part.startsWith("script-src"));
    expect(scriptDirective).toContain("'nonce-request-nonce'");
    expect(scriptDirective).toContain("'strict-dynamic'");
    expect(scriptDirective).not.toContain("'unsafe-inline'");
    expect(scriptDirective).not.toContain("'unsafe-eval'");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("only permits eval in development and does not force HTTPS on loopback tests", () => {
    const policy = createContentSecurityPolicy({
      nonce: "development-nonce",
      development: true,
      secure: false,
    });

    expect(policy).toContain("'unsafe-eval'");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });
});
