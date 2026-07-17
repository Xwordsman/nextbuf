# 项目现状与交接

本文是每次开始开发、交接给其他开发者或交给 AI 前首先阅读的状态入口。它记录当前有效实现、验证边界和唯一下一阶段，不替代专题文档。

- 最后更新：2026-07-16
- 当前完成版本：`v0.12.0`
- 下一开发版本：`v0.13.0` 公开 Beta 加固
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
- standalone Web 通过 `scripts/start-standalone.mjs` 启动：在 Next.js 改变工作目录前加载根 `.env` 并固定相对本地存储路径，保证 Web 与独立 Worker 共享同一附件目录。
- 主题页按实际 Post 每页 30 楼分页；首页“今日回复”、最新回复者和公开用户页回复统计读取真实 PostgreSQL 数据，在线成员仍保持明确空状态。
- 决策与回退边界见 [ADR-0010](./adr/0010-replies-markdown-attachment-pipeline.md)。

### `v0.8.0` 互动、搜索与内容发现

- 新增 Post 单一点赞、主题收藏、用户关注、主题关注和每用户/Topic 阅读状态；全部关系由 PostgreSQL 复合主键、外键和 CHECK 约束兜底，重复 `PUT/DELETE` 不重复改变派生计数。
- 主题页显示真实点赞、收藏和关注状态；用户页支持关注并显示真实关注者/正在关注计数；账号中心新增 `/account/bookmarks`、`/account/following` 和 `/account/activity`。
- 登录主题流根据阅读时间与最后活动时间显示“有新内容”；最大已读楼层只前进不后退。
- 主题浏览通过登录用户或匿名 IP/用户代理的领域分离 HMAC 去标识化；同一 Topic/访问者/30 分钟桶只接受一次，原始值不落库。
- 接受浏览与 `nextbuf.interactions.topic-view.aggregate@1` Outbox 在同一事务写入；独立 Worker 幂等增加 `view_count`，并限量清理 30 天前已聚合桶。Redis 清空不丢互动或浏览事实。
- 热门算法 v1 使用有上限的回复、独立参与者、点赞、收藏、去重浏览和 24 小时时间衰减；分数查询时计算，不存在管理员可写 `is_hot/hot_score`。
- 迁移启用 `pg_trgm` 并为标题、Markdown 源正文、用户公开身份/简介和节点建立 FTS/Trigram GIN 索引。
- `/search` 和页头搜索使用 `PostgresSearchProvider` 参数化查询；结果只包含 public Node、`published/closed` Topic、published Post 和 active 用户，私有简介不展示。
- 个人列表、主题按钮、用户关注和搜索进入真实浏览器旅程；热门公式有纯领域单元测试，互动并发幂等、浏览 Worker、搜索可见性和热门排序有真实 PostgreSQL 集成测试。
- 决策、公式、隐私、保留和回退边界见 [ADR-0011](./adr/0011-interactions-search-discovery.md)。

### `v0.9.0` 通知、邮件和 Worker 完整链路

- 新增结构化 Notification、按类型的 NotificationPreference 和 `in_app`/`email` 渠道投递记录；缺省站内开启、普通邮件关闭，安全邮件不读取普通通知偏好。
- 回复事务写入版本化通知 Outbox；Worker 从真实 Post/Mention/TopicFollow 事实生成通知。同一 Post/接收者只生成一条，按提及、直接回复、关注主题回复决定优先级并排除本人。
- 主题管理动作向非本人作者生成管理通知；快照只保存稳定渲染所需的触发者公开身份、主题编号/标题、楼层和动作，不保存最终不可解释文案。
- `/notifications` 提供真实未读计数、全部/未读列表、单条已读、全部已读和归档；`/account/notifications` 保存站内/邮件渠道偏好，页头铃铛显示真实未读数。
- 普通通知邮件复用 AES-256-GCM EmailDelivery、独立邮件 Outbox、SMTP Provider 和稳定 Message-ID；新增 `pnpm nextbuf mail test --to <邮箱>` 和管理员本人测试邮件入口。
- BullMQ 最终失败持久化到 PostgreSQL，邮件失败同步更新投递状态；手工重放先登记请求，再由 Worker 移除失败 Redis Job、重置原 Outbox 并留下审计。
- PostgreSQL 保存周期任务计划、租约、次数和错误；多 Worker 通过条件更新竞争租约，超时可接管。停止信号会禁止新派发/调度并等待活动周期和 BullMQ 任务关闭。
- `/admin/worker` 只允许站点 `admin` 查看 Redis 队列、Outbox、邮件、心跳、周期任务和失败摘要以及登记重放，不是通用后台 CRUD。
- 决策、幂等、SMTP 限制、回退和后续 fan-out 边界见 [ADR-0012](./adr/0012-notifications-mail-worker-operations.md)。

