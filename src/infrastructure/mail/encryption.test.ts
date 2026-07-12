import { describe, expect, it } from "vitest";
import { decryptMailPayload, encryptMailPayload } from "@/infrastructure/mail/encryption";

describe("mail payload encryption", () => {
  it("round-trips sensitive links without storing them in ciphertext", () => {
    const key = Buffer.from("0123456789abcdef0123456789abcdef");
    const payload = {
      text: "Open https://example.test/reset?token=plain-token",
      html: '<a href="https://example.test/reset?token=plain-token">Reset</a>',
    };
    const encrypted = encryptMailPayload(payload, key);

    expect(encrypted.ciphertext).not.toContain("plain-token");
    expect(decryptMailPayload(encrypted, key)).toEqual(payload);
  });

  it("rejects payloads authenticated with another key", () => {
    const encrypted = encryptMailPayload({ text: "secret", html: "secret" }, Buffer.alloc(32, 1));

    expect(() => decryptMailPayload(encrypted, Buffer.alloc(32, 2))).toThrow();
  });
});
