import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { requireAdministrator } from "@/modules/admin/authorization.server";

type AdminContentListInput = {
  query?: string;
  status?: string;
  node?: string;
  page?: number;
  pageSize?: number;
};

async function getContentListContext(actorId: string, input: AdminContentListInput) {
  const prisma = getPrismaClient();
  await prisma.$transaction((transaction) => requireAdministrator(transaction, actorId));
  const query = input.query?.trim() ?? "";
  const page = Math.min(Math.max(input.page ?? 1, 1), 100);
  const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 50);
  const topicNumber = /^\d+$/.test(query) ? Number(query) : null;
  return { prisma, query, page, pageSize, topicNumber };
}

function topicFilters(input: AdminContentListInput, query: string, topicNumber: number | null) {
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
  return topicWhere;
}

function replyFilters(input: AdminContentListInput, query: string, topicNumber: number | null) {
  const replyWhere: Prisma.CommunityPostWhereInput = {
    position: { gt: 1 },
    ...(input.status && input.status !== "all" ? { status: input.status } : {}),
    ...(input.node || (topicNumber && Number.isSafeInteger(topicNumber))
      ? {
          topic: {
            ...(input.node ? { node: { slug: input.node } } : {}),
            ...(topicNumber && Number.isSafeInteger(topicNumber) ? { number: topicNumber } : {}),
          },
        }
      : {}),
    ...(query
      ? {
          OR: [
            { bodySource: { contains: query, mode: "insensitive" as const } },
            { author: { username: { contains: query, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
  return replyWhere;
}

export async function listAdminTopics(actorId: string, input: AdminContentListInput) {
  const { prisma, query, page, pageSize, topicNumber } = await getContentListContext(
    actorId,
    input,
  );
  const topicWhere = topicFilters(input, query, topicNumber);
  const skip = (page - 1) * pageSize;
  const [topics, topicCount, nodes] = await Promise.all([
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
    prisma.communityNode.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  return { topics, topicCount, nodes, page, pageSize };
}

export async function listAdminReplies(actorId: string, input: AdminContentListInput) {
  const { prisma, query, page, pageSize, topicNumber } = await getContentListContext(
    actorId,
    input,
  );
  const replyWhere = replyFilters(input, query, topicNumber);
  const skip = (page - 1) * pageSize;
  const [replies, replyCount, nodes] = await Promise.all([
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
  return { replies, replyCount, nodes, page, pageSize };
}

export async function getAdminNodes(actorId: string) {
  const prisma = getPrismaClient();
  await prisma.$transaction((transaction) => requireAdministrator(transaction, actorId));
  return prisma.communityNode.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { topics: true, roleAssignments: true } } },
  });
}
