import "server-only";

import { getPrismaClient } from "@/infrastructure/database/client";

export const INSTALLATION_COMPLETE_KEY = "installation.completed";

export async function isInstallationComplete(): Promise<boolean> {
  return Boolean(
    await getPrismaClient().systemState.findUnique({
      where: { key: INSTALLATION_COMPLETE_KEY },
      select: { key: true },
    }),
  );
}
