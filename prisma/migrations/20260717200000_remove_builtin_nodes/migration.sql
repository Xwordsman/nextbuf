-- Generic distributions must not impose NextBuf's original community categories.
-- Preserve every initialized or customized installation; only an empty database
-- whose six rows still exactly match the published seed is eligible for cleanup.
WITH "seeded_nodes" (
    "id", "slug", "name", "description", "color", "icon", "sort_order"
) AS (
    VALUES
        ('10000000-0000-4000-8000-000000000001'::uuid, 'ai', '人工智能', 'AI 模型、应用、工具与行业实践。', '#7c3aed', 'bot', 10),
        ('10000000-0000-4000-8000-000000000002'::uuid, 'site', '建站开发', '网站开发、产品设计与技术栈。', '#2563eb', 'code', 20),
        ('10000000-0000-4000-8000-000000000003'::uuid, 'host', '主机云服务', '服务器、VPS、云平台与托管服务。', '#0f766e', 'server', 30),
        ('10000000-0000-4000-8000-000000000004'::uuid, 'domain', '域名 DNS', '域名注册、交易、解析与 DNS。', '#c2410c', 'globe', 40),
        ('10000000-0000-4000-8000-000000000005'::uuid, 'ops', '运维网络', '系统运维、网络、安全与可观测性。', '#0369a1', 'network', 50),
        ('10000000-0000-4000-8000-000000000006'::uuid, 'showcase', '项目展示', '展示作品、开源项目与实践成果。', '#be185d', 'sparkles', 60)
)
DELETE FROM "community_nodes" AS "node"
USING "seeded_nodes" AS "seed"
WHERE NOT EXISTS (SELECT 1 FROM "users")
  AND "node"."id" = "seed"."id"
  AND "node"."slug" = "seed"."slug"
  AND "node"."name" = "seed"."name"
  AND "node"."description" = "seed"."description"
  AND "node"."color" = "seed"."color"
  AND "node"."icon" = "seed"."icon"
  AND "node"."sort_order" = "seed"."sort_order"
  AND "node"."visibility" = 'public'
  AND "node"."archived_at" IS NULL;
