import { Client } from "pg";
import { getDatabaseEnvironment } from "@/shared/config/runtime-env";
import { runNodePackageBinary } from "@/cli/process";
import {
  assertV1_0_0MigrationPrefix,
  getMigrationDatabaseSchema,
  getV1_0_0MigrationIdentity,
  type AppliedMigrationIdentity,
  V0_13_10_BASELINE_MIGRATIONS,
  V1_0_0_MIGRATIONS,
} from "@/cli/commands/migration-policy";

const V1_CANDIDATE_MIGRATIONS = [
  "20260730120000_account_deletion_finalization",
  "20260731120000_outbox_processed_status",
  "20260731180000_email_delivery_attempt_fencing",
] as const;

type CandidateMigrationName = (typeof V1_CANDIDATE_MIGRATIONS)[number];

type MigrationSchemaState = {
  hasMigrationTable: boolean;
  hasSystemStateTable: boolean;
  hasUsersTable: boolean;
};

type FailedMigrationRow = {
  migrationName: string;
  checksum: string;
};

type AccountDeletionConflictRow = {
  deletionScheduleConflict: boolean;
  tombstoneNamespaceConflict: boolean;
};

const CANDIDATE_MIGRATION_MARKERS = {
  "20260730120000_account_deletion_finalization": ["users", "deletion_finalized_at"],
  "20260731120000_outbox_processed_status": ["outbox_events", "processed_at"],
  "20260731180000_email_delivery_attempt_fencing": ["email_deliveries", "attempt_token"],
} as const satisfies Record<CandidateMigrationName, readonly [string, string]>;

async function configureDatabaseSchema(client: Client, connectionString: string): Promise<void> {
  await client.query("SELECT set_config('search_path', quote_ident($1), false)", [
    getMigrationDatabaseSchema(connectionString),
  ]);
}

async function getAppliedMigrations(client: Client): Promise<AppliedMigrationIdentity[]> {
  const applied = await client.query<AppliedMigrationIdentity>(`
    SELECT migration_name AS "migrationName", checksum
    FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL
      AND rolled_back_at IS NULL
    ORDER BY started_at ASC, migration_name ASC
  `);
  assertV1_0_0MigrationPrefix(applied.rows);
  return applied.rows;
}

function assertSupportedInitializedBaseline(
  applied: AppliedMigrationIdentity[],
  initialized: boolean,
): void {
  if (initialized && applied.length < V0_13_10_BASELINE_MIGRATIONS.length) {
    throw new Error(
      "Initialized database migration history predates the supported immutable v0.13.10 upgrade baseline; restore or upgrade through a supported release before retrying. No candidate migration was started.",
    );
  }
}

function candidateMigrationIndex(migrationName: string): number {
  return V1_0_0_MIGRATIONS.findIndex((migration) => migration.migrationName === migrationName);
}

