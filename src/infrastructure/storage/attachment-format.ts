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
  return prefix.every((value, index) => bytes[index] === value);
}

function isPlainText(bytes: Uint8Array): boolean {
  if (bytes.some((value) => value === 0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function detectAttachmentFormat(bytes: Uint8Array): AttachmentFormat | null {
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { extension: "png", contentType: "image/png", kind: "image" };
  }
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) {
    return { extension: "jpg", contentType: "image/jpeg", kind: "image" };
  }
  if (
    bytes.length >= 12 &&
    new TextDecoder("ascii").decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder("ascii").decode(bytes.slice(8, 12)) === "WEBP"
  ) {
    return { extension: "webp", contentType: "image/webp", kind: "image" };
  }
  if (hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { extension: "pdf", contentType: "application/pdf", kind: "file" };
  }
  if (
    hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    hasPrefix(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    hasPrefix(bytes, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return { extension: "zip", contentType: "application/zip", kind: "file" };
  }
  if (isPlainText(bytes)) {
    return { extension: "txt", contentType: "text/plain", kind: "file" };
  }
  return null;
}

export function sanitizeAttachmentName(value: string, extension: string): string {
  const normalized = value
    .normalize("NFKC")
    .replaceAll(/[\u0000-\u001f\u007f/\\]/gu, "_")
    .trim()
    .slice(0, 240);
  return normalized || `attachment.${extension}`;
}

export function declaredTypeMatches(declared: string, detected: AttachmentFormat): boolean {
  if (!declared || declared === "application/octet-stream") return true;
  return declared.toLowerCase() === detected.contentType;
}
