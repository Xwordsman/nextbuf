import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { requireAdministrator } from "@/modules/admin/authorization.server";

export async function listAdminContent(
  actorId: string,
  input: { query?: string; status?: string; node?: string; page?: number; pageSize?: number },
) {
  const prisma = getPrismaClient();
  await prisma.$transaction((transaction) => requireAdministrator(transaction, actorId));
  const query = input.query?.trim() ?? "";
  const page = Math.min(Math.max(input.page ?? 1, 1), 100);
  const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 50);
  const topicNumber = /^\d+$/.test(query) ? Number(query) : null;
  const topicWhere: Prisma.CommunityTopicWhereInput = {
    ...(input.status && input.status !== "all" ? { status: input.status } : {}),
    ...(input.node ? { node: { slug: input.node } } : {}),
    ...(query
      ? {
          OR: [
            ...(topicNumber && Number.isSafeInteger(topicNumber) ? [{ number: topicNumber }] : []),
            { title: { contains: query, mode: "insensitive" as const } },
            { author: { username: { contains: query, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
  const replyWhere: Prisma.CommunityPostWhereInput = {
    position: { gt: 1 },
    ...(input.status && input.status !== "all" ? { status: input.status } : {}),
    ...(input.node ? { topic: { node: { slug: input.node } } } : {}),
    ...(query
      ? {
          OR: [
            { bodySource: { contains: query, mode: "insensitive" as const } },
            { author: { username: { contains: query, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
  const skip = (page - 1) * pageSize;
  const [topics, topicCount, replies, replyCount, nodes] = await Promise.all([
    prisma.communityTopic.findMany({
      where: topicWhere,
      orderBy: { updatedAt: "desc" },
      skip,
      take: pageSize,
      include: {
        node: { select: { slug: true, name: true } },
        author: { select: { uid: true, username: true, name: true } },
      },
    }),
    prisma.communityTopic.count({ where: topicWhere }),
    prisma.communityPost.findMany({
      where: replyWhere,
      orderBy: { updatedAt: "desc" },
      skip,
      take: pageSize,
      include: {
        topic: {
          select: { number: true, title: true, node: { select: { slug: true, name: true } } },
        },
        author: { select: { uid: true, username: true, name: true } },
      },
    }),
    prisma.communityPost.count({ where: replyWhere }),
    prisma.communityNode.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  return { topics, topicCount, replies, replyCount, nodes, page, pageSize };
}

export async function getAdminNodes(actorId: string) {
  const prisma = getPrismaClient();
  await prisma.$transaction((transaction) => requireAdministrator(transaction, actorId));
  return prisma.communityNode.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { topics: true, roleAssignments: true } } },
  });
}
