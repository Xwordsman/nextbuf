# 配置参考

本文定义 NextBuf 环境变量的目标合同。`v0.1.0` 必须建立统一配置 Schema，`v0.12.0` 前必须让 `.env.example`、Compose、安装向导、Web、Worker、CLI 与本文完全一致。

> 当前实现状态：`v0.13.5` 已让共享 Zod Schema、根 `.env.example`、生产 Compose、宝塔单文件 Compose、Web、Worker、CLI、setup、doctor 和发布包使用同一合同。站点名称、注册策略、发布开关和每小时限额继续由 PostgreSQL `site_settings` 管理；Provider 密钥不在线保存或回显。

## 1. 配置规则

- 启动时一次性解析并验证，错误时快速失败。
- Web、Worker、setup 和 doctor 共享同一个配置模块。
- 秘密不能通过 `NEXT_PUBLIC_` 暴露给浏览器。
- 环境变量名称使用大写下划线，布尔值只接受明确的 `true/false`。
- 空字符串不能静默当作有效密钥。
- 所有 URL 都验证协议、主机和必要路径。
- 数据库中的站点设置不能覆盖数据库连接、Redis、认证和加密主密钥。

## 2. 核心应用配置

| 变量 | 必需 | 默认值 | 适用进程 | 敏感 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | 是 | `development` | 全部 | 否 | `development`、`test`、`production` |
| `APP_URL` | 生产必需 | `http://localhost:3000` | Web、Worker、setup | 否 | 用户访问的唯一规范外部地址；公网生产必须 HTTPS，只有 loopback 测试地址可使用 HTTP |
| `HOSTNAME` | 否 | `0.0.0.0` | Web | 否 | Web 监听地址 |
| `PORT` | 否 | `3000` | Web | 否 | Web 监听端口 |
| `TZ` | 否 | `Asia/Shanghai` | 全部 | 否 | 日志和计划任务显示时区；数据库仍保存 UTC |
| `LOG_LEVEL` | 否 | `info` | 全部 | 否 | `debug`、`info`、`warn`、`error` |
| `LOG_FORMAT` | 否 | 生产 `json` | 全部 | 否 | `pretty` 或 `json` |
| `TRUST_PROXY` | 生产需确认 | `false` | Web | 否 | 可信代理策略，不能无条件信任所有来源 |

`APP_URL` 改变会影响 Cookie、OAuth 回调、邮件链接和 Webhook，应作为受控部署变更。standalone E2E 可使用 `http://localhost`、`http://127.0.0.1` 或 `http://[::1]`；该例外不适用于局域网 IP、容器域名或公网域名。

## 3. PostgreSQL

| 变量 | 必需 | 默认值 | 适用进程 | 敏感 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | 是 | 无 | Web、Worker、setup、doctor | 是 | PostgreSQL 连接串 |
| `DATABASE_DIRECT_URL` | 否 | 使用 `DATABASE_URL` | setup、迁移 | 是 | 绕过连接池的迁移连接 |
| `DATABASE_POOL_SIZE` | 否 | `10` | Web、Worker | 否 | 每进程连接池上限 |
| `DATABASE_STATEMENT_TIMEOUT_MS` | 否 | `15000` | Web、Worker | 否 | 普通查询超时 |
| `DATABASE_SSL_MODE` | 否 | `prefer` | 全部 | 否 | 托管数据库可设 `require`/`verify-full` |

要求：

- 只支持 PostgreSQL 18 作为官方基线。
- 生产连接必须使用独立低权限应用用户；迁移用户可按需要单独配置。
- 密码包含特殊字符时必须正确 URL 编码。
- Web 与 Worker 总连接数必须小于数据库限制并留出迁移和管理余量。

## 4. Redis 与队列

