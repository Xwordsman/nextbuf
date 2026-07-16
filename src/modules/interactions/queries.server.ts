import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";

const publicTopicWhere = {
  status: { in: ["published", "closed"] },
  node: { visibility: "public" },
} satisfies Prisma.CommunityTopicWhereInput;

export async function listBookmarkedTopics(userId: string) {
  return getPrismaClient().interactionTopicBookmark.findMany({
    where: { userId, topic: publicTopicWhere },
    include: { topic: { include: { node: true, author: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function listFollowedTopics(userId: string) {
  return getPrismaClient().interactionTopicFollow.findMany({
    where: { userId, topic: publicTopicWhere },
    include: { topic: { include: { node: true, author: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function listFollowedUsers(userId: string) {
  return getPrismaClient().interactionUserFollow.findMany({
    where: { followerId: userId, followed: { status: "active" } },
    include: { followed: { include: { profile: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function listParticipatedTopics(userId: string) {
  return getPrismaClient().communityTopic.findMany({
    where: {
      ...publicTopicWhere,
      OR: [
        { authorId: userId },
        {
          posts: {
            some: { authorId: userId, position: { gt: 1 }, status: "published" },
          },
        },
      ],
    },
    include: { node: true, author: true },
    orderBy: { lastActivityAt: "desc" },
    take: 100,
  });
}

export async function getUserFollowSummary(viewerId: string | null, targetId: string) {
  const prisma = getPrismaClient();
  const [followers, following, viewerFollow] = await Promise.all([
    prisma.interactionUserFollow.count({ where: { followedId: targetId } }),
    prisma.interactionUserFollow.count({ where: { followerId: targetId } }),
    viewerId && viewerId !== targetId
      ? prisma.interactionUserFollow.findUnique({
          where: { followerId_followedId: { followerId: viewerId, followedId: targetId } },
          select: { followerId: true },
        })
      : null,
  ]);
  return {
    followers,
    following,
    followedByViewer: Boolean(viewerFollow),
    canFollow: Boolean(viewerId && viewerId !== targetId),
  };
}
