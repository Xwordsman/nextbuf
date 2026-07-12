import "server-only";

import { Buffer } from "node:buffer";
import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { getCommunityPermissions } from "@/modules/community/authorization.server";
import type {
  CommunityFeedFilter,
  CommunityHomeView,
  CommunityNodeIcon,
  CommunityNodeView,
  CommunityTopicStatus,
  CommunityTopicView,
} from "@/modules/community/contracts/home-view";
import { CommunityError } from "@/modules/community/errors";
import { isHotTopic } from "@/modules/community/topic-policy";

const publicTopicStatuses = ["published", "closed"];
const pageSize = 20;

type FeedCursor = {
  pinned: boolean;
  lastActivityAt: string;
  number: number;
};

type FeedDirection = "next" | "previous";

const topicInclude = {
  node: true,
  author: { select: { name: true, username: true, image: true } },
} satisfies Prisma.CommunityTopicInclude;

function validIcon(value: string): CommunityNodeIcon {
  const icons: CommunityNodeIcon[] = [
    "grid",
    "bot",
    "code",
    "server",
    "globe",
    "network",
    "sparkles",
  ];
  return icons.includes(value as CommunityNodeIcon) ? (value as CommunityNodeIcon) : "grid";
}

function cursorFromTopic(topic: {
  isPinned: boolean;
  lastActivityAt: Date;
  number: number;
}): FeedCursor {
  return {
    pinned: topic.isPinned,
    lastActivityAt: topic.lastActivityAt.toISOString(),
    number: topic.number,
  };
}

function encodeCursor(topic: { isPinned: boolean; lastActivityAt: Date; number: number }): string {
  return Buffer.from(JSON.stringify(cursorFromTopic(topic))).toString("base64url");
}

function decodeCursor(value?: string): FeedCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as FeedCursor;
    if (
      typeof parsed.pinned !== "boolean" ||
      !Number.isInteger(parsed.number) ||
      Number.isNaN(Date.parse(parsed.lastActivityAt))
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function withinPartition(cursor: FeedCursor, direction: FeedDirection) {
  const comparison = direction === "next" ? "lt" : "gt";
  return {
    OR: [
      { lastActivityAt: { [comparison]: new Date(cursor.lastActivityAt) } },
      {
        lastActivityAt: new Date(cursor.lastActivityAt),
        number: { [comparison]: cursor.number },
      },
    ],
  } satisfies Prisma.CommunityTopicWhereInput;
}

function cursorWhere(cursor: FeedCursor, direction: FeedDirection) {
  const within = withinPartition(cursor, direction);
  if (direction === "next") {
    return cursor.pinned
      ? ({
          OR: [{ isPinned: true, AND: within }, { isPinned: false }],
        } satisfies Prisma.CommunityTopicWhereInput)
      : ({ isPinned: false, AND: within } satisfies Prisma.CommunityTopicWhereInput);
  }
  return cursor.pinned
    ? ({ isPinned: true, AND: within } satisfies Prisma.CommunityTopicWhereInput)
    : ({
        OR: [{ isPinned: true }, { isPinned: false, AND: within }],
      } satisfies Prisma.CommunityTopicWhereInput);
}

function relativeTime(value: Date, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - value.getTime()) / 1000));
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return value.toLocaleDateString("zh-CN");
}

function topicStatuses(topic: {
  isPinned: boolean;
  isEssence: boolean;
  replyCount: number;
  viewCount: number;
  lastActivityAt: Date;
}): CommunityTopicStatus[] {
  return [
    ...(topic.isPinned ? (["pinned"] as const) : []),
    ...(isHotTopic(topic) ? (["hot"] as const) : []),
    ...(topic.isEssence ? (["essence"] as const) : []),
  ];
}