| 变量 | 必需 | 默认值 | 适用进程 | 敏感 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `REDIS_URL` | 是 | 无 | Web、Worker、setup、doctor | 是 | Redis 连接串 |
| `REDIS_PREFIX` | 否 | `nextbuf` | Web、Worker | 否 | 实例命名空间，同一 Redis 多实例时必须唯一 |
| `WORKER_CONCURRENCY` | 否 | `5` | Worker | 否 | 单 Worker 并发，需按任务类型和资源调优 |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | 否 | `30000` | Worker | 否 | 优雅停止等待时间 |
| `WORKER_HEARTBEAT_INTERVAL_MS` | 否 | `10000` | Worker | 否 | 写入 PostgreSQL Worker 心跳的间隔 |
| `WORKER_STALE_AFTER_MS` | 否 | `30000` | Web、doctor | 否 | 超过该时长未心跳的 Worker 不计为 ready |
| `WORKER_SCHEDULER_POLL_INTERVAL_MS` | 否 | `5000` | Worker | 否 | 检查 PostgreSQL 周期任务计划的间隔 |
| `WORKER_TASK_LOCK_TIMEOUT_MS` | 否 | `300000` | Worker | 否 | Worker 崩溃后其他实例接管调度租约的时间 |
| `OUTBOX_POLL_INTERVAL_MS` | 否 | `1000` | Worker | 否 | Outbox Dispatcher 轮询间隔 |
| `OUTBOX_BATCH_SIZE` | 否 | `50` | Worker | 否 | 单轮最多认领并投递的 Outbox 数量 |
| `OUTBOX_LOCK_TIMEOUT_MS` | 否 | `60000` | Worker | 否 | Dispatcher 崩溃后允许其他实例重新认领的时间 |
| `JOB_REMOVE_COMPLETE_AFTER` | 否 | `1000` | Worker | 否 | 保留最近成功任务数量/策略 |
| `JOB_REMOVE_FAILED_AFTER` | 否 | `5000` | Worker | 否 | 保留失败任务用于诊断 |

Redis 服务必须兼容 BullMQ 所需命令。业务事实不能只存在 Redis；关键异步意图通过 PostgreSQL Outbox 恢复。

当前实现从 `REDIS_PREFIX` 派生三个空间：`${REDIS_PREFIX}:cache`、`${REDIS_PREFIX}:rate`、`${REDIS_PREFIX}:queue`。BullMQ 使用自己的 `prefix` 选项，不能给 BullMQ 连接设置 ioredis `keyPrefix`，否则 Lua 脚本和队列 key 会不一致。

## 5. 认证与加密

| 变量 | 必需 | 默认值 | 适用进程 | 敏感 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `AUTH_SECRET` | 是 | 无 | Web、Worker、setup | 是 | 至少 32 字节随机值，用于会话/认证签名 |
| `SETUP_TOKEN` | 首次安装 | 无 | Web | 是 | 至少 32 位随机一次性令牌，只允许 `/setup` 创建首位管理员；完成后删除 |
| `AUTH_REGISTRATION_MODE` | 否 | `open` | Web | 否 | 首次迁移/尚未由后台保存设置时的 `open`、`invite` 或 `closed` 引导值；之后由 PostgreSQL 站点设置接管 |
| `AUTH_SESSION_EXPIRES_IN_SECONDS` | 否 | `2592000` | Web | 否 | 会话绝对有效期，默认 30 天 |
| `AUTH_SESSION_UPDATE_AGE_SECONDS` | 否 | `86400` | Web | 否 | 会话刷新周期，默认 1 天 |
| `AUTH_VERIFICATION_EXPIRES_IN_SECONDS` | 否 | `86400` | Web | 否 | 邮箱验证链接有效期 |
| `AUTH_PASSWORD_RESET_EXPIRES_IN_SECONDS` | 否 | `3600` | Web | 否 | 密码重置链接有效期 |
| `AUTH_TRUSTED_ORIGINS` | 否 | 空 | Web | 否 | 逗号分隔的附加可信 Origin；`APP_URL` 自动包含 |
| `AUTH_TRUSTED_PROXIES` | 否 | 空 | Web | 否 | 逗号分隔的可信代理地址/规则，不能无条件信任公网转发头 |
| `MAIL_PAYLOAD_KEY` | 是 | 无 | Web、Worker | 是 | Base64 编码的精确 32 字节 AES-256-GCM 密钥 |

密钥生成示例：

```bash
openssl rand -hex 32
openssl rand -base64 32
```

规则：

