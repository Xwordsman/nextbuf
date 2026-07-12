import { loadLocalEnvironment } from "@/shared/config/load-local-env";

loadLocalEnvironment();

const { getPrismaClient, disconnectPrismaClient } =
  await import("@/infrastructure/database/client");
const prisma = getPrismaClient();
await prisma.systemState.upsert({
  where: { key: "development.seed" },
  create: { key: "development.seed", value: { applied: true } },
  update: { value: { applied: true } },
});
await disconnectPrismaClient();