function toTopicView(
  topic: Prisma.CommunityTopicGetPayload<{ include: typeof topicInclude }>,
  now: Date,
): CommunityTopicView {
  return {
    id: topic.number,
    title: topic.title,
    nodeId: topic.node.slug,
    nodeName: topic.node.name,
    nodeColor: topic.node.color,
    authorName: topic.author.name,
    authorUsername: topic.author.username,
    authorAvatarUrl: topic.author.image,
    authorInitials: topic.author.name.trim().slice(0, 1).toLocaleUpperCase("zh-CN") || "U",
    createdLabel: relativeTime(topic.publishedAt ?? topic.createdAt, now),
    lastReplyLabel: relativeTime(topic.lastActivityAt, now),
    lastReplyBy: topic.author.name,
    views: topic.viewCount,
    replies: topic.replyCount,
    statuses: topicStatuses(topic),
  };
}

function filterWhere(filter: CommunityFeedFilter, now: Date): Prisma.CommunityTopicWhereInput {
  if (filter === "essence") return { isEssence: true };
  if (filter === "hot") {
    return {
      lastActivityAt: { gte: new Date(now.getTime() - 30 * 86_400_000) },
      OR: [{ replyCount: { gte: 5 } }, { viewCount: { gte: 100 } }],
    };
  }
  return {};
}

async function getFeedPage(input: {
  nodeId?: string;
  filter: CommunityFeedFilter;
  cursor?: string;
  direction: FeedDirection;
}) {
  const prisma = getPrismaClient();
  const now = new Date();
  const cursor = decodeCursor(input.cursor);
  const baseWhere: Prisma.CommunityTopicWhereInput = {
    status: { in: publicTopicStatuses },
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    ...filterWhere(input.filter, now),
  };
  const requestedWhere = cursor ? cursorWhere(cursor, input.direction) : {};
  const reverse = cursor && input.direction === "previous";
  const topics = await prisma.communityTopic.findMany({
    where: { AND: [baseWhere, requestedWhere] },
    include: topicInclude,
    orderBy: reverse
      ? [{ isPinned: "asc" }, { lastActivityAt: "asc" }, { number: "asc" }]
      : [{ isPinned: "desc" }, { lastActivityAt: "desc" }, { number: "desc" }],
    take: pageSize,
  });
  if (reverse) topics.reverse();

  const first = topics[0];
  const last = topics.at(-1);
  const [hasPrevious, hasNext, total] = await Promise.all([
    first
      ? prisma.communityTopic.findFirst({
          where: {
            AND: [baseWhere, cursorWhere(cursorFromTopic(first), "previous")],
          },
          select: { id: true },
        })
      : null,
    last
      ? prisma.communityTopic.findFirst({
          where: {
            AND: [baseWhere, cursorWhere(cursorFromTopic(last), "next")],
          },
          select: { id: true },
        })
      : null,
    prisma.communityTopic.count({ where: baseWhere }),
  ]);

  return {
    topics: topics.map((topic) => toTopicView(topic, now)),
    total,
    pagination: {
      previousCursor: first && hasPrevious ? encodeCursor(first) : null,
      nextCursor: last && hasNext ? encodeCursor(last) : null,
    },
  };
}

export async function getCommunityHomeView(input: {
  nodeSlug?: string;
  filter?: CommunityFeedFilter;
  cursor?: string;
  direction?: FeedDirection;
}): Promise<{ view: CommunityHomeView; activeNode: CommunityNodeView | null }> {
  const prisma = getPrismaClient();
  const nodes = await prisma.communityNode.findMany({
    where: { visibility: "public" },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { topics: { where: { status: { in: publicTopicStatuses } } } } },
    },
  });
  const active = input.nodeSlug ? nodes.find((node) => node.slug === input.nodeSlug) : undefined;
  if (input.nodeSlug && !active) throw new CommunityError("node_unavailable", 404);
  const filter = input.filter ?? "latest";
  const [feed, hotTopics, memberCount, topicCount] = await Promise.all([
    getFeedPage({
      nodeId: active?.id,
      filter,
      cursor: input.cursor,
      direction: input.direction ?? "next",
    }),
    prisma.communityTopic.findMany({
      where: {
        status: { in: publicTopicStatuses },
        ...filterWhere("hot", new Date()),
      },
      include: topicInclude,
      orderBy: [{ replyCount: "desc" }, { viewCount: "desc" }, { lastActivityAt: "desc" }],
      take: 3,
    }),
    prisma.user.count({ where: { status: "active" } }),
    prisma.communityTopic.count({ where: { status: { in: publicTopicStatuses } } }),
  ]);
  const nodeViews: CommunityNodeView[] = [
    {
      id: "all",
      name: "全部话题",
      description: "浏览社区全部公开话题。",
      color: "#18181b",
      icon: "grid",
      topicCount,
    },
    ...nodes.map((node) => ({
      id: node.slug,
      name: node.name,
      description: node.description,
      color: node.color,
      icon: validIcon(node.icon),
      topicCount: node._count.topics,
    })),
  ];

  return {
    activeNode: active
      ? {
          id: active.slug,
          name: active.name,
          description: active.description,
          color: active.color,
          icon: validIcon(active.icon),
          topicCount: active._count.topics,
        }
      : null,
    view: {
      nodes: nodeViews,
      topics: feed.topics,
      topicTotal: feed.total,
      hotTopics: hotTopics.map((topic) => toTopicView(topic, new Date())),
      pagination: feed.pagination,
      overview: [
        { label: "成员", value: memberCount.toLocaleString("zh-CN") },
        { label: "话题", value: topicCount.toLocaleString("zh-CN") },
        { label: "今日回复", value: "0" },
        { label: "当前在线", value: "0" },
      ],
      onlineMembers: [],
    },
  };
}

