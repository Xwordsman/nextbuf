import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { HOT_SIGNAL_CAPS } from "@/modules/interactions/hot-score";

type HotTopicRow = { id: string; score: number };

export async function listHotTopicIds(input: {
  nodeId?: string;
  asOf: Date;
  offset?: number;
  limit: number;
}) {
  const nodeFilter = input.nodeId
    ? Prisma.sql`AND t."node_id" = ${input.nodeId}::uuid`
    : Prisma.empty;
  const offset = Math.max(0, input.offset ?? 0);
  const rows = await getPrismaClient().$queryRaw<HotTopicRow[]>(Prisma.sql`
    WITH signals AS (
      SELECT
        t."id",
        t."number",
        t."last_activity_at",
        COALESCE(t."published_at", t."created_at") AS "published_at",
        t."reply_count",
        t."bookmark_count",
        t."view_count",
        COUNT(DISTINCT p."author_id") FILTER (
          WHERE p."position" > 1 AND p."status" = 'published'
        )::INTEGER AS "participant_count",
        COALESCE(SUM(p."like_count") FILTER (WHERE p."status" = 'published'), 0)::INTEGER
          AS "like_count"
      FROM "community_topics" t
      INNER JOIN "community_nodes" n ON n."id" = t."node_id"
      LEFT JOIN "community_posts" p ON p."topic_id" = t."id"
      WHERE t."status" IN ('published', 'closed')
        AND n."visibility" = 'public'
        ${nodeFilter}
      GROUP BY t."id"
    ), ranked AS (
      SELECT
        s."id",
        s."number",
        s."last_activity_at",
        (
          1
          + 3 * LN(1 + LEAST(s."reply_count", ${HOT_SIGNAL_CAPS.replies}))
          + 4 * LN(1 + LEAST(s."participant_count", ${HOT_SIGNAL_CAPS.participants}))
          + 2 * LN(1 + LEAST(s."like_count", ${HOT_SIGNAL_CAPS.likes}))
          + 1.5 * LN(1 + LEAST(s."bookmark_count", ${HOT_SIGNAL_CAPS.bookmarks}))
          + 0.5 * LN(1 + LEAST(s."view_count", ${HOT_SIGNAL_CAPS.views}))
        ) / POWER(
          1 + GREATEST(
            0,
            EXTRACT(EPOCH FROM (${input.asOf}::timestamptz - s."published_at")) / 3600
          ) / 24,
          1.35
        ) AS "score"
      FROM signals s
    )
    SELECT "id", "score"::DOUBLE PRECISION AS "score"
    FROM ranked
    ORDER BY "score" DESC, "last_activity_at" DESC, "number" DESC
    OFFSET ${offset}
    LIMIT ${input.limit}
  `);
  return rows;
}
