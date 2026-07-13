import "server-only";

import { Buffer } from "node:buffer";
import sharp from "sharp";
import { Prisma } from "@/generated/prisma/client";
import {
  createProcessedImageKey,
  readStoredAttachment,
  storeProcessedAttachment,
} from "@/infrastructure/storage/attachment-storage";
import { getAuthEnvironment } from "@/shared/config/runtime-env";
import { getErrorMessage } from "@/shared/errors/error-message";

type AttachmentDatabase = Prisma.TransactionClient;

async function lockAttachment(
  transaction: AttachmentDatabase,
  attachmentId: string,
): Promise<void> {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "community_attachments"
      WHERE "id" = CAST(${attachmentId} AS uuid) FOR UPDATE`,
  );
}

export async function processCommunityAttachment(
  transaction: AttachmentDatabase,
  attachmentId: string,
): Promise<Prisma.InputJsonObject> {
  await lockAttachment(transaction, attachmentId);
  const attachment = await transaction.communityAttachment.findUnique({
    where: { id: attachmentId },
  });
  if (!attachment) return { attachmentId, status: "missing" };
  if (attachment.status === "ready") return { attachmentId, status: "ready" };
  const driver = attachment.storageDriver as "local" | "s3";
  const original = await readStoredAttachment(driver, attachment.storageKey);
  if (!original) {
    await transaction.communityAttachment.update({
      where: { id: attachment.id },
      data: { status: "failed", processingError: "Original object is missing" },
    });
    return { attachmentId, status: "failed" };
  }

  try {
    if (attachment.kind === "file") {
      await transaction.communityAttachment.update({
        where: { id: attachment.id },
        data: { status: "ready", processingError: null },
      });
      return { attachmentId, status: "ready" };
    }

    const processedKey = createProcessedImageKey(attachment.id);
    const result = await sharp(Buffer.from(original), {
      limitInputPixels: getAuthEnvironment().ATTACHMENT_MAX_IMAGE_PIXELS,
      failOn: "warning",
    })
      .rotate()
      .webp({ quality: 85, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    await storeProcessedAttachment(driver, processedKey, result.data);
    await transaction.communityAttachment.update({
      where: { id: attachment.id },
      data: {
        status: "ready",
        processedKey,
        processedType: "image/webp",
        width: result.info.width,
        height: result.info.height,
        processingError: null,
      },
    });
    return { attachmentId, status: "ready" };
  } catch (error) {
    await transaction.communityAttachment.update({
      where: { id: attachment.id },
      data: { status: "failed", processingError: getErrorMessage(error).slice(0, 4_000) },
    });
    return { attachmentId, status: "failed" };
  }
}
