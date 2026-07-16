import "server-only";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getAuthEnvironment } from "@/shared/config/runtime-env";

export type StorageDriver = "local" | "s3";

const objectKeyPattern = /^[a-z0-9][a-z0-9/_.-]{0,498}[a-z0-9]$/i;
let s3Client: S3Client | undefined;

function assertObjectKey(key: string): void {
  if (!objectKeyPattern.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error("Invalid storage object key");
  }
}

function localPath(key: string): string {
  assertObjectKey(key);
  const root = path.resolve(getAuthEnvironment().STORAGE_LOCAL_PATH);
  const target = path.resolve(root, key);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Storage path escaped its root");
  return target;
}

function getS3Client(): S3Client {
  const environment = getAuthEnvironment();
  s3Client ??= new S3Client({
    region: environment.S3_REGION,
    endpoint: environment.S3_ENDPOINT,
    forcePathStyle: environment.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: environment.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: environment.S3_SECRET_ACCESS_KEY ?? "",
    },
  });
  return s3Client;
}

export function getStorageDriver(): StorageDriver {
  return getAuthEnvironment().STORAGE_DRIVER;
}

export async function verifyObjectStorageConnection(): Promise<void> {
  const environment = getAuthEnvironment();
  if (environment.STORAGE_DRIVER === "s3") {
    await getS3Client().send(new HeadBucketCommand({ Bucket: environment.S3_BUCKET }));
    return;
  }
  const key = `nextbuf-connection-test-${randomUUID()}`;
  const target = localPath(key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "nextbuf", { flag: "wx" });
  await rm(target, { force: true });
}

export async function putObject(
  driver: StorageDriver,
  key: string,
  bytes: Uint8Array,
  contentType: string,
  overwrite = false,
): Promise<void> {
  assertObjectKey(key);
  if (driver === "local") {
    const target = localPath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: overwrite ? "w" : "wx" });
    return;
  }
  const environment = getAuthEnvironment();
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: environment.S3_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }),
  );
}

export async function readObject(driver: StorageDriver, key: string): Promise<Uint8Array | null> {
  assertObjectKey(key);
  if (driver === "local") {
    const bytes = await readFile(localPath(key)).catch(() => null);
    return bytes ? new Uint8Array(bytes) : null;
  }
  const environment = getAuthEnvironment();
  try {
    const response = await getS3Client().send(
      new GetObjectCommand({ Bucket: environment.S3_BUCKET, Key: key }),
    );
    return response.Body ? new Uint8Array(await response.Body.transformToByteArray()) : null;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw error;
  }
}

export async function deleteObject(driver: StorageDriver, key: string): Promise<void> {
  assertObjectKey(key);
  if (driver === "local") {
    await rm(localPath(key), { force: true });
    return;
  }
  const environment = getAuthEnvironment();
  await getS3Client().send(new DeleteObjectCommand({ Bucket: environment.S3_BUCKET, Key: key }));
}
