import v0_13_10Baseline from "../../../prisma/migration-baselines/v0.13.10.json";
import v1_0_0Baseline from "../../../prisma/migration-baselines/v1.0.0.json";

export type AppliedMigrationIdentity = {
  migrationName: string;
  checksum: string;
};

export const V0_13_10_BASELINE_MIGRATIONS: AppliedMigrationIdentity[] =
  v0_13_10Baseline.migrations.map(({ name, sha256 }) => ({
    migrationName: name,
    checksum: sha256,
  }));

export const V0_13_10_LAST_MIGRATION = V0_13_10_BASELINE_MIGRATIONS.at(-1)!.migrationName;

export const V1_0_0_MIGRATIONS: AppliedMigrationIdentity[] = v1_0_0Baseline.migrations.map(
  ({ name, sha256 }) => ({
    migrationName: name,
    checksum: sha256,
  }),
);

export function assertV1_0_0MigrationPrefix(rows: AppliedMigrationIdentity[]): void {
  if (rows.length > V1_0_0_MIGRATIONS.length) {
    throw new Error(
      "Database migration history is not an exact prefix of the immutable v1.0.0 release migration manifest; restore a supported backup before retrying. No migration was started.",
    );
  }

  for (const [index, { migrationName, checksum }] of rows.entries()) {
    const expected = V1_0_0_MIGRATIONS[index];
    if (expected?.migrationName !== migrationName || expected.checksum !== checksum) {
      throw new Error(
        "Database migration history is not an exact prefix of the immutable v1.0.0 release migration manifest; restore a supported backup before retrying. No migration was started.",
      );
    }
  }
}

export function getV1_0_0MigrationIdentity(
  migrationName: string,
): AppliedMigrationIdentity | undefined {
  return V1_0_0_MIGRATIONS.find((migration) => migration.migrationName === migrationName);
}

export function getMigrationDatabaseSchema(connectionString: string): string {
  const schema = new URL(connectionString).searchParams.get("schema")?.trim();
  return schema || "public";
}

export function assertV0_13_10MigrationBaseline(rows: AppliedMigrationIdentity[]): void {
  if (rows.length !== V0_13_10_BASELINE_MIGRATIONS.length) {
    throw new Error(
      "Database migration history does not exactly match the immutable v0.13.10 upgrade baseline; restore a supported backup before retrying. No candidate migration was started.",
    );
  }

  for (const [index, { migrationName, checksum }] of V0_13_10_BASELINE_MIGRATIONS.entries()) {
    const row = rows[index];
    if (row?.migrationName !== migrationName || row.checksum !== checksum) {
      throw new Error(
        "Database migration history does not exactly match the immutable v0.13.10 upgrade baseline; restore a supported backup before retrying. No candidate migration was started.",
      );
    }
  }
}
