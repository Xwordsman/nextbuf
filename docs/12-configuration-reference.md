# 配置参考

本文定义 NextBuf 环境变量的目标合同。`v0.1.0` 必须建立统一配置 Schema，`v0.12.0` 前必须让 `.env.example`、Compose、安装向导、Web、Worker、CLI 与本文完全一致。

> 当前实现状态：截至 `v0.4.0`，`.env.example` 中的应用、数据库、Redis、Worker、Outbox、认证、身份邮件和 GitHub OAuth 变量已经由共享 Zod Schema 实现。存储、搜索、观测、首次安装和生产 Compose 变量仍是后续合同；尚未出现在 `.env.example` 的变量不能视为当前可用功能。

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
| `APP_URL` | 生产必需 | `http://localhost:3000` | Web、Worker、setup | 否 | 用户访问的唯一规范外部地址 |
| `HOSTNAME` | 否 | `0.0.0.0` | Web | 否 | Web 监听地址 |
| `PORT` | 否 | `3000` | Web | 否 | Web 监听端口 |
| `TZ` | 否 | `Asia/Shanghai` | 全部 | 否 | 日志和计划任务显示时区；数据库仍保存 UTC |
| `LOG_LEVEL` | 否 | `info` | 全部 | 否 | `debug`、`info`、`warn`、`error` |
| `LOG_FORMAT` | 否 | 生产 `json` | 全部 | 否 | `pretty` 或 `json` |
| `TRUST_PROXY` | 生产需确认 | `false` | Web | 否 | 可信代理策略，不能无条件信任所有来源 |

`APP_URL` 改变会影响 Cookie、OAuth 回调、邮件链接和 Webhook，应作为受控部署变更。

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
| `AUTH_REGISTRATION_MODE` | 否 | `open` | Web | 否 | `open`、`invite` 或 `closed` |
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
- 通用 Provider `ENCRYPTION_KEY` 与首次安装 `SETUP_TOKEN` 是后续版本合同，`v0.4.0` 尚未实现。

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

## 7. 文件存储

| 变量 | 必需 | 默认值 | 适用进程 | 敏感 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `STORAGE_DRIVER` | 否 | `local` | Web、Worker、doctor | 否 | `local` 或 `s3` |
| `UPLOAD_DIR` | local 必需 | `/data/uploads` | Web、Worker | 否 | 本地持久化路径 |
| `MAX_UPLOAD_SIZE_MB` | 否 | `20` | Web、Worker | 否 | 应用层最大上传大小 |
| `S3_ENDPOINT` | s3 视情况 | 无 | Web、Worker | 否 | S3 兼容服务地址 |
| `S3_REGION` | s3 必需 | 无 | Web、Worker | 否 | Region |
| `S3_BUCKET` | s3 必需 | 无 | Web、Worker | 否 | Bucket |
| `S3_ACCESS_KEY_ID` | s3 必需 | 无 | Web、Worker | 是 | Access Key |
| `S3_SECRET_ACCESS_KEY` | s3 必需 | 无 | Web、Worker | 是 | Secret Key |
| `S3_FORCE_PATH_STYLE` | 否 | `false` | Web、Worker | 否 | 部分兼容服务需要 true |
| `S3_PUBLIC_BASE_URL` | 否 | 无 | Web | 否 | CDN/公开资源基础地址 |

多 Web 实例不允许使用各自独立的本地上传目录，必须共享可靠文件系统或切换 S3。

## 8. OAuth

OAuth Provider 按配置启用。首批变量命名：

| 变量 | 必需 | 敏感 | 说明 |
| --- | --- | --- | --- |
| `GITHUB_CLIENT_ID` | 启用 GitHub 时 | 否 | GitHub OAuth Client ID |
| `GITHUB_CLIENT_SECRET` | 启用 GitHub 时 | 是 | GitHub OAuth Secret |

只有 Client ID 与 Secret 同时存在时才启用 GitHub；只设置一个会导致启动配置校验失败。回调 URL 为 `${APP_URL}/api/auth/callback/github`。`AUTH_REGISTRATION_MODE` 不是 `open` 时，既有 GitHub 账号仍可登录，但 OAuth 不创建新用户。

Google、Linux.do 等其他 Provider 尚未实现；增加前必须确认协议、申请流程、邮箱可信度和稳定用户标识。

## 9. 搜索

| 变量 | 必需 | 默认值 | 适用进程 | 敏感 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `SEARCH_DRIVER` | 否 | `postgres` | Web、Worker | 否 | V1 只正式支持 `postgres` |
| `SEARCH_URL` | 外部搜索时 | 无 | Web、Worker | 可能 | V2+ 搜索服务地址 |
| `SEARCH_API_KEY` | 外部搜索时 | 无 | Web、Worker | 是 | 搜索服务密钥 |
| `SEARCH_INDEX_PREFIX` | 否 | `nextbuf` | Worker | 否 | 索引命名空间 |

外部搜索不可用时应按策略降级到 PostgreSQL 或返回清晰状态，不能影响发帖事务。

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

下列运营设置应保存在数据库后台，而不是无限增加环境变量：

- 是否开放注册。
- 发帖和回复限制。
- 信任等级阈值。
- 节点排序和权限。
- 站点名称、介绍和页脚内容。
- 普通通知偏好和功能开关。

环境变量保留给实例级连接、秘密、启动行为和无法安全在线修改的配置。

## 12. Compose 内部变量

官方 Compose 可以额外使用部署辅助变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NEXTBUF_VERSION` | 无，生产必须指定 | 镜像精确版本，不能默认 `latest` |
| `NEXTBUF_IMAGE` | 发布时确定 | 完整镜像地址；产品组织未确定前使用占位值 |
| `POSTGRES_DB` | `nextbuf` | 内置 PostgreSQL 数据库名 |
| `POSTGRES_USER` | `nextbuf` | 内置 PostgreSQL 用户 |
| `POSTGRES_PASSWORD` | 无 | 内置 PostgreSQL 强密码 |
| `REDIS_PASSWORD` | 无 | 内置 Redis 强密码 |
| `WEB_BIND_ADDRESS` | `127.0.0.1` | 宿主机绑定地址 |
| `WEB_PORT` | `3000` | 宿主机映射端口 |

Compose 应根据这些值构造应用 `DATABASE_URL` 和 `REDIS_URL`，用户不需要重复维护两套密码。

## 13. 配置优先级

建议从低到高：

1. 代码安全默认值。
2. `.env`/容器环境变量。
3. 受支持的进程命令行参数，仅用于诊断或明确覆盖。

数据库站点设置属于另一层业务配置，不覆盖实例连接和秘密。相同设置不能同时在环境变量和数据库中形成两个互相争夺的来源。

## 14. 启动校验

应用必须在启动时拒绝：

- 生产环境使用示例密钥、短密钥或相同的两个主密钥。
- `APP_URL` 使用无效协议或生产明文 HTTP（明确反向代理场景除外）。
- Web/Worker 使用不同 `REDIS_PREFIX` 或数据库。
- S3 模式缺少 Bucket/Region/凭证。
- SMTP 模式缺少必要主机和发件地址。
- 外部搜索模式缺少 URL 或密钥。
- `NEXT_PUBLIC_` 变量中出现疑似 Secret、Password、Token。

`nextbuf doctor` 应执行相同 Schema 校验，并额外测试数据库、Redis、邮件和存储连通性，但输出必须脱敏。
