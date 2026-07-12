import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { logger } from "@/infrastructure/observability/logger";
import { runtimeEnv } from "@/shared/config/runtime-env";

export type CurrentAccountView = {
  name: string;
  email: string;
  image: string | null;
  initials: string;
  emailVerified: boolean;
};

export const getCurrentAccount = cache(async (): Promise<CurrentAccountView | null> => {
  if (
    runtimeEnv.NODE_ENV === "development" &&
    (!process.env.DATABASE_URL || !process.env.REDIS_URL || !process.env.AUTH_SECRET)
  ) {
    return null;
  }

  try {
    const session = await getAuth().api.getSession({ headers: await headers() });
    if (!session) return null;

    return {
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null,
      initials: session.user.name.trim().slice(0, 1).toLocaleUpperCase("zh-CN") || "U",
      emailVerified: session.user.emailVerified,
    };
  } catch (error) {
    if (runtimeEnv.NODE_ENV !== "development") throw error;
    logger.warn("Authentication session is unavailable in development");
    return null;
  }
});
