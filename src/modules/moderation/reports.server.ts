import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { requireActiveCommunityActor } from "@/modules/community/authorization.server";
import { ModerationError } from "@/modules/moderation/errors";

export const MAX_REPORTS_PER_DAY = 10;
export type ReportReason = "spam" | "abuse" | "harassment" | "illegal" | "privacy" | "other";
export type ReportTarget =
  | { type: "topic"; number: number }
  | { type: "post"; number: number; position: number }
  | { type: "user"; username: string };

type ResolvedTarget = {
  type: "topic" | "post" | "user";
  key: string;
  topicId?: string;
  postId?: string;
  reportedUserId?: string;
  authorId: string;
  snapshot: Prisma.InputJsonObject;
};

async function resolveReportTarget(
  transaction: Prisma.TransactionClient,
  target: ReportTarget,
): Promise<ResolvedTarget> {
  if (target.type === "user") {
    const user = await transaction.user.findUnique({
      where: { username: target.username.toLowerCase() },
      select: { id: true, uid: true, username: true, name: true, status: true },
    });
    if (!user || user.status !== "active") throw new ModerationError("invalid_report", 400);
    return {
      type: "user",
      key: `user:${user.id}`,
      reportedUserId: user.id,
      authorId: user.id,
      snapshot: { uid: user.uid, username: user.username, name: user.name },
    };
  }
  const topic = await transaction.communityTopic.findUnique({
    where: { number: target.number },
    include: {
      node: { select: { id: true, slug: true, name: true, visibility: true } },
      posts:
        target.type === "post"
          ? {
              where: { position: target.position },
              take: 1,
              select: { id: true, authorId: true, position: true, status: true, bodySource: true },
            }
          : false,
    },
  });
  if (
    !topic ||
    topic.node.visibility !== "public" ||
    !["published", "closed"].includes(topic.status)
  ) {
    throw new ModerationError("invalid_report", 400);
  }
  if (target.type === "topic") {
    return {
      type: "topic",
      key: `topic:${topic.id}`,
      topicId: topic.id,
      authorId: topic.authorId,
      snapshot: {
        number: topic.number,
        title: topic.title,
        nodeSlug: topic.node.slug,
        nodeName: topic.node.name,
        authorId: topic.authorId,
      },
    };
  }
  const post = topic.posts[0];
  if (!post || post.status !== "published") throw new ModerationError("invalid_report", 400);
  return {
    type: "post",
    key: `post:${post.id}`,
    topicId: topic.id,
    postId: post.id,
    authorId: post.authorId,
    snapshot: {
      number: topic.number,
      title: topic.title,
      position: post.position,
      excerpt: post.bodySource.slice(0, 500),
      nodeSlug: topic.node.slug,
      nodeName: topic.node.name,
      authorId: post.authorId,
    },
  };
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function createModerationReport(input: {
  reporterId: string;
  target: ReportTarget;
  reason: ReportReason;
  details: string;
}) {
  try {
    return await getPrismaClient().$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "users" WHERE "id" = CAST(${input.reporterId} AS uuid) FOR UPDATE`,
      );
      await requireActiveCommunityActor(transaction, input.reporterId);
      const now = new Date();
      const reportsToday = await transaction.moderationReport.count({
        where: { reporterId: input.reporterId, createdAt: { gte: startOfUtcDay(now) } },
      });
      if (reportsToday >= MAX_REPORTS_PER_DAY) {
        throw new ModerationError("report_rate_limited", 429, { retryAfter: 86_400 });
      }
      const target = await resolveReportTarget(transaction, input.target);
      if (target.authorId === input.reporterId) {
        throw new ModerationError("invalid_report", 400);
      }
      const trustState = await transaction.trustUserState.findUnique({
        where: { userId: input.reporterId },
        select: { currentLevel: true },
      });
      const reporterTrustLevel = trustState?.currentLevel ?? 0;
      const weight = Math.min(3, 1 + Math.floor(reporterTrustLevel / 2));
      const moderationCase = await transaction.moderationCase.upsert({
        where: { activeTargetKey: target.key },
        create: {
          targetType: target.type,
          targetKey: target.key,
          activeTargetKey: target.key,
          topicId: target.topicId,
          postId: target.postId,
          reportedUserId: target.reportedUserId,
          priorityScore: weight,
          summary: input.reason,
          createdById: input.reporterId,
        },
        update: { priorityScore: { increment: weight } },
      });
      const report = await transaction.moderationReport.create({
        data: {
          reporterId: input.reporterId,
          caseId: moderationCase.id,
          targetType: target.type,
          targetKey: target.key,
          activeTargetKey: target.key,
          topicId: target.topicId,
          postId: target.postId,
          reportedUserId: target.reportedUserId,
          reason: input.reason,
          details: input.details.trim(),
          reporterTrustLevel,
          weight,
          snapshot: target.snapshot,
        },
      });
      return { report, caseNumber: moderationCase.number };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ModerationError("duplicate_report", 409);
    }
    throw error;
  }
}
