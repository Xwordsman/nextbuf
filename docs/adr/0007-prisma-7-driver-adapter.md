# ADR-0007：Prisma 7 与 PostgreSQL Driver Adapter

- 状态：Accepted
- 日期：2026-07-12

## 背景

NextBuf 已确定 PostgreSQL 18、Node.js 24、Next.js 16 standalone 和独立 Worker。ORM 需要同时服务 Web、Worker、CLI、迁移与后续复杂社区查询，不能只在 Next.js 开发服务器中可用。

## 决策

使用 Prisma 7，并通过 `@prisma/adapter-pg` 与 `pg` 连接 PostgreSQL。Prisma 管理常规模型、Client 类型和迁移历史；全文索引、特殊约束或 Prisma 难以表达的查询允许使用受测试的手写 SQL 迁移与参数化查询。

Prisma Client 生成到 `src/generated/prisma`，不提交生成文件；安装、检查和构建前统一执行 `prisma generate`。CLI 使用 `DATABASE_DIRECT_URL`（若提供）执行生产迁移，Web 与 Worker 使用 `DATABASE_URL`。

## 验证依据

- Prisma 7.8.0 的 Node engine 声明支持 Node.js 24。
- Schema 与初始迁移通过 Prisma 7 校验和 Client 生成。
- Next.js 16.2.10 standalone 构建通过。
- Worker 与 CLI 可由 tsup 构建为 Node.js 24 ESM 入口。
- CI 使用真实 PostgreSQL 18 与 Redis 8 执行迁移和完整 Outbox/Worker 集成测试。

## 影响

- 项目不承诺 MySQL 或其他 Prisma 数据源兼容。
- 升级 Prisma 主版本前必须重新验证迁移、生成代码、standalone、Worker 和真实 PostgreSQL。
- Driver adapter 与 BullMQ 等独立进程代码不能依赖只适用于 React Server Component 条件导出的模块。
- Prisma 无法合理表达的 PostgreSQL 能力必须有迁移、参数化和集成测试，不能用未转义字符串拼接 SQL。
