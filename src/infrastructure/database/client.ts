import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getDatabaseEnvironment } from "@/shared/config/runtime-env";

const globalDatabase = globalThis as typeof globalThis & {
  nextbufPrisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const environment = getDatabaseEnvironment();
  const adapter = new PrismaPg({
    connectionString: environment.DATABASE_URL,
    max: environment.DATABASE_POOL_SIZE,
    statement_timeout: environment.DATABASE_STATEMENT_TIMEOUT_MS,
  });

  return new PrismaClient({ adapter });
}

export function getPrismaClient(): PrismaClient {
  globalDatabase.nextbufPrisma ??= createPrismaClient();
  return globalDatabase.nextbufPrisma;
}

/** @internal Test-only hook for isolated integration database contexts. */
export function overridePrismaClientForTests(client: PrismaClient): () => void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Prisma client overrides are only available in tests");
  }

  const previous = globalDatabase.nextbufPrisma;
  globalDatabase.nextbufPrisma = client;
  let restored = false;

  return () => {
    if (restored) {
      throw new Error("Prisma client override has already been restored");
    }
    if (globalDatabase.nextbufPrisma !== client) {
      throw new Error("Prisma client override ownership was lost");
    }

    globalDatabase.nextbufPrisma = previous;
    restored = true;
  };
}

export async function disconnectPrismaClient(): Promise<void> {
  if (!globalDatabase.nextbufPrisma) {
    return;
  }

  await globalDatabase.nextbufPrisma.$disconnect();
  globalDatabase.nextbufPrisma = undefined;
}