### `v0.10.0` 举报、治理、角色和信任等级

- 新增举报、案件、处置、制裁、治理审计、规则版本、用户信任状态、等级历史和重算批次表；目标类型、作用域、状态、等级、活动键和单一 active 规则均有 PostgreSQL 约束。
- 公开主题、回复和用户可以举报；同目标未结举报聚合为一个案件，同一举报者/目标只能有一条未结举报，每用户 UTC 日最多 10 条。
- `/admin/moderation` 提供按角色范围过滤的案件队列、详情、处置、结案和制裁撤销；完整后台仪表盘、用户搜索、角色/规则配置界面仍属于 `v0.11.0`。
- 节点版主仅管理所属节点；全局版主可管理全站内容、禁言和临时暂停；永久封禁、角色变更、规则激活和 TL4 只允许管理员，撤销最后一个管理员被拒绝。
- 节点禁言直接限制匹配节点的主题、回复和草稿，全站禁言还限制附件上传；两者都不阻止阅读、收藏、点赞。暂停/封禁同时写账号状态，授权不读取 Redis 缓存。
- 默认信任规则 v1 使用账号时长、已读主题、有效主题/回复、收到点赞和 180 天内有效违规；TL0-TL3 自动计算，升级立即生效，降级有 14 天宽限，TL4 只人工确认。
- 规则先 draft，再完成 preview 批次，才能激活并产生 apply 批次；Worker 每批 25 个 UID，保存游标、影响分布、解释和历史，Outbox 保证 Redis 丢失后可恢复。
- 页头和公开用户页读取真实 TL；`/account/trust` 展示规则版本、指标、宽限期、等级历史和本人治理记录；主题、回复和用户页已接入举报弹窗。
- 决策、默认阈值、权限矩阵和回退边界见 [ADR-0013](./adr/0013-governance-roles-trust.md)。

### `v0.11.0` 管理后台与站点配置

- 新增统一 `/admin` 后台壳与按角色裁剪的导航；站点管理员可访问仪表盘、用户、内容、节点、设置、审计和 Worker，全局/节点版主只进入既有范围内的治理案件工作台。
- 仪表盘读取真实 PostgreSQL 注册、30 日活跃、主题/回复、举报/案件、Outbox、邮件、失败任务、Worker 和信任批次，并读取 BullMQ 队列状态；Redis 不可用时显示明确降级而不伪造数据。
- 用户后台支持 UID/用户名/昵称/邮箱和状态筛选、稳定 UID 分页、详情、角色、脱敏会话/Provider、制裁、内容计数和信任历史；批量会话撤销最多 50 人，并在同一授权/审计工作流执行。
- 内容工作台检索主题和回复并链接到既有编辑/治理流程；节点页复用受审计更新用例；聚焦案件与 Worker 页面纳入同一后台布局。
- 新增 PostgreSQL 单例 `site_settings`：站点名称、注册模式、主题/回复/上传开关和每小时上限，带数据库 CHECK、Zod、修订号、行锁、最后修改者和治理审计。注册、OAuth 新用户、主题、回复和附件事务读取该事实。
- Provider 配置仍由环境变量提供；后台只显示 SMTP、本地/S3、GitHub OAuth 的脱敏状态并执行服务端真实连接测试，完整 Password/Secret/Token 不进入浏览器或站点设置表。
- 审计页合并 identity/community/governance 不可变事件，支持来源、操作、操作者 UID、日期、分页与最多 500 条受控 CSV；敏感键递归脱敏并防止公式注入。
- Better Auth `verifyPassword` 为当前 Session 建立十分钟 `admin_reauthentications`。角色变更、人工 TL4、信任规则激活、站点设置、批量会话撤销和审计导出同时要求 step-up 与固定确认文本；Session 撤销级联清除提升状态。
- 决策、在线/引导配置分层、OAuth-only 限制、审计和回退见 [ADR-0014](./adr/0014-administration-settings-and-reauthentication.md)。

