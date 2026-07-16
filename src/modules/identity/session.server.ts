import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { getPrismaClient } from "@/infrastructure/database/client";
import { logger } from "@/infrastructure/observability/logger";
import { runtimeEnv } from "@/shared/config/runtime-env";
import { getCommunityPermissions } from "@/modules/community/authorization.server";
import { getUnreadNotificationCount } from "@/modules/notifications/notifications.server";

export type CurrentAccountView = {
  name: string;
  username: string;
  uid: number;
  trustLevel: number;
  email: string;
  image: string | null;
  initials: string;
  emailVerified: boolean;
  unreadNotifications: number;
  isAdmin: boolean;
  canModerate: boolean;
};

const getCurrentSession = cache(async () => {
  if (
    runtimeEnv.NODE_ENV === "development" &&
    (!process.env.DATABASE_URL || !process.env.REDIS_URL || !process.env.AUTH_SECRET)
  ) {
    return null;
  }
  return getAuth().api.getSession({ headers: await headers() });
});

export const getCurrentUserId = cache(async () => (await getCurrentSession())?.user.id ?? null);

export const getCurrentAccount = cache(async (): Promise<CurrentAccountView | null> => {
  if (
    runtimeEnv.NODE_ENV === "development" &&
    (!process.env.DATABASE_URL || !process.env.REDIS_URL || !process.env.AUTH_SECRET)
  ) {
    return null;
  }

  try {
    const session = await getCurrentSession();
    if (!session) return null;
    const prisma = getPrismaClient();
    const [user, unreadNotifications, permissions] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: session.user.id },
        include: { trustState: { select: { currentLevel: true } } },
      }),
      getUnreadNotificationCount(session.user.id),
      getCommunityPermissions(prisma, session.user.id),
    ]);

    return {
      name: user.name,
      username: user.username,
      uid: user.uid,
      trustLevel: user.trustState?.currentLevel ?? 0,
      email: user.email,
      image: user.image,
      initials: user.name.trim().slice(0, 1).toLocaleUpperCase("zh-CN") || "U",
      emailVerified: user.emailVerified,
      unreadNotifications,
      isAdmin: permissions.isAdmin,
      canModerate: permissions.hasModerationRole,
    };
  } catch (error) {
    if (runtimeEnv.NODE_ENV !== "development") throw error;
    logger.warn("Authentication session is unavailable in development");
    return null;
  }
});
