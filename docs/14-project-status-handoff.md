# 项目现状与交接

本文是每次开始开发、交接给其他开发者或交给 AI 前首先阅读的状态入口。它记录当前有效实现、验证边界和唯一下一阶段，不替代专题文档。

- 最后更新：2026-07-12
- 当前完成版本：`v0.4.0`
- 下一开发版本：`v0.5.0` 用户资料与账号中心
- 官方仓库：`https://github.com/Xwordsman/nextbuf`
- 当前工作名称：NextBuf

## 1. 已完成实现

### `v0.1.0` 工程与治理

- Next.js 16.2.10、React 19、Node.js 24、pnpm 11、TypeScript 严格模式和统一 `src/app`。
- ESLint、Prettier、Vitest、standalone 构建与 GitHub Actions CI。
- Zod 环境基础、结构化日志、AppError、request ID、首页、错误页、404、版本接口。
- AGPL-3.0-only、Section 7(b) `Powered by NextBuf`、DCO 1.1、贡献与安全政策。

### `v0.2.0` 运行时基础

- PostgreSQL 18、Prisma 7.8.0 与 `@prisma/adapter-pg`；Redis 8 与 BullMQ 5。
- Web、Worker、migrate、setup、doctor 入口；Worker/CLI 构建为 Node.js 24 ESM。
- 事务性 Outbox、稳定 BullMQ Job ID、数据库幂等任务、版本化处理器和 Worker 心跳。
- `/health/live`、`/health/ready`、`/health/worker` 与兼容入口 `/api/health/live`。
- PostgreSQL/Redis 开发与隔离测试 Compose，真实服务集成测试覆盖迁移、Outbox、幂等、Worker 重启和 Redis 可丢弃性。

### `v0.3.0` 设计系统与页面框架

- Tailwind CSS 4、Radix UI、Lucide、CVA 和可复用 UI 原语。
- 1380px 最大宽度、230px 左栏、300px 右栏、16px 间距的桌面三栏；1024px 双栏和 390px 单列响应式布局。
- 节点、主题列表、标题状态、分页、社区概览、热议、在线成员、状态页和真实页脚。
- 全局不可关闭的 `Powered by NextBuf`。
- 社区节点、主题、概览、热议和在线成员使用明确的只读演示 ViewModel，不写数据库。

### `v0.4.0` 注册、登录和账号安全

- Better Auth `1.6.23`、Prisma adapter、PostgreSQL 数据库会话和 scrypt 密码凭证；决策见 [ADR-0008](./adr/0008-better-auth.md)。
- 新增 `users`、`auth_sessions`、`auth_accounts`、`auth_verifications`、`registration_invites`、`identity_audit_events`、`email_deliveries` 及 SQL 约束/索引。
- 邮箱密码注册、邮箱验证、登录、退出、重新发送验证邮件、找回和重置密码。
- `/account/security` 服务端保护；查看设备会话，撤销单个、其他和全部会话；重置密码撤销全部旧会话。
- 注册策略支持 `open`、`invite`、`closed`；`pnpm nextbuf invite create` 生成只显示一次的邀请码，数据库只保存 HMAC。
- 公开注册入口为 `/api/identity/register`；Better Auth 底层邮箱注册要求内部 HMAC，不能绕过策略。
- 重复邮箱和内部注册失败使用统一接受响应；登录错误不泄露邮箱是否存在。
- 验证/重置 identifier 使用 HMAC-SHA256 后落库；Redis 限流 key 中的邮箱、IP 和认证标识同样不保存明文。
- Redis 原子 Lua 限流覆盖注册、登录、验证和重置。
- 身份邮件正文以 AES-256-GCM 加密写入 PostgreSQL，Outbox topic `nextbuf.identity.email.send@1` 由独立 Worker 通过 Nodemailer/SMTP 发送。
- 开发、测试和 CI 使用固定 `axllent/mailpit:v1.30.4`；Mailpit 不是生产常驻容器。
- GitHub 是首个可选 OAuth Provider，未配置不显示；非开放注册允许既有 OAuth 账号登录但禁止新建账号。
- 关键注册、验证、密码重置和会话事件进入身份审计；IP 仅保存 HMAC。
- 页头与右栏读取真实会话，只显示昵称、邮箱和验证状态；不伪造 UID、`@username`、TL 或通知。通知和发帖入口指向明确的未开放状态。
- 增加 CSP、HSTS（生产）、COOP、Referrer Policy、Permissions Policy、X-Frame-Options 和 nosniff。

## 2. 关键命令

