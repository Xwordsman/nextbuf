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
import { renderCommunityMarkdown } from "@/modules/community/markdown.server";
import { isHotTopic } from "@/modules/community/topic-policy";
import { listHotTopicIds } from "@/modules/interactions/discovery.server";

const publicTopicStatuses = ["published", "closed"];
const pageSize = 20;
const replyPageSize = 30;

type FeedCursor = {
  pinned: boolean;
  lastActivityAt: string;
  number: number;
};

type FeedDirection = "next" | "previous";

type HotFeedCursor = {
  offset: number;
  asOf: string;
};

const topicInclude = {
  node: true,
  author: { select: { name: true, username: true, image: true } },
  posts: {
    where: { position: { gt: 1 }, status: "published" },
    orderBy: { position: "desc" },
    take: 1,
    select: { author: { select: { name: true } } },
  },
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
  isUnread = false,
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
    lastReplyBy: topic.posts[0]?.author.name ?? topic.author.name,
    views: topic.viewCount,
    replies: topic.replyCount,
    statuses: topicStatuses(topic),
    isUnread,
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
  viewerId?: string;
}) {
  if (input.filter === "hot") return getHotFeedPage(input);
  const prisma = getPrismaClient();
  const now = new Date();
  const cursor = decodeCursor(input.cursor);
  const baseWhere: Prisma.CommunityTopicWhereInput = {
    status: { in: publicTopicStatuses },
    node: { visibility: "public" },
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

  const readStates = input.viewerId
    ? await prisma.interactionTopicReadState.findMany({
        where: { userId: input.viewerId, topicId: { in: topics.map((topic) => topic.id) } },
        select: { topicId: true, lastReadAt: true },
      })
    : [];
  const readByTopic = new Map(readStates.map((state) => [state.topicId, state.lastReadAt]));

  return {
    topics: topics.map((topic) => {
      const lastReadAt = readByTopic.get(topic.id);
      return toTopicView(
        topic,
        now,
        Boolean(input.viewerId && (!lastReadAt || lastReadAt < topic.lastActivityAt)),
      );
    }),
    total,
    pagination: {
      previousCursor: first && hasPrevious ? encodeCursor(first) : null,
      nextCursor: last && hasNext ? encodeCursor(last) : null,
    },
  };
}

function encodeHotCursor(cursor: HotFeedCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeHotCursor(value?: string): HotFeedCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as HotFeedCursor;
    if (
      !Number.isSafeInteger(parsed.offset) ||
      parsed.offset < 0 ||
      Number.isNaN(Date.parse(parsed.asOf))
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function getHotFeedPage(input: { nodeId?: string; cursor?: string; viewerId?: string }) {
  const prisma = getPrismaClient();
  const parsed = decodeHotCursor(input.cursor);
  const asOf = parsed ? new Date(parsed.asOf) : new Date();
  const offset = parsed?.offset ?? 0;
  const ranked = await listHotTopicIds({
    nodeId: input.nodeId,
    asOf,
    offset,
    limit: pageSize + 1,
  });
  const pageRows = ranked.slice(0, pageSize);
  const ids = pageRows.map((row) => row.id);
  const [unorderedTopics, total, readStates] = await Promise.all([
    prisma.communityTopic.findMany({ where: { id: { in: ids } }, include: topicInclude }),
    prisma.communityTopic.count({
      where: {
        status: { in: publicTopicStatuses },
        node: { visibility: "public" },
        ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      },
    }),
    input.viewerId
      ? prisma.interactionTopicReadState.findMany({
          where: { userId: input.viewerId, topicId: { in: ids } },
          select: { topicId: true, lastReadAt: true },
        })
      : [],
  ]);
  const topicById = new Map(unorderedTopics.map((topic) => [topic.id, topic]));
  const readByTopic = new Map(readStates.map((state) => [state.topicId, state.lastReadAt]));
  const topics = ids.flatMap((id) => {
    const topic = topicById.get(id);
    if (!topic) return [];
    const lastReadAt = readByTopic.get(id);
    return [
      toTopicView(
        topic,
        asOf,
        Boolean(input.viewerId && (!lastReadAt || lastReadAt < topic.lastActivityAt)),
      ),
    ];
  });

  return {
    topics,
    total,
    pagination: {
      previousCursor:
        offset > 0
          ? encodeHotCursor({ offset: Math.max(0, offset - pageSize), asOf: asOf.toISOString() })
          : null,
      nextCursor:
        ranked.length > pageSize
          ? encodeHotCursor({ offset: offset + pageSize, asOf: asOf.toISOString() })
          : null,
    },
  };
}

export async function getCommunityHomeView(input: {
  nodeSlug?: string;
  filter?: CommunityFeedFilter;
  cursor?: string;
  direction?: FeedDirection;
  viewerId?: string;
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [feed, hotTopics, memberCount, topicCount, todayReplyCount] = await Promise.all([
    getFeedPage({
      nodeId: active?.id,
      filter,
      cursor: input.cursor,
      direction: input.direction ?? "next",
      viewerId: input.viewerId,
    }),
    listHotTopicIds({ asOf: new Date(), limit: 3 }),
    prisma.user.count({ where: { status: "active" } }),
    prisma.communityTopic.count({
      where: { status: { in: publicTopicStatuses }, node: { visibility: "public" } },
    }),
    prisma.communityPost.count({
      where: {
        position: { gt: 1 },
        status: "published",
        createdAt: { gte: today },
        topic: { status: { in: publicTopicStatuses }, node: { visibility: "public" } },
      },
    }),
  ]);
  const hotTopicRows = await prisma.communityTopic.findMany({
    where: { id: { in: hotTopics.map((topic) => topic.id) } },
    include: topicInclude,
  });
  const hotTopicById = new Map(hotTopicRows.map((topic) => [topic.id, topic]));
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
      hotTopics: hotTopics.flatMap((ranked) => {
        const topic = hotTopicById.get(ranked.id);
        return topic ? [toTopicView(topic, new Date())] : [];
      }),
      pagination: feed.pagination,
      overview: [
        { label: "成员", value: memberCount.toLocaleString("zh-CN") },
        { label: "话题", value: topicCount.toLocaleString("zh-CN") },
        { label: "今日回复", value: todayReplyCount.toLocaleString("zh-CN") },
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

export async function getPublicTopicTitle(number: number): Promise<string | null> {
  const topic = await getPrismaClient().communityTopic.findUnique({
    where: { number },
    select: { title: true, status: true },
  });
  return topic && publicTopicStatuses.includes(topic.status) ? topic.title : null;
}

export async function getTopicPageView(number: number, viewerId?: string, requestedFrom = 2) {
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
  const canReply = Boolean(
    permissions?.active &&
    (topic.status === "published" || (topic.status === "closed" && canModerate)),
  );
  const replyFrom = Number.isSafeInteger(requestedFrom) && requestedFrom >= 2 ? requestedFrom : 2;
  const [replyRows, draft, topicInteractions] = await Promise.all([
    ["published", "closed"].includes(topic.status)
      ? prisma.communityPost.findMany({
          where: { topicId: topic.id, position: { gte: replyFrom } },
          orderBy: { position: "asc" },
          take: replyPageSize + 1,
          include: {
            author: { select: { id: true, uid: true, username: true, name: true, image: true } },
            quotedPost: {
              select: {
                position: true,
                status: true,
                bodySource: true,
                author: { select: { username: true, name: true } },
              },
            },
          },
        })
      : [],
    viewerId && canReply
      ? prisma.communityPostDraft.findUnique({
          where: { topicId_authorId: { topicId: topic.id, authorId: viewerId } },
          include: {
            quotedPost: { select: { position: true, author: { select: { name: true } } } },
          },
        })
      : null,
    viewerId
      ? Promise.all([
          prisma.interactionTopicBookmark.findUnique({
            where: { userId_topicId: { userId: viewerId, topicId: topic.id } },
            select: { userId: true },
          }),
          prisma.interactionTopicFollow.findUnique({
            where: { userId_topicId: { userId: viewerId, topicId: topic.id } },
            select: { userId: true },
          }),
        ])
      : Promise.resolve([null, null] as const),
  ]);
  const hasNextReplies = replyRows.length > replyPageSize;
  const visibleReplies = replyRows.slice(0, replyPageSize);
  const visiblePostIds = [post.id, ...visibleReplies.map((reply) => reply.id)];
  const viewerLikes = viewerId
    ? await prisma.interactionPostLike.findMany({
        where: { userId: viewerId, postId: { in: visiblePostIds } },
        select: { postId: true },
      })
    : [];
  const likedPostIds = new Set(viewerLikes.map((like) => like.postId));

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
    bodyHtml: renderCommunityMarkdown(post.bodySource),
    postId: post.id,
    likeCount: post.likeCount,
    liked: likedPostIds.has(post.id),
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
    bookmarkCount: topic.bookmarkCount,
    bookmarked: Boolean(topicInteractions[0]),
    followed: Boolean(topicInteractions[1]),
    canInteract: permissions?.active === true && publicTopicStatuses.includes(topic.status),
    lastVisiblePosition: visibleReplies.at(-1)?.position ?? 1,
    canEdit,
    canModerate,
    canRestore: canEdit && topic.status === "deleted",
    canReply,
    replyDraft: draft
      ? {
          body: draft.bodySource,
          quotedPosition: draft.quotedPost?.position ?? null,
          quotedAuthorName: draft.quotedPost?.author.name ?? null,
          updatedAt: draft.updatedAt,
        }
      : null,
    replies: visibleReplies.map((reply) => {
      const ownsReply = viewerId === reply.authorId;
      const canManageReply = Boolean(permissions?.active && (ownsReply || canModerate));
      const contentVisible =
        reply.status === "published" || (canModerate && reply.status === "hidden");
      return {
        id: reply.id,
        position: reply.position,
        status: reply.status,
        body: contentVisible ? reply.bodySource : "",
        bodyHtml: contentVisible ? renderCommunityMarkdown(reply.bodySource) : "",
        revisionCount: reply.revisionCount,
        likeCount: reply.likeCount,
        liked: likedPostIds.has(reply.id),
        createdAt: reply.createdAt,
        editedAt: reply.editedAt,
        author: {
          uid: reply.author.uid,
          username: reply.author.username,
          name: reply.author.name,
          image: reply.author.image,
          initials: reply.author.name.trim().slice(0, 1).toLocaleUpperCase("zh-CN") || "U",
        },
        quote: reply.quotedPost
          ? {
              position: reply.quotedPost.position,
              authorName: reply.quotedPost.author.name,
              authorUsername: reply.quotedPost.author.username,
              excerpt:
                reply.quotedPost.status === "deleted"
                  ? "该回复已删除"
                  : reply.quotedPost.bodySource.replace(/\s+/gu, " ").slice(0, 160),
            }
          : null,
        canEdit: canManageReply && reply.status === "published",
        canDelete: canManageReply && reply.status === "published",
        canRestore: canManageReply && reply.status === "deleted",
      };
    }),
    replyPagination: {
      from: replyFrom,
      previousFrom: replyFrom > 2 ? Math.max(2, replyFrom - replyPageSize) : null,
      nextFrom:
        hasNextReplies && visibleReplies.length > 0
          ? (visibleReplies.at(-1)?.position ?? replyFrom) + 1
          : null,
    },
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