### `v0.12.0` 安装、Docker、Actions 和运维

- 新增 Node.js 24 多阶段生产 `Dockerfile`：同一非 root 镜像提供 Web、Worker、setup、migrate、preflight、doctor、邀请和邮件入口；应用版本、迁移全集、依赖、存储和 `runtime.initialized` 任一不符都会拒绝 Web/Worker 启动。
- 根 `compose.yml` 提供 Web、Worker、PostgreSQL 18、Redis 8 四个常驻服务；setup 为一次性成功退出任务，PostgreSQL/Redis/本地附件使用独立命名卷，Web 只绑定 `127.0.0.1`。
- `nextbufctl` 实现 init/start/stop/status/logs/doctor/backup/restore/upgrade，并保留等价 Compose 命令；升级只接受更高精确版本，迁移成功后不承诺盲目切回旧代码。
- `/setup` 使用环境中的至少 32 位 `SETUP_TOKEN` 创建首位管理员；账号、密码哈希和邮箱验证仍由 Better Auth 管理，NextBuf 在受锁流程中授予首个站点管理员并写治理审计/安装完成状态。完成前普通邮箱和 OAuth 新用户创建均被拒绝。
- `nextbuf-backup-v1` 原子归档包含 PostgreSQL custom dump、本地附件、配置、Compose、版本/迁移清单和 SHA-256；恢复可显式覆盖配置或删除空安装卷，Redis 明确不是备份事实。S3 对象仍需 Provider 级版本/快照。
- GitHub Actions 的日常主分支只追加原生 amd64 镜像冒烟；定时、手动和标签运行通过原生 amd64/arm64 Runner 验证 setup/首次管理员/Web/Worker，amd64 执行空卷恢复。标签中每个架构只构建一次，通过后合并 GHCR manifest，并发布非 Docker x64 归档、SBOM、provenance 和 Release 资产。
- 发布资产包含 Nginx、宝塔、systemd 和 PM2 两进程示例；部署、初始化、升级、回滚和恢复边界见 [ADR-0015](./adr/0015-production-packaging-setup-and-recovery.md)。

## 2. 关键命令

```text
pnpm dev                         同时启动 Web 与 Worker
pnpm dev:web                     单独启动 Next.js
pnpm dev:worker                  单独监听 Worker
pnpm nextbuf setup               执行迁移并幂等初始化
pnpm nextbuf doctor              检查数据库、迁移、Redis 与 key namespace
pnpm nextbuf preflight web       执行 Web 启动门禁
pnpm nextbuf migrate             只部署已有迁移
pnpm nextbuf invite create ...   创建注册邀请码
pnpm nextbuf mail test --to ...  通过 Outbox 发送 SMTP 测试邮件
pnpm build                       构建 Prisma Client、Worker/CLI、Next.js standalone
pnpm release:archive 0.12.0      生成非 Docker 平台归档和 SHA-256
pnpm check                       格式、Lint、类型和单元测试
pnpm test:integration            PostgreSQL/Redis/Mailpit 真实集成测试
pnpm test:e2e                    standalone Web + Worker 身份与页面 E2E
./nextbufctl start               生产 Compose 初始化并启动四个常驻服务
./nextbufctl backup              备份 PostgreSQL、配置和本地附件
./nextbufctl restore ...         校验并恢复备份
```

开发 Compose 提供 PostgreSQL `5432`、Redis `6379`、Mailpit SMTP `1025` 和 Web `8025`。测试 Compose 使用 `55432`、`56379`、`11025` 和 `18025`，不得与开发或生产数据混用。

## 3. 测试与验证边界

