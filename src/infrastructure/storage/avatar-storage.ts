import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectAvatarFormat, type AvatarFormat } from "@/infrastructure/storage/avatar-format";
import { runtimeEnv } from "@/shared/config/runtime-env";

const avatarKeyPattern = /^[a-f0-9-]{36}\.(?:jpg|png|webp)$/;

function avatarDirectory(): string {
  return path.resolve(runtimeEnv.STORAGE_LOCAL_PATH, "avatars");
}

export async function storeAvatar(bytes: Uint8Array, format: AvatarFormat): Promise<string> {
  const key = `${randomUUID()}.${format.extension}`;
  await mkdir(avatarDirectory(), { recursive: true });
  await writeFile(path.join(avatarDirectory(), key), bytes, { flag: "wx" });
  return key;
}

export async function readAvatar(key: string) {
  if (!avatarKeyPattern.test(key)) return null;
  const bytes = await readFile(path.join(avatarDirectory(), key)).catch(() => null);
  if (!bytes) return null;
  const format = detectAvatarFormat(bytes);
  return format ? { bytes, contentType: format.contentType } : null;
}

export async function deleteAvatarFromUrl(url: string | null): Promise<void> {
  const prefix = "/api/media/avatars/";
  if (!url?.startsWith(prefix)) return;
  const key = url.slice(prefix.length);
  if (!avatarKeyPattern.test(key)) return;
  await rm(path.join(avatarDirectory(), key), { force: true });
}

export async function deleteStoredAvatar(key: string): Promise<void> {
  if (!avatarKeyPattern.test(key)) return;
  await rm(path.join(avatarDirectory(), key), { force: true });
}
