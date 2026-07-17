export type AttachmentFormat = {
  extension: "jpg" | "png" | "webp" | "pdf" | "txt" | "zip";
  contentType:
    | "image/jpeg"
    | "image/png"
    | "image/webp"
    | "application/pdf"
    | "text/plain"
    | "application/zip";
  kind: "image" | "file";
};

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

function hasSequence(bytes: Uint8Array, sequence: number[], start = 0): boolean {
  const last = bytes.length - sequence.length;
  for (let index = Math.max(0, start); index <= last; index += 1) {
    if (sequence.every((value, offset) => bytes[index + offset] === value)) return true;
  }
  return false;
}

function ascii(bytes: Uint8Array): string {
  return new TextDecoder("ascii").decode(bytes);
}

function isPlainText(bytes: Uint8Array): boolean {
  if (
    bytes.length === 0 ||
    bytes.some((value) => value === 0 || (value < 0x20 && ![0x09, 0x0a, 0x0d].includes(value)))
  ) {
    return false;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function detectAttachmentFormat(bytes: Uint8Array): AttachmentFormat | null {
  if (
    bytes.length >= 24 &&
    hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) &&
    ascii(bytes.slice(12, 16)) === "IHDR"
  ) {
    return { extension: "png", contentType: "image/png", kind: "image" };
  }
  if (
    bytes.length >= 6 &&
    hasPrefix(bytes, [0xff, 0xd8, 0xff]) &&
    hasSequence(bytes, [0xff, 0xd9], 3)
  ) {
    return { extension: "jpg", contentType: "image/jpeg", kind: "image" };
  }
  if (
    bytes.length >= 16 &&
    ascii(bytes.slice(0, 4)) === "RIFF" &&
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8 <=
      bytes.length &&
    ascii(bytes.slice(8, 12)) === "WEBP" &&
    ["VP8 ", "VP8L", "VP8X"].includes(ascii(bytes.slice(12, 16)))
  ) {
    return { extension: "webp", contentType: "image/webp", kind: "image" };
  }
  if (
    bytes.length >= 12 &&
    /^%PDF-[12]\.[0-9]/u.test(ascii(bytes.slice(0, 8))) &&
    ascii(bytes.slice(Math.max(0, bytes.length - 1_024))).includes("%%EOF")
  ) {
    return { extension: "pdf", contentType: "application/pdf", kind: "file" };
  }
  if (
    bytes.length >= 22 &&
    (hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
      hasPrefix(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
      hasPrefix(bytes, [0x50, 0x4b, 0x07, 0x08])) &&
    hasSequence(bytes, [0x50, 0x4b, 0x05, 0x06], Math.max(0, bytes.length - 65_557))
  ) {
    return { extension: "zip", contentType: "application/zip", kind: "file" };
  }
  if (
    hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47]) ||
    hasPrefix(bytes, [0xff, 0xd8, 0xff]) ||
    ascii(bytes.slice(0, 4)) === "RIFF" ||
    hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46]) ||
    hasPrefix(bytes, [0x50, 0x4b])
  ) {
    return null;
  }
  if (isPlainText(bytes)) {
    return { extension: "txt", contentType: "text/plain", kind: "file" };
  }
  return null;
}

export function sanitizeAttachmentName(value: string, extension: string): string {
  const suffix = `.${extension.toLowerCase()}`;
  const normalized = value
    .normalize("NFKC")
    .replaceAll(/[\u0000-\u001f\u007f/\\\u202a-\u202e\u2066-\u2069]/gu, "_")
    .trim()
    .replace(/^[.\s]+/u, "")
    .replace(/[.\s]+$/u, "");
  const base = normalized.toLowerCase().endsWith(suffix)
    ? normalized.slice(0, -suffix.length)
    : normalized.replace(/\.[^.]*$/u, "");
  const safeBase = base.replace(/[.\s]+$/u, "").slice(0, 240 - suffix.length) || "attachment";
  return `${safeBase}${suffix}`;
}

export function declaredTypeMatches(declared: string, detected: AttachmentFormat): boolean {
  if (!declared || declared === "application/octet-stream") return true;
  return declared.toLowerCase() === detected.contentType;
}
