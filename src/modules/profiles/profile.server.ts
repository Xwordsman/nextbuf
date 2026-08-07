import "server-only";

import { getPrismaClient } from "@/infrastructure/database/client";

export async function getAccountProfile(userId: string) {
  const prisma = getPrismaClient();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { profile: true },
  });
  if (user.profile) return user;

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
    where: {
      username,
      OR: [{ status: "active" }, { status: "deleted", deletionFinalizedAt: { not: null } }],
    },
    include: {
      profile: true,
      trustState: { select: { currentLevel: true } },
      _count: {
        select: {
          communityTopics: {
            where: {
              status: { in: ["published", "closed"] },
              node: { visibility: "public" },
            },
          },
          communityPosts: {
            where: {
              position: { gt: 1 },
              status: "published",
              topic: {
                status: { in: ["published", "closed"] },
                node: { visibility: "public" },
              },
            },
          },
        },
      },
    },
  });
  if (user) return { user, redirected: false } as const;

  const alias = await prisma.usernameAlias.findUnique({
    where: { username },
    include: {
      user: {
        include: {
          profile: true,
          trustState: { select: { currentLevel: true } },
          _count: {
            select: {
              communityTopics: {
                where: {
                  status: { in: ["published", "closed"] },
                  node: { visibility: "public" },
                },
              },
              communityPosts: {
                where: {
                  position: { gt: 1 },
                  status: "published",
                  topic: {
                    status: { in: ["published", "closed"] },
                    node: { visibility: "public" },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  return alias &&
    (alias.user.status === "active" ||
      (alias.user.status === "deleted" && alias.user.deletionFinalizedAt !== null))
    ? ({ user: alias.user, redirected: true } as const)
    : null;
}
