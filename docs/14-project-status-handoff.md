# 项目现状与交接

本文是每次开始开发、交接给其他开发者或交给 AI 前首先阅读的状态入口。它记录当前有效实现、验证边界和唯一下一阶段，不替代专题文档。

- 最后更新：2026-07-13
- 当前完成版本：`v0.7.0`
- 下一开发版本：`v0.8.0` 互动、搜索与内容发现
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

### `v0.5.0` 用户资料与账号中心

- `users` 增加从独立 PostgreSQL 序列 1000 起分配的不可变 UID、唯一用户名、用户名修改时间和注销申请时间；既有用户迁移为 `user_<UID>`。
- 新增一对一 `profiles` 和 `username_aliases`；迁移回填既有 Profile，数据库触发器覆盖 Better Auth 邮箱注册、OAuth 和未来受控用户创建入口。
- 用户名固定为 3-24 位小写 ASCII，以字母开头，只允许字母、数字和非连续内部下划线；包含服务端保留词、30 天修改冷却和永久历史别名。
- 邮箱注册必须提交用户名；OAuth 新用户由服务端生成合规且可用的随机后缀用户名。
- `/account` 提供头像、昵称、简介、主页、用户名、隐私、通知占位和 14 天可撤销注销申请；`/account/security` 继续管理密码和会话。
- 浏览器将头像居中裁剪为 512×512 WebP；服务端限制字节数、检查 PNG/JPEG/WebP 签名，并通过 `STORAGE_LOCAL_PATH` 的随机不可变键读写本地文件。
- 头像替换在数据库更新失败时清理新文件，成功后清理旧本地头像；媒体路由使用一年 immutable 缓存和 `nosniff`。
- `/u/[username]` 显示基本身份、公开资料、主页、注册时间和活动统计占位；历史用户名重定向到当前主页，未激活用户不可公开解析。
- 页头菜单与右栏显示真实昵称、`@username`、UID、头像和 `TL0`，不显示专业标签。
- 当前 `TL0` 只是初始身份呈现，不是持久化信任计算或授权来源；完整信任系统仍属于 `v0.10.0`。
- 注销请求重复提交不延长 14 天截止时间；本阶段不立即删除内容、凭证或历史用户名。决策见 [ADR-0009](./adr/0009-public-user-identity-and-avatar-storage.md)。

### `v0.6.0` 节点与主题

- 新增 `community_nodes`、`community_topics`、`community_posts`、`community_post_revisions`、`community_role_assignments` 和 `community_audit_events`，带完整外键、CHECK、唯一约束和查询索引。
- Topic 使用 UUID 内部主键和不可变递增数字公开编号；主题、position=1 首帖和 version=1 修订在同一 PostgreSQL 事务创建。
- 迁移初始化人工智能、建站开发、主机云服务、域名 DNS、运维网络和项目展示六个节点；节点支持排序、public/hidden 可见性和归档。
- 首页和节点页已删除演示 ViewModel，改为真实 PostgreSQL 主题流；支持最新、精华、30 天窗口计算热门和包含置顶/活动时间/编号的双向 opaque cursor。
- 实现 `/nodes`、`/nodes/[slug]`、`/topics/new`、`/topics/[number]`、`/topics/[number]/edit` 和 `/account/topics`。
- 实现草稿、纯文本预览、发布、编辑、节点移动、软删除、恢复、置顶、精华、关闭和隐藏；React 转义正文并保留换行，Markdown 尚未启用。
- 内容实际变化才增加不可变修订版本；节点移动和状态操作只写事务内社区审计，不制造伪修订。
- 发布规则：标题 6-120 字、正文 20-20000 字、最多 5 个 HTTP(S) 链接、每用户每小时最多 3 个主题；草稿每人最多 20 个。
- 发布频率在锁定用户行的 PostgreSQL 事务中检查，不能通过并发请求或清空 Redis 绕过。
- 授权骨架支持作者、节点版主、全局版主和管理员；版主不能读取或发布他人私有草稿，节点配置只允许管理员修改。
- 公开用户页主题统计已读取真实公开主题数；普通回复数继续为 0，因为回复属于 `v0.7.0`。

### `v0.7.0` 回复、编辑器和附件

