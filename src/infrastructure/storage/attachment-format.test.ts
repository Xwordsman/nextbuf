import { describe, expect, it } from "vitest";
import {
  declaredTypeMatches,
  detectAttachmentFormat,
  sanitizeAttachmentName,
} from "@/infrastructure/storage/attachment-format";

describe("attachment format", () => {
  it("detects supported content from signatures instead of names", () => {
    expect(
      detectAttachmentFormat(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]))?.contentType,
    ).toBe("application/pdf");
    expect(detectAttachmentFormat(new TextEncoder().encode("plain text"))?.contentType).toBe(
      "text/plain",
    );
    expect(detectAttachmentFormat(Uint8Array.from([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
  });

  it("checks declared MIME and sanitizes display names", () => {
    const format = detectAttachmentFormat(new TextEncoder().encode("plain text"));
    expect(format && declaredTypeMatches("text/plain", format)).toBe(true);
    expect(format && declaredTypeMatches("application/pdf", format)).toBe(false);
    expect(sanitizeAttachmentName("../unsafe\\name.txt", "txt")).toBe(".._unsafe_name.txt");
  });
});