- `AUTH_SECRET` 至少 32 个字符；示例第一条命令生成 64 位十六进制值。
- `AUTH_SECRET` 和 `MAIL_PAYLOAD_KEY` 用途不同，不能复用。
- 轮换 `AUTH_SECRET` 会使现有 Cookie 和尚未使用的验证/重置链接失效。
- `MAIL_PAYLOAD_KEY` 丢失会导致待发送邮件正文无法恢复，必须与备份一起安全保存。
- `SETUP_TOKEN` 不写入数据库，`installation.completed` 写入后即使环境仍残留令牌也不能再次创建管理员。

## 6. 邮件

| 变量 | 必需 | 默认值 | 适用进程 | 敏感 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `SMTP_HOST` | 是 | 无 | Web、Worker | 否 | SMTP 主机；Web 校验配置，Worker 实际连接 |
| `SMTP_PORT` | 否 | `1025` | Web、Worker | 否 | SMTP 端口；生产常用 465 或 587 |
| `SMTP_SECURE` | 否 | `false` | Web、Worker | 否 | 连接建立时是否直接 TLS，通常端口 465 为 true |
| `SMTP_USER` | 视服务而定 | 无 | Worker | 是 | SMTP 用户名 |
| `SMTP_PASSWORD` | 视服务而定 | 无 | Worker | 是 | SMTP 密码 |
| `SMTP_FROM` | 否 | `NextBuf <noreply@localhost>` | Worker | 否 | 完整发件人，可同时包含名称和地址 |

`SMTP_USER` 与 `SMTP_PASSWORD` 必须同时设置或同时为空。开发 Compose 的 Mailpit 使用 `127.0.0.1:1025`，Web 界面为 `http://127.0.0.1:8025`；Mailpit 不用于生产。生产环境若没有可用邮件服务，不得开放邮箱注册。

`Connection timeout` 表示 Worker 尚未连接到 SMTP 服务器，发生在账号密码认证之前。先核对 Provider 控制台给出的区域 SMTP 主机和服务器出口端口；465 通常配 `SMTP_SECURE=true`，587 或 Provider 明确支持的替代端口通常配 `false`。`SMTP_PASSWORD` 必须填写 SMTP 专用密码，不是云账号密码或 AccessKey。修改后必须重建 Web 与 Worker，使两个进程读取同一配置。

## 7. 文件存储

| 变量 | 必需 | 默认值 | 适用进程 | 敏感 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `STORAGE_DRIVER` | 否 | `local` | Web、Worker | 否 | `local` 或 `s3`；Web 与 Worker 必须一致 |
| `STORAGE_LOCAL_PATH` | local 时必需 | `data/uploads` | Web、Worker | 否 | 本地持久化根目录，包含 `avatars/` 和 `attachments/`；相对路径由官方启动入口按启动目录固定 |
| `AVATAR_MAX_UPLOAD_BYTES` | 否 | `1048576` | Web | 否 | 裁剪后头像最大字节数；范围 65536 至 5242880 |
| `ATTACHMENT_MAX_UPLOAD_BYTES` | 否 | `20971520` | Web | 否 | 单个附件上限；范围 65536 至 52428800 |
| `ATTACHMENT_MAX_IMAGE_PIXELS` | 否 | `40000000` | Worker | 否 | 图片解码像素上限；范围 100 万至 1 亿 |
| `ATTACHMENT_ORPHAN_GRACE_HOURS` | 否 | `24` | Web、Worker | 否 | 无引用附件延迟回收宽限期；范围 1 至 720 小时 |
| `S3_ENDPOINT` | s3 视情况 | 无 | Web、Worker | 否 | S3 兼容服务地址 |
| `S3_REGION` | s3 必需 | 无 | Web、Worker | 否 | Region |
| `S3_BUCKET` | s3 必需 | 无 | Web、Worker | 否 | Bucket |
| `S3_ACCESS_KEY_ID` | s3 必需 | 无 | Web、Worker | 是 | Access Key |
| `S3_SECRET_ACCESS_KEY` | s3 必需 | 无 | Web、Worker | 是 | Secret Key |
| `S3_FORCE_PATH_STYLE` | 否 | `false` | Web、Worker | 否 | 部分兼容服务需要 true |

