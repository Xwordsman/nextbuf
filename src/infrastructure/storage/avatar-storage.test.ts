import { describe, expect, it } from "vitest";
import { detectAvatarFormat } from "@/infrastructure/storage/avatar-format";

describe("avatar format detection", () => {
  it("accepts supported image signatures", () => {
    expect(detectAvatarFormat(Uint8Array.from([0xff, 0xd8, 0xff]))?.extension).toBe("jpg");
    expect(
      detectAvatarFormat(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))?.extension,
    ).toBe("png");
    expect(detectAvatarFormat(new TextEncoder().encode("RIFF0000WEBP"))?.extension).toBe("webp");
  });

  it("rejects content that only claims an image MIME type", () => {
    expect(detectAvatarFormat(new TextEncoder().encode("not an image"))).toBeNull();
  });
});
