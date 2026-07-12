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

export async function disconnectPrismaClient(): Promise<void> {
  if (!globalDatabase.nextbufPrisma) {
    return;
  }

  await globalDatabase.nextbufPrisma.$disconnect();
  globalDatabase.nextbufPrisma = undefined;
}
