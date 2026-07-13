import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import sharp from "sharp";
import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { createOutboxEvent } from "@/infrastructure/outbox/create-event";
import {
  createAttachmentObjectKey,
  createProcessedImageKey,
  deleteStoredAttachment,
  readStoredAttachment,
  storeAttachment,
  storeProcessedAttachment,
} from "@/infrastructure/storage/attachment-storage";
import {
  declaredTypeMatches,
  detectAttachmentFormat,
  sanitizeAttachmentName,
} from "@/infrastructure/storage/attachment-format";
import { CommunityError } from "@/modules/community/errors";
import { requireActiveCommunityActor } from "@/modules/community/authorization.server";
import { getAuthEnvironment } from "@/shared/config/runtime-env";
import { getErrorMessage } from "@/shared/errors/error-message";

export const ATTACHMENT_PROCESS_TOPIC = "nextbuf.community.attachment.process";
export const ATTACHMENT_COLLECT_TOPIC = "nextbuf.community.attachment.collect";
export const MAX_ATTACHMENTS_PER_HOUR = 20;

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

function collectionDate(): Date {
  return new Date(Date.now() + getAuthEnvironment().ATTACHMENT_ORPHAN_GRACE_HOURS * 3_600_000);
}

export async function queueAttachmentCollection(
  transaction: AttachmentDatabase,
  attachmentId: string,
  key: string = randomUUID(),
): Promise<void> {
  await createOutboxEvent(transaction, {
    topic: ATTACHMENT_COLLECT_TOPIC,
    idempotencyKey: `community-attachment-collect:${attachmentId}:${key}`,
    payload: { attachmentId },
    availableAt: collectionDate(),
  });
}

export async function createCommunityAttachment(input: {
  uploaderId: string;
  bytes: Uint8Array;
  declaredType: string;
  originalName: string;
}) {
  const environment = getAuthEnvironment();
  if (input.bytes.length < 1 || input.bytes.length > environment.ATTACHMENT_MAX_UPLOAD_BYTES) {
    throw new CommunityError("attachment_too_large", 413, {
      maxBytes: environment.ATTACHMENT_MAX_UPLOAD_BYTES,
    });
  }
  const format = detectAttachmentFormat(input.bytes);
  if (!format || !declaredTypeMatches(input.declaredType, format)) {
    throw new CommunityError("invalid_attachment", 400);
  }
  const id = randomUUID();
  const storageKey = createAttachmentObjectKey(id, format.extension);
  const checksumSha256 = createHash("sha256").update(input.bytes).digest("hex");
  const originalName = sanitizeAttachmentName(input.originalName, format.extension);
  let storedDriver: "local" | "s3" | undefined;

  try {
    return await getPrismaClient().$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "users" WHERE "id" = CAST(${input.uploaderId} AS uuid) FOR UPDATE`,
      );
      await requireActiveCommunityActor(transaction, input.uploaderId);
      const recentUploads = await transaction.communityAttachment.count({
        where: {
          uploaderId: input.uploaderId,
          createdAt: { gte: new Date(Date.now() - 3_600_000) },
        },
      });
      if (recentUploads >= MAX_ATTACHMENTS_PER_HOUR) {
        throw new CommunityError("attachment_rate_limited", 429, { retryAfter: 3600 });
      }
      storedDriver = await storeAttachment(storageKey, input.bytes, format.contentType);
      const attachment = await transaction.communityAttachment.create({
        data: {
          id,
          uploaderId: input.uploaderId,
          storageDriver: storedDriver,
          storageKey,
          originalName,
          contentType: format.contentType,
          kind: format.kind,
          sizeBytes: input.bytes.length,
          checksumSha256,
          orphanedAt: new Date(),
        },
      });
      await createOutboxEvent(transaction, {
        topic: ATTACHMENT_PROCESS_TOPIC,
        idempotencyKey: `community-attachment-process:${id}`,
        payload: { attachmentId: id },
      });
      await queueAttachmentCollection(transaction, id, "initial");
      return attachment;
    });
  } catch (error) {
    if (storedDriver) await deleteStoredAttachment(storedDriver, storageKey);
    throw error;
  }
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

export async function collectCommunityAttachment(
  transaction: AttachmentDatabase,
  attachmentId: string,
): Promise<Prisma.InputJsonObject> {
  await lockAttachment(transaction, attachmentId);
  const attachment = await transaction.communityAttachment.findUnique({
    where: { id: attachmentId },
    include: { _count: { select: { posts: true, revisions: true, drafts: true } } },
  });
  if (!attachment) return { attachmentId, status: "missing" };
  const references =
    attachment._count.posts + attachment._count.revisions + attachment._count.drafts;
  if (references > 0) {
    if (attachment.orphanedAt) {
      await transaction.communityAttachment.update({
        where: { id: attachment.id },
        data: { orphanedAt: null },
      });
    }
    return { attachmentId, status: "retained", references };
  }
  const graceMs = getAuthEnvironment().ATTACHMENT_ORPHAN_GRACE_HOURS * 3_600_000;
  if (!attachment.orphanedAt || Date.now() - attachment.orphanedAt.getTime() < graceMs) {
    return { attachmentId, status: "waiting" };
  }
  const driver = attachment.storageDriver as "local" | "s3";
  await deleteStoredAttachment(driver, attachment.storageKey);
  if (attachment.processedKey) await deleteStoredAttachment(driver, attachment.processedKey);
  await transaction.communityAttachment.delete({ where: { id: attachment.id } });
  return { attachmentId, status: "collected" };
}

export async function getAttachmentDelivery(attachmentId: string, viewerId?: string) {
  const attachment = await getPrismaClient().communityAttachment.findUnique({
    where: { id: attachmentId },
    include: {
      posts: {
        include: { post: { include: { topic: { select: { status: true } } } } },
      },
    },
  });
  if (!attachment) return null;
  const owner = viewerId === attachment.uploaderId;
  const publiclyReferenced = attachment.posts.some(
    ({ post }) =>
      post.status === "published" && ["published", "closed"].includes(post.topic.status),
  );
  if (!owner && (!publiclyReferenced || attachment.status !== "ready")) return null;
  const driver = attachment.storageDriver as "local" | "s3";
  const processed = attachment.status === "ready" && attachment.processedKey;
  const bytes = await readStoredAttachment(
    driver,
    processed ? (attachment.processedKey ?? attachment.storageKey) : attachment.storageKey,
  );
  if (!bytes) return null;
  return {
    bytes: Buffer.from(bytes),
    contentType: processed
      ? (attachment.processedType ?? attachment.contentType)
      : attachment.contentType,
    fileName: attachment.originalName,
    kind: attachment.kind,
    inline: attachment.kind === "image" && Boolean(processed),
    cacheable: publiclyReferenced && attachment.status === "ready",
    status: attachment.status,
  };
}
