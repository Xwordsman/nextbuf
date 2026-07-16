import { getMigrationStatus } from "@/infrastructure/database/migrations";
import { getErrorMessage } from "@/shared/errors/error-message";

export type DependencyHealth = {
  ok: boolean;
  latencyMs: number;
  detail?: string;
};

export async function checkDatabaseHealth(): Promise<DependencyHealth> {
  const startedAt = performance.now();

  try {
    const migration = await getMigrationStatus();
    if (migration.failed.length > 0) {
      throw new Error(`database contains failed migrations: ${migration.failed.join(", ")}`);
    }
    if (migration.pending.length > 0) {
      throw new Error(`database has pending migrations: ${migration.pending.join(", ")}`);
    }
    if (migration.unexpected.length > 0) {
      throw new Error(
        `database contains migrations not shipped by this release: ${migration.unexpected.join(", ")}`,
      );
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
