import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { getErrorMessage } from "@/shared/errors/error-message";

export const EXPECTED_DATABASE_MIGRATION = "20260712000000_runtime_foundation";

type MigrationHealthRow = {
  failedCount: bigint;
  expectedCount: bigint;
};

export type DependencyHealth = {
  ok: boolean;
  latencyMs: number;
  detail?: string;
};

export async function checkDatabaseHealth(): Promise<DependencyHealth> {
  const startedAt = performance.now();

  try {
    const prisma = getPrismaClient();
    await prisma.$queryRaw(Prisma.sql`SELECT 1`);
    const [migrationHealth] = await prisma.$queryRaw<MigrationHealthRow[]>(Prisma.sql`
      SELECT
        COUNT(*) FILTER (
          WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL
        ) AS "failedCount",
        COUNT(*) FILTER (
          WHERE "migration_name" = ${EXPECTED_DATABASE_MIGRATION}
            AND "finished_at" IS NOT NULL
            AND "rolled_back_at" IS NULL
        ) AS "expectedCount"
      FROM "_prisma_migrations"
    `);

    if (!migrationHealth || migrationHealth.failedCount > 0n) {
      throw new Error("database contains a failed migration");
    }

    if (migrationHealth.expectedCount !== 1n) {
      throw new Error(`required migration ${EXPECTED_DATABASE_MIGRATION} is not applied`);
    }

    return { ok: true, latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      detail: getErrorMessage(error),
    };
  }
}