- Topic 增加从 2 开始的 `next_post_position`；回复创建锁定作者与 Topic 行，在同一事务分配稳定唯一楼层、写初始修订/提及/附件引用、更新有效回复数和最后活动时间并记录审计。
- 普通回复支持同 Topic 引用、编辑、软删除、恢复和删除墓碑；删除不回收楼层。每用户每小时最多 20 条回复，关闭主题只允许节点版主、全局版主或管理员例外回复。
- 新增每用户/Topic 唯一回复草稿和 1.5 秒自动保存；显式主题/回复发布会取消尚未执行的保存并等待在途保存，避免发布后残留旧草稿。
- 主题首帖与回复统一使用服务端 GFM Markdown 预览/渲染；原始 HTML 禁用，危险协议移除，站外链接增加安全 rel，站外图片降级为链接，内部附件图片才允许嵌入。
- `@username` 解析为用户页链接，并为当前 active 用户持久化去重 Mention 事实；本版本不创建通知。
- 新增 local/S3 对象存储 Provider，头像复用同一存储边界。附件按签名识别 PNG/JPEG/WebP/PDF/UTF-8 文本/ZIP，检查 MIME、SHA-256、字节/像素限制和 active 上传者；每用户每小时最多 20 个上传。
- 原始附件永久保留到引用安全回收；图片由 Outbox Worker 生成去元数据 WebP 派生文件，失败状态和原因可追踪。
- 当前 Post、不可变 Revision 和 Draft 分别持久化附件引用；引用写入与延迟回收锁定同一 Attachment 行，无引用文件默认 24 小时后复查并回收。
- 主题页按实际 Post 每页 30 楼分页；首页“今日回复”、最新回复者和公开用户页回复统计读取真实 PostgreSQL 数据，在线成员仍保持明确空状态。
- 决策与回退边界见 [ADR-0010](./adr/0010-replies-markdown-attachment-pipeline.md)。

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

- 本地已通过：Prisma generate/validate、全部 5 份迁移冷启动检查、Prettier、ESLint、TypeScript、32 个单元测试、Worker/CLI 构建和 Next.js standalone 生产构建。
- 集成测试共 16 项：3 项运行时、6 项身份/资料、7 项社区；社区额外覆盖 8 个并发回复的楼层/计数、引用、提及、回复修订/删除恢复、草稿覆盖、关闭主题权限、文本/图片附件处理、失败追踪和历史修订附件保留。
- Playwright 共 6 项：5 项真实社区多视口/筛选/无障碍测试和 1 项注册、验证、Markdown/附件、回复/提及/引用、编辑/删除/恢复、会话与密码重置完整旅程。
- 当前开发机没有 Docker、Podman、本地 PostgreSQL 或 Redis，因此本地不能执行真实集成与 E2E；发布以 GitHub Actions 的 PostgreSQL 18、Redis 8、Mailpit 服务容器结果为最终门槛。
- 每次 Better Auth、Prisma、pg、BullMQ、ioredis、Nodemailer 或 Mailpit 升级都必须重新执行完整真实服务测试。

## 4. 当前真实数据边界

已经持久化：

- 用户 UUID、数字 UID、用户名、昵称、邮箱、邮箱验证、账号状态和注销申请时间。
- Profile 简介、主页与隐私偏好，用户名历史别名和本地头像文件。
- credential/OAuth 账号、会话和设备元数据。
- 验证记录、注册邀请码、身份审计、邮件投递与 Outbox。
- 节点、主题、position=1 首帖、稳定楼层回复、修订、提及、回复草稿、附件/引用关系、社区角色分配和社区审计。
- local/S3 对象中的头像、附件原件和图片派生文件；附件处理状态、校验和、尺寸和失败原因保存在 PostgreSQL。

仍是明确占位：

- 在线成员跟踪尚未实现，因此“当前在线”和在线成员列表为空。
- 浏览量字段已持久化，但尚未按原始 HTTP 请求直接累加；反滥用浏览统计留到互动阶段。

尚未实现：

- 持久化信任等级计算、真实用户活动统计和最终注销执行器。
- 点赞、收藏、关注、阅读状态、反滥用浏览统计、搜索索引、真实通知、治理和管理后台页面。
- 生产 Dockerfile、生产四容器 Compose、GHCR 镜像、`nextbufctl`、备份恢复和首次安装向导。

不得为尚未实现的在线状态或浏览统计重新引入演示数据。不得在 `v0.8.0` 提前实现通知、治理、后台页面或信任计算。

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
12. UID/用户名/别名/头像/注销语义遵循 ADR-0009；不得释放历史用户名或把当前固定 `TL0` 误当信任授权。
13. 主题遵循 ADR-0005：统一 Post、position=1 首帖、数字公开编号和不可变修订。
14. 回复、Markdown 与附件遵循 ADR-0010：楼层不复用，服务端安全渲染，当前/修订/草稿引用共同保护附件，Worker 保留原件并生成派生文件。

## 6. 下一步只做 `v0.8.0`

入口：[详细开发计划 v0.8.0](./09-detailed-development-plan.md#v080互动搜索与内容发现)

下一阶段增加单一点赞/取消点赞、主题收藏、用户/主题关注、阅读状态、反滥用浏览计数、PostgreSQL FTS/`pg_trgm` 搜索和热门算法 v1，并提供个人收藏、关注和参与内容列表。

`v0.8.0` 不提前实现真实通知投递、举报治理、管理后台页面、插件或信任计算。互动唯一性、隐私、浏览反滥用和搜索可重建边界必须由 PostgreSQL 事实与服务端授权保证，不能只做客户端按钮或 Redis 计数。

## 7. 文档优先级与交接规则

优先级：已接受 ADR和决策台账 > 当前详细开发计划 > 专题规范/运行手册 > 高层路线图 > 历史 UI 静态稿。

完成一个版本或中断开发时必须更新：当前版本、已完成、真实验证结果、已知问题、未提交变更、唯一下一步和阻断项。聊天记录不是项目状态的唯一来源。