```text
pnpm dev                         同时启动 Web 与 Worker
pnpm dev:web                     单独启动 Next.js
pnpm dev:worker                  单独监听 Worker
pnpm nextbuf setup               执行迁移并幂等初始化
pnpm nextbuf doctor              检查数据库、迁移、Redis 与 key namespace
pnpm nextbuf migrate             只部署已有迁移
pnpm nextbuf invite create ...   创建注册邀请码
pnpm build                       构建 Prisma Client、Worker/CLI、Next.js standalone
pnpm check                       格式、Lint、类型和单元测试
pnpm test:integration            PostgreSQL/Redis/Mailpit 真实集成测试
pnpm test:e2e                    standalone Web + Worker 身份与页面 E2E
```

开发 Compose 提供 PostgreSQL `5432`、Redis `6379`、Mailpit SMTP `1025` 和 Web `8025`。测试 Compose 使用 `55432`、`56379`、`11025` 和 `18025`，不得与开发或生产数据混用。

## 3. 测试与验证边界

- 本地已通过：Prisma generate/validate、Prettier、ESLint、TypeScript、13 个单元测试、Worker/CLI 构建和 Next.js standalone 生产构建。
- 身份集成测试共 5 项，连同运行时基础共 8 项：注册边界、scrypt、验证 identifier HMAC、密码重置撤销、重复注册防枚举、邀请码原子使用、加密邮件和 SMTP Worker。
- Playwright 共 6 项：5 项社区多视口/无障碍测试和 1 项注册、Mailpit 验证、两设备会话、找回密码、旧会话撤销、新密码登录完整旅程。
- 当前开发机没有 Docker、Podman、本地 PostgreSQL 或 Redis，因此本地不能执行真实集成与 E2E；发布以 GitHub Actions 的 PostgreSQL 18、Redis 8、Mailpit 服务容器结果为最终门槛。
- 每次 Better Auth、Prisma、pg、BullMQ、ioredis、Nodemailer 或 Mailpit 升级都必须重新执行完整真实服务测试。

## 4. 当前真实数据边界

已经持久化：

- 用户 UUID、昵称、邮箱、邮箱验证和账号状态。
- credential/OAuth 账号、会话和设备元数据。
- 验证记录、注册邀请码、身份审计、邮件投递与 Outbox。

仍是只读演示：

- 首页节点、主题、回复数/浏览数、社区概览、热议和在线成员。

尚未实现：

- UID、`@username`、Profile、头像上传、公开用户页、信任等级和用户活动统计。
- 节点/主题/回复写入、点赞、收藏、真实通知、搜索索引、治理和管理后台业务。
- 对象存储、生产 Dockerfile、生产四容器 Compose、GHCR 镜像、`nextbufctl`、备份恢复和首次安装向导。

不得把演示社区数据与真实身份数据混合后声称已完成社区业务持久化。不得提前在 v0.5 之外实现主题、通知或信任计算。

## 5. 已确定且不得自行更改

1. Next.js 16.2.10、TypeScript、App Router、Node.js 24、pnpm。
2. PostgreSQL 18 是唯一官方数据库；Redis 8 + BullMQ。
3. 模块化单体，前台、后台、API 和 Worker 同仓库，不拆 frontend/backend。
4. 一个应用镜像，Web 与 Worker 分进程；默认生产四个常驻容器。
5. Better Auth 是认证核心；密码、会话、验证、OAuth 或 Cookie 行为变更需要替代 ADR 和迁移计划。
6. PostgreSQL 是事实来源，Redis 可清空；关键异步意图通过 Outbox。
7. `AUTH_SECRET` 与 `MAIL_PAYLOAD_KEY` 独立保存；不得提交、复用或写入客户端变量。
8. 管理角色、信任等级、专业声誉和交易信用分离。
9. V1 使用 Topic + Post；只做单一点赞，不做用户标签和私信。
10. AGPL-3.0-only + Section 7(b) 页脚链接；贡献采用 DCO。
11. 每个完成阶段必须完整测试、更新文档、`git commit -s`、推送 `main`、等待 CI 成功并创建注释标签。

## 6. 下一步只做 `v0.5.0`

入口：[详细开发计划 v0.5.0](./09-detailed-development-plan.md#v050用户资料与账号中心)

下一阶段实现不可变数字 UID、唯一规范化 `@username`、用户名保留词与历史别名、头像存储接口、公开资料和用户页，并扩展账号中心。开始前必须先决定用户名字符范围、修改冷却期和历史保留期。

`v0.5.0` 可以扩展现有 `users` 或新增 `profiles` 等模型，但不能更改 Better Auth 所需字段语义，不能把 UID 当数据库主键或授权凭据，也不能开始节点/主题写入、回复、真实通知或信任计算。

## 7. 文档优先级与交接规则

优先级：已接受 ADR和决策台账 > 当前详细开发计划 > 专题规范/运行手册 > 高层路线图 > 历史 UI 静态稿。

完成一个版本或中断开发时必须更新：当前版本、已完成、真实验证结果、已知问题、未提交变更、唯一下一步和阻断项。聊天记录不是项目状态的唯一来源。
