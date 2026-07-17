import { detectAttachmentFormat } from "@/infrastructure/storage/attachment-format";

export type AvatarFormat = { extension: "jpg" | "png" | "webp"; contentType: string };

export function detectAvatarFormat(bytes: Uint8Array): AvatarFormat | null {
  const format = detectAttachmentFormat(bytes);
  if (
    !format ||
    (format.extension !== "jpg" && format.extension !== "png" && format.extension !== "webp")
  ) {
    return null;
  }
  return {
    extension: format.extension,
    contentType: format.contentType,
  };
}
