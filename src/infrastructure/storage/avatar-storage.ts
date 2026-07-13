import "server-only";

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { detectAvatarFormat, type AvatarFormat } from "@/infrastructure/storage/avatar-format";
import {
  deleteObject,
  getStorageDriver,
  putObject,
  readObject,
} from "@/infrastructure/storage/object-storage";

const avatarKeyPattern = /^[a-f0-9-]{36}\.(?:jpg|png|webp)$/;

export async function storeAvatar(bytes: Uint8Array, format: AvatarFormat): Promise<string> {
  const key = `${randomUUID()}.${format.extension}`;
  await putObject(getStorageDriver(), `avatars/${key}`, bytes, format.contentType);
  return key;
}

export async function readAvatar(key: string) {
  if (!avatarKeyPattern.test(key)) return null;
  const bytes = await readObject(getStorageDriver(), `avatars/${key}`);
  if (!bytes) return null;
  const format = detectAvatarFormat(bytes);
  return format ? { bytes: Buffer.from(bytes), contentType: format.contentType } : null;
}

export async function deleteAvatarFromUrl(url: string | null): Promise<void> {
  const prefix = "/api/media/avatars/";
  if (!url?.startsWith(prefix)) return;
  const key = url.slice(prefix.length);
  if (!avatarKeyPattern.test(key)) return;
  await deleteObject(getStorageDriver(), `avatars/${key}`);
}

export async function deleteStoredAvatar(key: string): Promise<void> {
  if (!avatarKeyPattern.test(key)) return;
  await deleteObject(getStorageDriver(), `avatars/${key}`);
}
