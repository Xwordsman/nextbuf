import { getDatabaseEnvironment } from "@/shared/config/runtime-env";
import { runNodePackageBinary } from "@/cli/process";

export async function migrate(): Promise<void> {
  const environment = getDatabaseEnvironment();
  const exitCode = await runNodePackageBinary("prisma/build/index.js", ["migrate", "deploy"], {
    ...process.env,
    DATABASE_URL: environment.DATABASE_DIRECT_URL ?? environment.DATABASE_URL,
  });

  if (exitCode !== 0) {
    throw new Error(`Prisma migrate deploy failed with exit code ${exitCode}`);
  }
}
