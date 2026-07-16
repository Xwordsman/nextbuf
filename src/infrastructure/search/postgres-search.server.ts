import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import type {
  MemberSearchResult,
  NodeSearchResult,
  SearchProvider,
  TopicSearchResult,
} from "@/infrastructure/search/contracts";

type TopicRow = Omit<TopicSearchResult, "kind" | "excerpt"> & { body: string };
type MemberRow = Omit<MemberSearchResult, "kind">;
type NodeRow = Omit<NodeSearchResult, "kind">;

function likePattern(query: string): string {
  return `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function excerpt(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

async function searchTopics(query: string, limit: number): Promise<TopicSearchResult[]> {
  const pattern = likePattern(query);
  const rows = await getPrismaClient().$queryRaw<TopicRow[]>(Prisma.sql`
    WITH search_query AS (
      SELECT
        websearch_to_tsquery('simple', ${query}) AS "tsq",
        ${query}::text AS "raw",
        ${pattern}::text AS "pattern"
    ), matches AS (
      SELECT DISTINCT ON (t."id")
        t."id",
        t."number",
        t."title",
        p."body_source" AS "body",
        n."slug" AS "nodeSlug",
        n."name" AS "nodeName",
        u."username" AS "authorUsername",
        u."name" AS "authorName",
        t."reply_count" AS "replyCount",
        (
          4 * ts_rank_cd(to_tsvector('simple', t."title"), q."tsq")
          + ts_rank_cd(to_tsvector('simple', p."body_source"), q."tsq")
          + 2 * similarity(t."title", q."raw")
          + similarity(LEFT(p."body_source", 1000), q."raw")
        )::DOUBLE PRECISION AS "score"
      FROM "community_topics" t
      INNER JOIN "community_nodes" n ON n."id" = t."node_id"
      INNER JOIN "users" u ON u."id" = t."author_id"
      INNER JOIN "community_posts" p ON p."topic_id" = t."id" AND p."status" = 'published'
      CROSS JOIN search_query q
      WHERE t."status" IN ('published', 'closed')
        AND n."visibility" = 'public'
        AND (
          to_tsvector('simple', t."title") @@ q."tsq"
          OR to_tsvector('simple', p."body_source") @@ q."tsq"
          OR t."title" % q."raw"
          OR t."title" ILIKE q."pattern" ESCAPE '\\'
          OR p."body_source" ILIKE q."pattern" ESCAPE '\\'
        )
      ORDER BY t."id", "score" DESC, p."position" ASC
    )
    SELECT
      "number", "title", "body", "nodeSlug", "nodeName",
      "authorUsername", "authorName", "replyCount", "score"
    FROM matches
    ORDER BY "score" DESC, "number" DESC
    LIMIT ${limit}
  `);
  return rows.map((row) => ({ ...row, kind: "topic", excerpt: excerpt(row.body) }));
}

async function searchMembers(query: string, limit: number): Promise<MemberSearchResult[]> {
  const pattern = likePattern(query);
  const rows = await getPrismaClient().$queryRaw<MemberRow[]>(Prisma.sql`
    WITH search_query AS (
      SELECT
        websearch_to_tsquery('simple', ${query}) AS "tsq",
        ${query}::text AS "raw",
        ${pattern}::text AS "pattern"
    )
    SELECT
      u."username",
      u."name",
      u."image",
      CASE WHEN p."is_public" = TRUE THEN p."bio" ELSE '' END AS "bio",
      (
        4 * ts_rank_cd(to_tsvector('simple', u."username" || ' ' || u."name"), q."tsq")
        + 3 * similarity(u."username", q."raw")
        + 2 * similarity(u."name", q."raw")
        + CASE WHEN p."is_public" = TRUE
            THEN ts_rank_cd(to_tsvector('simple', p."bio"), q."tsq")
            ELSE 0 END
      )::DOUBLE PRECISION AS "score"
    FROM "users" u
    LEFT JOIN "profiles" p ON p."user_id" = u."id"
    CROSS JOIN search_query q
    WHERE u."status" = 'active'
      AND (
        to_tsvector('simple', u."username" || ' ' || u."name") @@ q."tsq"
        OR u."username" % q."raw"
        OR u."username" ILIKE q."pattern" ESCAPE '\\'
        OR u."name" ILIKE q."pattern" ESCAPE '\\'
        OR (p."is_public" = TRUE AND p."bio" ILIKE q."pattern" ESCAPE '\\')
      )
    ORDER BY "score" DESC, u."uid" ASC
    LIMIT ${limit}
  `);
  return rows.map((row) => ({ ...row, kind: "member" }));
}

async function searchNodes(query: string, limit: number): Promise<NodeSearchResult[]> {
  const pattern = likePattern(query);
  const rows = await getPrismaClient().$queryRaw<NodeRow[]>(Prisma.sql`
    WITH search_query AS (
      SELECT
        websearch_to_tsquery('simple', ${query}) AS "tsq",
        ${query}::text AS "raw",
        ${pattern}::text AS "pattern"
    )
    SELECT
      n."slug",
      n."name",
      n."description",
      n."color",
      COUNT(t."id") FILTER (WHERE t."status" IN ('published', 'closed'))::INTEGER AS "topicCount",
      (
        3 * ts_rank_cd(to_tsvector('simple', n."name" || ' ' || n."description"), q."tsq")
        + 3 * similarity(n."name", q."raw")
      )::DOUBLE PRECISION AS "score"
    FROM "community_nodes" n
    LEFT JOIN "community_topics" t ON t."node_id" = n."id"
    CROSS JOIN search_query q
    WHERE n."visibility" = 'public'
      AND (
        to_tsvector('simple', n."name" || ' ' || n."description") @@ q."tsq"
        OR n."name" % q."raw"
        OR n."name" ILIKE q."pattern" ESCAPE '\\'
        OR n."description" ILIKE q."pattern" ESCAPE '\\'
      )
    GROUP BY n."id", q."tsq", q."raw"
    ORDER BY "score" DESC, n."sort_order" ASC, n."name" ASC
    LIMIT ${limit}
  `);
  return rows.map((row) => ({ ...row, kind: "node" }));
}

export class PostgresSearchProvider implements SearchProvider {
  async search(input: Parameters<SearchProvider["search"]>[0]) {
    const perCategory = Math.min(Math.max(input.limit, 1), 50);
    const [topics, members, nodes] = await Promise.all([
      ["all", "topics"].includes(input.category)
        ? searchTopics(input.query, perCategory)
        : Promise.resolve([]),
      ["all", "members"].includes(input.category)
        ? searchMembers(input.query, perCategory)
        : Promise.resolve([]),
      ["all", "nodes"].includes(input.category)
        ? searchNodes(input.query, perCategory)
        : Promise.resolve([]),
    ]);
    return { topics, members, nodes };
  }
}
