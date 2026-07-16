import { readdir } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";

type MigrationRow = {
  migrationName: string;
  finishedAt: Date | null;
  rolledBackAt: Date | null;
};

export type MigrationStatus = {
  ok: boolean;
  expected: string[];
  applied: string[];
  pending: string[];
  failed: string[];
  unexpected: string[];
  latestExpected: string | null;
  latestApplied: string | null;
};

export async function getExpectedMigrations(
  root = path.resolve(process.cwd(), "prisma", "migrations"),
): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && /^\d+_[a-z0-9_]+$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export async function getMigrationStatus(): Promise<MigrationStatus> {
  const [expected, rows] = await Promise.all([
    getExpectedMigrations(),
    getPrismaClient().$queryRaw<MigrationRow[]>(Prisma.sql`
      SELECT
        "migration_name" AS "migrationName",
        "finished_at" AS "finishedAt",
        "rolled_back_at" AS "rolledBackAt"
      FROM "_prisma_migrations"
      ORDER BY "migration_name" ASC
    `),
  ]);
  const failed = rows
    .filter((row) => !row.finishedAt && !row.rolledBackAt)
    .map((row) => row.migrationName);
  const applied = rows
    .filter((row) => row.finishedAt && !row.rolledBackAt)
    .map((row) => row.migrationName);
  const expectedSet = new Set(expected);
  const appliedSet = new Set(applied);
  const pending = expected.filter((migration) => !appliedSet.has(migration));
  const unexpected = applied.filter((migration) => !expectedSet.has(migration));
  return {
    ok: failed.length === 0 && pending.length === 0 && unexpected.length === 0,
    expected,
    applied,
    pending,
    failed,
    unexpected,
    latestExpected: expected.at(-1) ?? null,
    latestApplied: applied.at(-1) ?? null,
  };
}