async function getMigrationMarker(
  client: Client,
  migrationName: CandidateMigrationName,
): Promise<{ present: boolean; tableName: string; columnName: string }> {
  const [tableName, columnName] = CANDIDATE_MIGRATION_MARKERS[migrationName];
  const marker = await client.query<{ present: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = $1
          AND column_name = $2
      ) AS "present"
    `,
    [tableName, columnName],
  );
  return { present: marker.rows[0]?.present === true, tableName, columnName };
}

async function assertCandidateMigrationMarkers(
  client: Client,
  applied: AppliedMigrationIdentity[],
): Promise<void> {
  for (const migrationName of V1_CANDIDATE_MIGRATIONS) {
    const marker = await getMigrationMarker(client, migrationName);
    const shouldBePresent = applied.length > candidateMigrationIndex(migrationName);
    if (marker.present !== shouldBePresent) {
      throw new Error(
        `Database Schema marker ${marker.tableName}.${marker.columnName} does not match immutable migration history; restore or reconcile the database before retrying. No candidate migration was started.`,
      );
    }
  }
}

async function preflightV1Migrations(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await configureDatabaseSchema(client, connectionString);
    const stateResult = await client.query<MigrationSchemaState>(`
      SELECT
        to_regclass('users') IS NOT NULL AS "hasUsersTable",
        to_regclass('system_state') IS NOT NULL AS "hasSystemStateTable",
        to_regclass('_prisma_migrations') IS NOT NULL AS "hasMigrationTable"
    `);
    const state = stateResult.rows[0];
    if (!state) throw new Error("Database migration preflight returned no Schema state");

    if (!state.hasMigrationTable) {
      if (state.hasUsersTable || state.hasSystemStateTable) {
        throw new Error(
          "Database contains NextBuf tables without Prisma migration history; restore a supported backup before retrying. No candidate migration was started.",
        );
      }
      return;
    }

    const applied = await getAppliedMigrations(client);
    const initialized = state.hasSystemStateTable
      ? (
          await client.query<{ initialized: boolean }>(`
            SELECT EXISTS (
              SELECT 1 FROM "system_state" WHERE "key" = 'runtime.initialized'
            ) AS "initialized"
          `)
        ).rows[0]?.initialized === true
      : false;
    assertSupportedInitializedBaseline(applied, initialized);

    const failed = await client.query<FailedMigrationRow>(`
      SELECT migration_name AS "migrationName", checksum
      FROM "_prisma_migrations"
      WHERE finished_at IS NULL
        AND rolled_back_at IS NULL
      ORDER BY started_at ASC
    `);
    const failedMigration = failed.rows[0];
    if (failedMigration) {
      if (failed.rows.length !== 1) {
        throw new Error(
          "Multiple unresolved failed migrations block this upgrade. Restore a supported backup before retrying.",
        );
      }
      const expected = getV1_0_0MigrationIdentity(failedMigration.migrationName);
      const expectedIndex = candidateMigrationIndex(failedMigration.migrationName);
      if (
        !expected ||
        expected.checksum !== failedMigration.checksum ||
        expectedIndex !== applied.length ||
        !V1_CANDIDATE_MIGRATIONS.includes(failedMigration.migrationName as CandidateMigrationName)
      ) {
        throw new Error(
          `Unsupported or drifted failed migration ${failedMigration.migrationName} blocks this upgrade. Restore a supported backup before retrying.`,
        );
      }
      throw new Error(
        `Migration ${failedMigration.migrationName} is recorded as failed. After fixing the reported cause and confirming its PostgreSQL transaction rolled back, mark only this migration with nextbuf migrate --resolve-rolled-back ${failedMigration.migrationName}, then retry the upgrade.`,
      );
    }

    await assertCandidateMigrationMarkers(client, applied);
    const hasSupportedBaseline = applied.length >= V0_13_10_BASELINE_MIGRATIONS.length;
    const hasFinalizationMigration = applied.length > V0_13_10_BASELINE_MIGRATIONS.length;
    if (!state.hasUsersTable || hasFinalizationMigration || !hasSupportedBaseline) return;

    const conflictResult = await client.query<AccountDeletionConflictRow>(`
      SELECT
        EXISTS (
          SELECT 1
          FROM "users" AS user_account
          WHERE (
            lower(user_account."email") ~ '@deleted[.]invalid$'
            AND NOT (
              user_account."status" = 'deleted'
              AND lower(user_account."email") =
                'deleted+' || lower(user_account."id"::text) || '@deleted.invalid'
            )
          ) OR (
            lower(user_account."username") ~ '^deleted-'
            AND NOT (
              user_account."status" = 'deleted'
              AND lower(user_account."username") = 'deleted-' || user_account."uid"::text
            )
          )
        ) OR EXISTS (
          SELECT 1 FROM "username_aliases"
          WHERE lower("username") ~ '^deleted-'
        ) OR EXISTS (
          SELECT 1
          FROM "users" AS user_account
          INNER JOIN "username_aliases" AS alias
            ON alias."username" = user_account."username"
           AND alias."user_id" <> user_account."id"
          WHERE user_account."status" = 'deleted'
        ) AS "tombstoneNamespaceConflict",
        EXISTS (
          SELECT 1
          FROM "users"
          WHERE ("deletion_requested_at" IS NULL) <>
                ("deletion_scheduled_at" IS NULL)
        ) AS "deletionScheduleConflict"
    `);
    const conflicts = conflictResult.rows[0];
    if (conflicts?.tombstoneNamespaceConflict) {
      throw new Error(
        "v1.0.0 migration preflight found an occupied deleted identity namespace. Rename the conflicting email, username, or alias before retrying; no migration was started.",
      );
    }
    if (conflicts?.deletionScheduleConflict) {
      throw new Error(
        "v1.0.0 migration preflight found an account deletion request without a matching schedule (or the reverse). Repair the inconsistent request before retrying; no migration was started.",
      );
    }
  } finally {
    await client.end();
  }
}

async function preflightRolledBackResolution(
  connectionString: string,
  migrationName: CandidateMigrationName,
): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await configureDatabaseSchema(client, connectionString);
    const applied = await getAppliedMigrations(client);
    const expected = getV1_0_0MigrationIdentity(migrationName);
    const expectedIndex = candidateMigrationIndex(migrationName);
    if (!expected || expectedIndex !== applied.length) {
      throw new Error(
        `Migration ${migrationName} is not the next migration after the verified immutable history and cannot be resolved as rolled back.`,
      );
    }

    const failed = await client.query<{ checksum: string }>(
      `
        SELECT checksum
        FROM "_prisma_migrations"
        WHERE migration_name = $1
          AND finished_at IS NULL
          AND rolled_back_at IS NULL
      `,
      [migrationName],
    );
    if (failed.rows.length !== 1) {
      throw new Error(
        `Migration ${migrationName} is not recorded as failed and cannot be resolved as rolled back.`,
      );
    }
    if (failed.rows[0]?.checksum !== expected.checksum) {
      throw new Error(
        `Migration ${migrationName} has a checksum that differs from the immutable v1.0.0 release migration manifest and cannot be resolved as rolled back.`,
      );
    }

    const marker = await getMigrationMarker(client, migrationName);
    if (marker.present) {
      throw new Error(
        `Migration ${migrationName} left its committed Schema marker ${marker.tableName}.${marker.columnName}; do not mark it rolled back. Restore or reconcile the database before retrying.`,
      );
    }
    await assertCandidateMigrationMarkers(client, applied);
  } finally {
    await client.end();
  }
}

export async function migrate(args: string[] = []): Promise<void> {
  const environment = getDatabaseEnvironment();
  const connectionString = environment.DATABASE_DIRECT_URL ?? environment.DATABASE_URL;
  let prismaArguments = ["migrate", "deploy"];
  if (args.length > 0) {
    const migrationName = args[1];
    if (
      args.length !== 2 ||
      args[0] !== "--resolve-rolled-back" ||
      !migrationName ||
      !V1_CANDIDATE_MIGRATIONS.includes(migrationName as CandidateMigrationName)
    ) {
      throw new Error(
        `Usage: nextbuf migrate [--resolve-rolled-back <${V1_CANDIDATE_MIGRATIONS.join("|")}>]`,
      );
    }
    const supportedMigration = migrationName as CandidateMigrationName;
    await preflightRolledBackResolution(connectionString, supportedMigration);
    prismaArguments = ["migrate", "resolve", "--rolled-back", supportedMigration];
  } else {
    await preflightV1Migrations(connectionString);
  }

  const exitCode = await runNodePackageBinary("prisma/build/index.js", prismaArguments, {
    ...process.env,
    DATABASE_URL: connectionString,
  });

  if (exitCode !== 0) {
    throw new Error(`Prisma ${prismaArguments.join(" ")} failed with exit code ${exitCode}`);
  }
}
