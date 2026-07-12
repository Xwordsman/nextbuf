# 项目现状与交接

本文是每次开始开发、交接给其他开发者或交给 AI 前首先阅读的状态入口。它记录当前有效实现、验证边界和唯一下一阶段，不替代专题文档。

- 最后更新：2026-07-12
- 当前完成版本：`v0.2.0`
- 下一开发版本：`v0.3.0` 设计系统与页面框架
- 官方仓库：`https://github.com/Xwordsman/nextbuf`
- 当前工作名称：NextBuf

## 1. 已完成实现

### `v0.1.0` 工程与治理

- Next.js 16.2.10、React 19、Node.js 24、pnpm 11、TypeScript 严格模式和统一 `src/app`。
- ESLint、Prettier、Vitest、standalone 构建与 GitHub Actions CI。
- Zod 环境基础、结构化日志、AppError、request ID、首页、错误页、404、版本接口。
- AGPL-3.0-only、Section 7(b) `Powered by NextBuf`、DCO 1.1、贡献与安全政策。

### `v0.2.0` 运行时基础

- PostgreSQL 18 唯一数据库基线；Prisma 7.8.0、`@prisma/adapter-pg` 与初始 SQL 迁移。
- 初始基础表：`system_state`、`outbox_events`、`processed_jobs`、`worker_heartbeats`。
- Redis 8 与 BullMQ 5；缓存、限流和队列使用独立 key namespace。
- 一个仓库内的 Web、Worker、migrate、setup、doctor 入口；Worker/CLI 独立构建为 Node.js 24 ESM。
- 事务性 Outbox Dispatcher、稳定 BullMQ Job ID、数据库事务内幂等任务辅助和版本化处理器注册。
- Worker 心跳、优雅停止、重试与任务保留策略。
- `/health/live`、`/health/ready`、`/health/worker`；保留兼容入口 `/api/health/live`。
- 开发依赖 Compose 与独立测试 Compose，固定 `postgres:18-alpine`、`redis:8-alpine`。
- 真实 PostgreSQL/Redis 集成测试：迁移 readiness、setup 重复执行、Outbox 完整链路、幂等消费、Worker 停机恢复和 Redis 清空后的事实数据完整性。

## 2. 关键命令

```text
pnpm dev                         同时启动 Web 与 Worker
pnpm dev:web                     单独启动 Next.js
pnpm dev:worker                  单独监听 Worker
pnpm nextbuf setup               执行迁移并幂等初始化
pnpm nextbuf doctor              检查数据库、迁移、Redis 与 key namespace
pnpm nextbuf migrate             只部署已有迁移
pnpm build                       构建 Prisma Client、Worker/CLI、Next.js standalone
pnpm test                        不依赖外部服务的单元测试
pnpm test:integration            强制使用真实隔离 PostgreSQL/Redis
```

开发和集成测试完整步骤见 [本地开发手册](./11-local-development.md)。开发/测试 Compose 不是生产部署文件。

## 3. 已验证与验证边界

- 本地通过：Prisma Schema 校验与 Client 生成、格式、ESLint、TypeScript、单元测试、Worker/CLI 构建、Next.js standalone 构建、CLI usage。
- CI 必须通过：PostgreSQL 18/Redis 8 服务容器、空库迁移、setup 幂等、完整 Outbox/Worker 集成测试、Compose 语法和全部本地检查。
- 当前开发机没有 Docker、Podman、本地 PostgreSQL 或 Redis，因此真实服务结果以该版本 GitHub Actions run 为准。
- Prisma 选择已由 [ADR-0007](./adr/0007-prisma-7-driver-adapter.md) 接受；升级 Prisma、pg、BullMQ 或 ioredis 时必须重新执行真实服务验证。

## 4. 现在还没有什么

- 没有生产 Dockerfile、四容器生产 Compose、GHCR 镜像、`nextbufctl`、备份恢复或宝塔发布包；这些属于 `v0.12.0`。
- 没有注册登录、用户资料、节点、主题、回复、通知、治理或管理后台业务实现。
- 没有 Mailpit、SMTP、S3、搜索、OAuth 或认证密钥实现；配置参考中对应条目仍是后续合同。
- 没有 Playwright 和正式 UI 组件；`UI/index.html` 仍是 `v0.3.0` 的视觉来源。

不得把开发 Compose 当成公网生产方案，也不得因已有 Outbox 骨架而提前实现通知、邮件或未来插件事件。

## 5. 已确定且不得自行更改

1. Next.js 16.2.10、TypeScript、App Router、Node.js 24 LTS、pnpm。
2. PostgreSQL 18 是唯一官方数据库；Redis 8 + BullMQ。
3. Prisma 7 使用 PostgreSQL driver adapter，复杂能力允许受测试的参数化 SQL。
4. 模块化单体，前台、后台、API 和 Worker 同仓库，不拆 frontend/backend。
5. 一个应用镜像，Web 与 Worker 分进程；默认四个常驻容器。
6. PostgreSQL 是事实来源，Redis 可清空并恢复；关键异步意图通过 Outbox。
7. 管理角色、信任等级、专业声誉和交易信用分离。
8. V1 使用 Topic + 统一 Post，首帖为 `position=1`；只做单一点赞，不做标签和私信。
9. 核心许可证为 AGPL-3.0-only + Section 7(b) 页脚链接；贡献采用 DCO。
10. 每个完成阶段必须完整测试、更新本文、DCO sign-off、推送 `main`、创建注释标签并确认远程 CI。

## 6. 下一步只做 `v0.3.0`

入口：[详细开发计划 v0.3.0](./09-detailed-development-plan.md#v030设计系统与页面框架)

下一阶段把 `UI/index.html` 转换为真实 Next.js 页面外壳，建立 Tailwind/shadcn 设计 token、三栏响应式布局、导航、页脚、头像菜单、主题列表展示组件、状态页与 Playwright 多视口检查。

`v0.3.0` 不开发注册、用户资料持久化、节点/主题写入、回复、插件或交易。UI 可以使用明确的只读演示 ViewModel，但不能伪造已经存在的业务 API。

## 7. 实现时的文档优先级

1. 已接受 ADR。
2. [决策台账](./08-decisions-and-open-questions.md)中最新的已确定决策。
3. [详细开发计划](./09-detailed-development-plan.md)中当前版本范围。
4. 对应专题文档：架构、领域、安全、仓库、配置、开发、部署。
5. [高层路线图](./07-roadmap.md)。
6. `UI/index.html`，只决定已确认视觉，不决定后端规则。

## 8. 每次交接必须更新

完成一个版本或中断开发时更新：当前版本、已完成、验证结果、已知问题、未提交变更、唯一下一步和新阻断项。聊天记录不是项目状态的唯一来源。