头像与附件都使用随机不可变对象键，用户文件名只作为经过清洗的下载名称。附件原件保留，Worker 为图片生成 WebP 派生文件；数据库保存实际 storage driver、对象键、校验和、处理状态和引用。`STORAGE_LOCAL_PATH` 是必须随 PostgreSQL 一起备份的事实数据，不属于 `.next`、`dist` 或可重建缓存。

`STORAGE_DRIVER=s3` 时缺少 Region、Bucket 或任一凭据会导致启动配置校验失败；AWS S3 可以留空 `S3_ENDPOINT`，兼容服务按供应商要求设置 Endpoint 和 path-style。Bucket 应保持私有，附件通过应用媒体路由授权交付。多 Web 实例必须使用 S3 或经过验证的共享文件系统，不能各自保存独立本地目录。切换 driver 前必须迁移并核对全部头像、原件和派生对象。

Next.js standalone 会在启动时把进程工作目录切换到 `.next/standalone`。`pnpm start:web` 因此先加载启动目录下的 `.env`，再把相对 `STORAGE_LOCAL_PATH` 转成绝对路径；独立 Worker 继续以同一启动目录解析配置。源码部署和 E2E 必须使用这个官方入口，生产环境优先使用 `/var/lib/nextbuf/uploads` 一类绝对持久卷路径。

## 8. OAuth

OAuth Provider 按配置启用。首批变量命名：

| 变量 | 必需 | 敏感 | 说明 |
| --- | --- | --- | --- |
| `GITHUB_CLIENT_ID` | 启用 GitHub 时 | 否 | GitHub OAuth Client ID |
| `GITHUB_CLIENT_SECRET` | 启用 GitHub 时 | 是 | GitHub OAuth Secret |

只有 Client ID 与 Secret 同时存在时才启用 GitHub；只设置一个会导致启动配置校验失败。回调 URL 为 `${APP_URL}/api/auth/callback/github`。有效 PostgreSQL 注册策略不是 `open` 时，既有 GitHub 账号仍可登录，但 Better Auth 用户创建钩子拒绝 OAuth 新建账号。

Google、Linux.do 等其他 Provider 尚未实现；增加前必须确认协议、申请流程、邮箱可信度和稳定用户标识。

## 9. 搜索

| 变量 | 必需 | 默认值 | 适用进程 | 敏感 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `SEARCH_DRIVER` | 后续外部 Provider | `postgres` | Web、Worker | 否 | 当前未实现配置切换，`v0.8.0` 固定使用 PostgreSQL |
| `SEARCH_URL` | 外部搜索时 | 无 | Web、Worker | 可能 | V2+ 搜索服务地址 |
| `SEARCH_API_KEY` | 外部搜索时 | 无 | Web、Worker | 是 | 搜索服务密钥 |
| `SEARCH_INDEX_PREFIX` | 否 | `nextbuf` | Worker | 否 | 索引命名空间 |

`v0.8.0` 固定使用内置 `PostgresSearchProvider`，不会读取本节三个 `SEARCH_*` 变量。未来外部搜索不可用时应按策略降级到 PostgreSQL 或返回清晰状态，不能影响发帖事务。

## 10. 可观测性

| 变量 | 必需 | 默认值 | 适用进程 | 敏感 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `OTEL_ENABLED` | 否 | `false` | Web、Worker | 否 | 启用 OpenTelemetry |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | 启用时 | 无 | Web、Worker | 可能 | OTLP 地址 |
| `OTEL_SERVICE_NAME_WEB` | 否 | `nextbuf-web` | Web | 否 | Web 服务名 |
| `OTEL_SERVICE_NAME_WORKER` | 否 | `nextbuf-worker` | Worker | 否 | Worker 服务名 |
| `SENTRY_DSN` | 否 | 无 | Web、Worker | 可能 | 可选错误上报；实现前评估隐私 |

任何外部观测系统都必须配置脱敏，不能上传密码、Cookie、Authorization、完整邮件内容或 Provider Secret。

## 11. 功能与安全限制

`v0.11.0` 起已将下列运营设置保存在数据库后台，而不是继续增加环境变量：

