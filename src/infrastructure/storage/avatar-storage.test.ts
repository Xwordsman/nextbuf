import { describe, expect, it } from "vitest";
import { detectAvatarFormat } from "@/infrastructure/storage/avatar-format";

describe("avatar format detection", () => {
  it("accepts supported image signatures", () => {
    expect(
      detectAvatarFormat(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]))?.extension,
    ).toBe("jpg");
    expect(
      detectAvatarFormat(
        Uint8Array.from([
          0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1,
          0, 0, 0, 1,
        ]),
      )?.extension,
    ).toBe("png");
    expect(
      detectAvatarFormat(
        Uint8Array.from([
          0x52, 0x49, 0x46, 0x46, 8, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c,
        ]),
      )?.extension,
    ).toBe("webp");
  });

  it("rejects content that only claims an image MIME type", () => {
    expect(detectAvatarFormat(new TextEncoder().encode("not an image"))).toBeNull();
    expect(detectAvatarFormat(Uint8Array.from([0xff, 0xd8, 0xff]))).toBeNull();
  });
});
