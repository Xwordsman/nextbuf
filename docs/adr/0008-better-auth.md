# ADR-0008：使用 Better Auth 作为身份认证核心

- 状态：Accepted
- 日期：2026-07-12

## 背景

NextBuf 需要在同一个 Next.js 应用中提供邮箱密码、邮箱验证、密码重置、数据库会话、会话撤销和可选 OAuth。认证实现必须支持 Next.js 16、React 19、Prisma 7、独立 Worker、standalone 构建和 amd64/arm64 部署，且不能要求维护自研密码协议、Cookie 签名或 OAuth 状态机。

## 决策

采用 Better Auth，`v0.4.0` 锁定 `better-auth@1.6.23` 与 `@better-auth/prisma-adapter@1.6.23`：

- 使用 Prisma adapter 和 PostgreSQL 数据库会话。
- 邮箱密码使用 Better Auth 默认推荐的 scrypt 实现，不引入原生 Argon2 模块。
- 邮箱验证后才允许密码登录；密码重置撤销全部旧会话。
- `verification.identifier` 在 Prisma adapter 外层使用 HMAC-SHA256 后落库，数据库不保存可直接使用的验证或重置标识。
- Better Auth 限流接入 Redis 原子 Lua 计数；NextBuf 注册入口增加 IP 与邮箱维度限流。
- `/api/auth/sign-up/email` 只允许 NextBuf 内部 HMAC 请求，公开邮箱注册统一经过 `/api/identity/register` 执行开放、邀请制或关闭策略。
- GitHub 是首个可选 OAuth Provider。邀请制或关闭注册时，Provider 允许既有账号登录但禁止创建新账号。
- OAuth token 使用 Better Auth 的数据库加密能力；Provider 只有 ID 与 Secret 同时配置时才启用。
- 身份邮件先以 AES-256-GCM 加密载荷写入 PostgreSQL Outbox，再由 Worker 通过 SMTP 发送。
- 关闭 Better Auth telemetry，认证密钥、邮件密钥和 SMTP 凭证只存在于服务端配置。

## 备选方案

### Auth.js

生态成熟，但当前项目需要额外组合注册、密码重置、会话管理和 Prisma 7 行为。Better Auth 对所需完整身份链路的内建覆盖更直接。

### 自研认证

可以完全控制模型，但密码哈希、令牌、Cookie、OAuth、会话轮换和安全升级的长期成本与风险不符合项目阶段。

### 外部身份服务

会增加自托管依赖、离线可用性和部署配置，不符合默认单机开源社区程序的交付目标。未来可以作为可选 Provider，而不是 V1 唯一身份来源。

## 后果

- Better Auth 数据模型和升级行为成为身份模块的重要兼容边界，升级前必须阅读变更日志并运行真实 PostgreSQL/Redis/Mailpit 集成与 E2E。
- scrypt 避免原生模块在 ARM64、standalone 和宝塔镜像中的构建风险，但不得擅自更换哈希算法；迁移需要同时支持旧哈希验证与渐进升级。
- HMAC 标识依赖 `AUTH_SECRET`，轮换该密钥会使尚未使用的验证和重置链接失效，发布说明必须明确。
- `MAIL_PAYLOAD_KEY` 丢失会使尚未发送的加密邮件无法解密，必须与备份一起安全保存。
- `v0.4.0` 只建立真实名称、邮箱、账号和会话，不提前创建 UID、`@username`、Profile 或信任等级。

## 迁移与回退

预览阶段如需替换认证库，必须新增 ADR，并提供用户、账号、会话和验证记录迁移。已执行身份迁移后不能仅切回 `v0.3.0` 镜像；回退需要恢复迁移前数据库备份，或保留新增表并使用兼容代码。

## 关联文档

- [身份、信任与安全](../04-identity-trust-security.md)
- [配置参考](../12-configuration-reference.md)
- [本地开发手册](../11-local-development.md)
