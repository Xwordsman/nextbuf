import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { V1_0_0_MIGRATIONS } from "@/cli/commands/migration-policy";
import { runNodePackageBinary } from "@/cli/process";
import { PrismaClient } from "@/generated/prisma/client";
import { resetAuthForTests } from "@/infrastructure/auth/better-auth";
import { overrideRedisPrefixForTests } from "@/infrastructure/cache/keys";
import { overridePrismaClientForTests } from "@/infrastructure/database/client";
import { getDatabaseEnvironment, getRedisEnvironment } from "@/shared/config/runtime-env";

const globalIsolation = globalThis as typeof globalThis & {
  nextbufIsolatedDatabaseOwner?: symbol;
};

function acquireIsolationGuard(label: string): () => void {
  if (globalIsolation.nextbufIsolatedDatabaseOwner) {
    throw new Error("An isolated NextBuf database context is already active in this process");
  }

  const owner = Symbol(label);
  globalIsolation.nextbufIsolatedDatabaseOwner = owner;
  return () => {
    if (globalIsolation.nextbufIsolatedDatabaseOwner !== owner) {
      throw new Error("Isolated NextBuf database context ownership was lost");
    }
    globalIsolation.nextbufIsolatedDatabaseOwner = undefined;
  };
}

function isolatedDatabaseName(label: string): string {
  const normalized = label
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .slice(0, 20);
  return `nextbuf_test_${normalized || "database"}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function quoteDatabase(database: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(database)) {
    throw new Error(`Invalid isolated PostgreSQL database name: ${database}`);
  }
  return `"${database}"`;
}

function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  url.searchParams.delete("schema");
  return url.toString();
}

function withoutPrismaSchema(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.delete("schema");
  return url.toString();
}

async function deployMigrations(connectionString: string): Promise<void> {
  const exitCode = await runNodePackageBinary("prisma/build/index.js", ["migrate", "deploy"], {
    ...process.env,
    DATABASE_URL: connectionString,
    DATABASE_DIRECT_URL: connectionString,
  });
  if (exitCode !== 0) {
    throw new Error("Prisma migrate deploy failed for an isolated integration database");
  }
}

function createIsolatedPrismaClient(connectionString: string): PrismaClient {
  const environment = getDatabaseEnvironment();
  const adapter = new PrismaPg(
    {
      connectionString,
      max: environment.DATABASE_POOL_SIZE,
      statement_timeout: environment.DATABASE_STATEMENT_TIMEOUT_MS,
      options: "-c search_path=public",
    },
    { schema: "public" },
  );
  return new PrismaClient({ adapter });
}

export async function withIsolatedNextBufDatabase<T>(
  label: string,
  callback: (prisma: PrismaClient) => Promise<T>,
): Promise<T> {
  const environment = getDatabaseEnvironment();
  const releaseIsolationGuard = acquireIsolationGuard(label);
  const administrationUrl = withoutPrismaSchema(
    environment.DATABASE_DIRECT_URL ?? environment.DATABASE_URL,
  );
  const database = isolatedDatabaseName(label);
  const quotedDatabase = quoteDatabase(database);
  const directUrl = withDatabase(administrationUrl, database);
  const administration = new Client({ connectionString: administrationUrl });
  let administrationConnected = false;
  let databaseCreated = false;
  let prisma: PrismaClient | undefined;
  let restorePrisma: (() => void) | undefined;
  let restoreRedisPrefix: (() => void) | undefined;

  try {
    try {
      await administration.connect();
      administrationConnected = true;
      await administration.query(`CREATE DATABASE ${quotedDatabase}`);
      databaseCreated = true;
      await deployMigrations(directUrl);
      prisma = createIsolatedPrismaClient(directUrl);
      const connectionIdentity = await prisma.$queryRaw<
        Array<{ database: string; migrationCount: number; schema: string }>
      >`
        SELECT
          current_database() AS "database",
          current_schema() AS "schema",
          (
            SELECT COUNT(*)::integer
            FROM "_prisma_migrations"
            WHERE "finished_at" IS NOT NULL
              AND "rolled_back_at" IS NULL
          ) AS "migrationCount"
      `;
      if (
        connectionIdentity[0]?.database !== database ||
        connectionIdentity[0]?.schema !== "public" ||
        connectionIdentity[0]?.migrationCount !== V1_0_0_MIGRATIONS.length
      ) {
        throw new Error(
          `Isolated Prisma client did not reach the ${V1_0_0_MIGRATIONS.length}-migration database ${database}`,
        );
      }

      resetAuthForTests();
      restorePrisma = overridePrismaClientForTests(prisma);
      restoreRedisPrefix = overrideRedisPrefixForTests(
        `${getRedisEnvironment().REDIS_PREFIX}_${database}`,
      );
      return await callback(prisma);
    } finally {
      try {
        resetAuthForTests();
      } finally {
        try {
          await prisma?.$disconnect();
        } finally {
          try {
            if (administrationConnected && databaseCreated) {
              await administration.query(`DROP DATABASE IF EXISTS ${quotedDatabase} WITH (FORCE)`);
            }
          } finally {
            try {
              try {
                resetAuthForTests();
              } finally {
                try {
                  restorePrisma?.();
                } finally {
                  restoreRedisPrefix?.();
                }
              }
            } finally {
              if (administrationConnected) await administration.end();
            }
          }
        }
      }
    }
  } finally {
    releaseIsolationGuard();
  }
}