- 本地已通过：Prisma generate、Prettier、ESLint、TypeScript、46 个单元测试、Worker/CLI、Next.js standalone 生产构建和非 Docker Windows 归档生成。全部 9 份迁移冷启动与 Linux 发布资产仍以 CI 为最终门槛。
- 集成测试共 32 项：原 27 项运行时、身份/资料、社区、互动/搜索、通知/Worker、治理/信任，加 4 项后台设置/二次验证/用户分页与批量会话/审计导出，以及 1 项 Doctor Queue 资源关闭回归；本机无真实服务，最终结果以 CI 为准。
- Playwright 共 6 项：5 项真实社区多视口/筛选/无障碍测试和 1 项完整身份/社区旅程；普通用户直接调用后台 Provider API 返回 403。
- Actions 的主分支追加原生 amd64 生产镜像冒烟；每日定时、手动和标签运行追加原生 amd64/arm64 冒烟，验证 setup、一次性管理员、Web/Worker 健康和重复安装拒绝，其中 amd64 执行带附件/密钥/数据库的删除卷恢复。标签运行才合并并发布正式多架构 manifest、供应链证明和经解压验证的非 Docker x64 包。
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
- Post 点赞、主题收藏、用户/主题关注、最大已读楼层、去标识化浏览桶、派生点赞/收藏/浏览计数和浏览 Outbox。
- 结构化通知、渠道偏好、站内/邮件投递结果、加密邮件、Worker 最终失败、重放请求、周期任务租约和运行结果。
- 举报来源与目标快照、治理案件、不可变处置、可撤销制裁、角色授予原因和治理审计。
- 规则版本、真实信任指标、当前/自动/人工 TL、降级宽限期、等级历史、预估/应用批次及 UID 游标。
- 站点设置单例、设置修订/最后修改者和当前 Session 绑定的管理员二次验证状态。
- 运行初始化、首次安装 claim/完成状态和首位管理员治理审计。

仍是明确占位：

- 在线成员跟踪尚未实现，因此“当前在线”和在线成员列表为空。

尚未实现：

- 最终注销执行器和在线成员跟踪。
- OAuth-only 管理员的 TOTP/Passkey/WebAuthn step-up、外部远程备份 Provider 和非 Docker arm64 原生发布包；当前密码二次验证基础不应被绕过。

不得为尚未实现的在线状态重新引入演示数据。不得在 `v0.13.0` 混入插件、交易或无关产品功能。

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
12. UID/用户名/别名/头像/注销语义遵循 ADR-0009；不得释放历史用户名。
13. 主题遵循 ADR-0005：统一 Post、position=1 首帖、数字公开编号和不可变修订。
14. 回复、Markdown 与附件遵循 ADR-0010：楼层不复用，服务端安全渲染，当前/修订/草稿引用共同保护附件，Worker 保留原件并生成派生文件。
15. 互动、浏览、热门与搜索遵循 ADR-0011：PostgreSQL 保存关系和接受桶，Worker 幂等聚合浏览，热门只计算，搜索遵守公开可见性。
16. 通知、普通邮件与 Worker 恢复遵循 ADR-0012：结构化通知和失败/调度状态以 PostgreSQL 为事实，Redis 可清空，安全邮件不读取普通偏好。
17. 举报、角色、制裁和信任遵循 ADR-0013：有效制裁直接参与服务端授权，TL 不授予管理角色，规则必须先预估再分批应用。
18. 后台、站点设置和管理员二次验证遵循 ADR-0014：在线运营设置与启动密钥分层，高风险操作绑定当前 Better Auth Session，Provider Secret 不进入浏览器。
19. 生产打包、首次管理员、备份恢复与升级遵循 ADR-0015：一个镜像多入口、setup 门禁、Better Auth 首账号、可验证备份和迁移后保守回滚。

## 6. 下一步只做 `v0.13.0`

入口：[详细开发计划 v0.13.0](./09-detailed-development-plan.md#v0130公开-beta-加固)

下一阶段冻结 V1 功能范围，集中执行安全威胁建模、依赖审计、性能/索引/队列容量基准、移动端与键盘无障碍、跨 Beta 迁移、日志脱敏、故障注入和邀请安装测试。

`v0.13.0` 不增加插件、交易、支付或开放 API；优先关闭安全、数据损坏、安装升级、恢复和严重体验阻断项。

## 7. 文档优先级与交接规则

优先级：已接受 ADR和决策台账 > 当前详细开发计划 > 专题规范/运行手册 > 高层路线图 > 历史 UI 静态稿。

完成一个版本或中断开发时必须更新：当前版本、已完成、真实验证结果、已知问题、未提交变更、唯一下一步和阻断项。聊天记录不是项目状态的唯一来源。
