import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("object storage connection", () => {
  it("verifies local storage without leaving the probe object behind", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nextbuf-storage-"));
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "postgresql://nextbuf:secret@localhost:5432/nextbuf");
    vi.stubEnv("REDIS_URL", "redis://localhost:6379/0");
    vi.stubEnv("AUTH_SECRET", "nextbuf-test-auth-secret-at-least-32-characters");
    vi.stubEnv("MAIL_PAYLOAD_KEY", "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=");
    vi.stubEnv("SMTP_HOST", "localhost");
    vi.stubEnv("STORAGE_DRIVER", "local");
    vi.stubEnv("STORAGE_LOCAL_PATH", root);
    const { verifyObjectStorageConnection } =
      await import("@/infrastructure/storage/object-storage");

    try {
      await expect(verifyObjectStorageConnection()).resolves.toBeUndefined();
      await expect(readdir(root)).resolves.toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a regular file used as the local storage root", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "nextbuf-storage-blocked-"));
    const root = path.join(directory, "not-a-directory");
    await writeFile(root, "blocked");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "postgresql://nextbuf:secret@localhost:5432/nextbuf");
    vi.stubEnv("REDIS_URL", "redis://localhost:6379/0");
    vi.stubEnv("AUTH_SECRET", "nextbuf-test-auth-secret-at-least-32-characters");
    vi.stubEnv("MAIL_PAYLOAD_KEY", "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=");
    vi.stubEnv("SMTP_HOST", "localhost");
    vi.stubEnv("STORAGE_DRIVER", "local");
    vi.stubEnv("STORAGE_LOCAL_PATH", root);
    const { verifyObjectStorageConnection } =
      await import("@/infrastructure/storage/object-storage");

    try {
      await expect(verifyObjectStorageConnection()).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