- 站点名称以及 `open/invite/closed` 注册策略。
- 是否允许发布主题、回复和上传附件。
- 每用户每小时主题、回复和附件数量上限。
- 信任等级阈值仍使用独立版本化规则、preview/apply 批次，不折叠到站点设置单例。
- 节点排序、可见性和归档状态继续使用节点领域模型。

SMTP、对象存储和 GitHub OAuth 的主机、Bucket、Client ID 等非秘密信息可以在后台以只读方式查看；用户名、Access Key 等仅显示脱敏值，Password/Secret 只显示是否存在。连接测试由服务端使用当前环境配置执行，结果进入治理审计。修改 Provider 环境变量后必须重启 Web/Worker，后台不存在“保存成功但运行实例仍使用旧密钥”的伪在线配置。

环境变量保留给实例级连接、秘密、启动行为和无法安全在线修改的配置。

## 12. Compose 内部变量

受控 `compose.yml + .env + nextbufctl` 入口可以额外使用部署辅助变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NEXTBUF_VERSION` | 无，生产必须指定 | 镜像精确版本，不能默认 `latest` |
| `NEXTBUF_IMAGE` | `ghcr.io/xwordsman/nextbuf` | 完整镜像地址 |
| `POSTGRES_DB` | `nextbuf` | 内置 PostgreSQL 数据库名 |
| `POSTGRES_USER` | `nextbuf` | 内置 PostgreSQL 用户 |
| `POSTGRES_PASSWORD` | 无 | 内置 PostgreSQL 强密码 |
| `REDIS_PASSWORD` | 无 | 内置 Redis 强密码 |
| `WEB_PORT` | `3000` | 宿主机映射端口 |
| `NEXTBUF_ENV_FILE` | `.env` | Compose 服务读取的环境文件；主要供测试和受控多实例目录使用 |

Compose 应根据这些值构造应用 `DATABASE_URL` 和 `REDIS_URL`，用户不需要重复维护两套密码。

`compose.baota.yml` 不读取 `.env`，也不需要 `NEXTBUF_IMAGE`、`NEXTBUF_VERSION` 或 `NEXTBUF_ENV_FILE`。它将镜像固定为正式 `latest` 通道，并把应用、PostgreSQL 和 Redis 所需值直接写在同一个 Compose。重复出现的数据库/Redis 密码必须保持一致；所有 `replace-` 值、示例域名和示例 `MAIL_PAYLOAD_KEY` 都必须在首次启动前替换。镜像内部的精确 `NEXTBUF_VERSION` 仍由发布构建写入，不能在面板模板中覆盖。该单实例入口固定四个容器名，因此同一 Docker 主机不能同时启动两套未改名的宝塔模板；多实例部署使用受控 Compose。

## 13. 配置优先级

建议从低到高：

1. 代码安全默认值。
2. `.env`/容器环境变量。
3. 受支持的进程命令行参数，仅用于诊断或明确覆盖。

数据库站点设置属于另一层业务配置，不覆盖实例连接和秘密。相同设置不能同时在环境变量和数据库中形成两个互相争夺的来源。

## 14. 启动校验

应用必须在启动时拒绝：

- 生产环境使用示例密钥、短密钥或相同的两个主密钥。
- `APP_URL` 使用无效协议，或公网生产地址使用明文 HTTP；反向代理后的 `APP_URL` 仍应填写用户实际访问的 HTTPS 地址。
- Web/Worker 使用不同 `REDIS_PREFIX` 或数据库。
- S3 模式缺少 Bucket/Region/凭证。
- SMTP 模式缺少必要主机和发件地址。
- 外部搜索模式缺少 URL 或密钥。
- `NEXT_PUBLIC_` 变量中出现疑似 Secret、Password、Token。

`nextbuf doctor` 应执行相同 Schema 校验，并额外测试数据库、Redis、邮件和存储连通性，但输出必须脱敏。

Web/Worker preflight 还要求：`NEXTBUF_VERSION` 与应用内版本一致、Release 中全部迁移已经成功应用、没有未知迁移、`runtime.initialized` 存在。本地存储会执行创建/删除探针，S3 会执行 `HeadBucket`。任一失败都拒绝启动而不是进入假健康状态。
