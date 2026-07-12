import "server-only";

import { getPrismaClient } from "@/infrastructure/database/client";

export async function getAccountProfile(userId: string) {
  const prisma = getPrismaClient();
  await prisma.profile.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { profile: true },
  });
}

export async function resolvePublicProfile(handle: string) {
  const prisma = getPrismaClient();
  const username = handle.toLowerCase();
  const user = await prisma.user.findUnique({
    where: { username, status: "active" },
    include: { profile: true },
  });
  if (user) return { user, redirected: false } as const;

  const alias = await prisma.usernameAlias.findUnique({
    where: { username },
    include: { user: { include: { profile: true } } },
  });
  return alias?.user.status === "active" ? ({ user: alias.user, redirected: true } as const) : null;
}