export async function listPublicNodes() {
  const prisma = getPrismaClient();
  return prisma.communityNode.findMany({
    where: { visibility: "public" },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { topics: { where: { status: { in: publicTopicStatuses } } } } },
    },
  });
}

export async function listWritableNodes() {
  return getPrismaClient().communityNode.findMany({
    where: { visibility: "public", archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { slug: true, name: true },
  });
}

export async function getTopicPageView(number: number, viewerId?: string) {
  const prisma = getPrismaClient();
  const topic = await prisma.communityTopic.findUnique({
    where: { number },
    include: {
      node: true,
      author: { select: { id: true, uid: true, username: true, name: true, image: true } },
      posts: {
        where: { position: 1 },
        take: 1,
        include: { revisions: { orderBy: { version: "desc" }, take: 10 } },
      },
    },
  });
  if (!topic || topic.posts.length !== 1) return null;
  const permissions = viewerId
    ? await getCommunityPermissions(prisma, viewerId, topic.nodeId)
    : null;
  const canModerate = permissions?.active === true && permissions.canModerate;
  const isAuthor = viewerId === topic.authorId;
  const canEdit = Boolean(
    permissions?.active && (isAuthor || (canModerate && topic.status !== "draft")),
  );
  if (!["published", "closed"].includes(topic.status) && !canEdit) return null;
  const post = topic.posts[0];
  if (!post) return null;

  return {
    id: topic.id,
    number: topic.number,
    title: topic.title,
    status: topic.status,
    isClosed: Boolean(topic.closedAt),
    isHidden: topic.status === "hidden",
    isPinned: topic.isPinned,
    isEssence: topic.isEssence,
    body: post.bodySource,
    revisionCount: post.revisionCount,
    revisions: post.revisions.map((revision) => ({
      version: revision.version,
      source: revision.source,
      reason: revision.reason,
      createdAt: revision.createdAt,
    })),
    node: { slug: topic.node.slug, name: topic.node.name, color: topic.node.color },
    author: {
      uid: topic.author.uid,
      username: topic.author.username,
      name: topic.author.name,
      image: topic.author.image,
      initials: topic.author.name.trim().slice(0, 1).toLocaleUpperCase("zh-CN") || "U",
    },
    createdAt: topic.createdAt,
    publishedAt: topic.publishedAt,
    editedAt: topic.editedAt,
    replyCount: topic.replyCount,
    viewCount: topic.viewCount,
    canEdit,
    canModerate,
    canRestore: canEdit && topic.status === "deleted",
  };
}

export async function getTopicEditorView(number: number, userId: string) {
  const topic = await getTopicPageView(number, userId);
  if (!topic) throw new CommunityError("topic_not_found", 404);
  if (!topic.canEdit) throw new CommunityError("forbidden", 403);
  return topic;
}

export async function listUserTopics(userId: string) {
  return getPrismaClient().communityTopic.findMany({
    where: { authorId: userId },
    include: { node: true },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
}
