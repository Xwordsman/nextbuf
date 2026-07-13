import "server-only";

import { randomUUID } from "node:crypto";
import {
  deleteObject,
  getStorageDriver,
  putObject,
  readObject,
  type StorageDriver,
} from "@/infrastructure/storage/object-storage";

export function createAttachmentObjectKey(id: string, extension: string): string {
  return `attachments/original/${id}/${randomUUID()}.${extension}`;
}

export function createProcessedImageKey(id: string): string {
  return `attachments/processed/${id}.webp`;
}

export async function storeAttachment(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<StorageDriver> {
  const driver = getStorageDriver();
  await putObject(driver, key, bytes, contentType);
  return driver;
}

export async function storeProcessedAttachment(
  driver: StorageDriver,
  key: string,
  bytes: Uint8Array,
): Promise<void> {
  await putObject(driver, key, bytes, "image/webp", true);
}

export const readStoredAttachment = readObject;
export const deleteStoredAttachment = deleteObject;
