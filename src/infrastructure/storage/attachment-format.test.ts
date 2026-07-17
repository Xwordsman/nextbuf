import { describe, expect, it } from "vitest";
import {
  declaredTypeMatches,
  detectAttachmentFormat,
  sanitizeAttachmentName,
} from "@/infrastructure/storage/attachment-format";

describe("attachment format", () => {
  it("detects supported content from signatures instead of names", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\nbody\n%%EOF");
    expect(detectAttachmentFormat(pdf)?.contentType).toBe("application/pdf");
    expect(detectAttachmentFormat(new TextEncoder().encode("plain text"))?.contentType).toBe(
      "text/plain",
    );
    expect(detectAttachmentFormat(Uint8Array.from([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
  });

  it("checks declared MIME and sanitizes display names", () => {
    const format = detectAttachmentFormat(new TextEncoder().encode("plain text"));
    expect(format && declaredTypeMatches("text/plain", format)).toBe(true);
    expect(format && declaredTypeMatches("application/pdf", format)).toBe(false);
    expect(sanitizeAttachmentName("../unsafe\\name.exe", "txt")).toBe("_unsafe_name.txt");
    expect(sanitizeAttachmentName("report.PDF", "pdf")).toBe("report.pdf");
    expect(sanitizeAttachmentName("\u202ereport.exe", "pdf")).toBe("_report.pdf");
  });

  it("rejects truncated files that only contain a magic prefix", () => {
    expect(detectAttachmentFormat(Uint8Array.from([0xff, 0xd8, 0xff]))).toBeNull();
    expect(detectAttachmentFormat(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
    expect(detectAttachmentFormat(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
    expect(
      detectAttachmentFormat(
        Uint8Array.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x44, 0x41, 0x54, 0, 0,
          0, 0, 0, 0, 0, 0,
        ]),
      ),
    ).toBeNull();
  });
});
