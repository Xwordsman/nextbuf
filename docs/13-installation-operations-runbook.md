# 安装与运维运行手册

本文定义 NextBuf 面向部署者的目标操作流程，包括 Docker Compose、宝塔、非 Docker、升级、备份、恢复和故障排查。

> 当前实现状态：`v0.12.0` 已交付本文所述生产镜像、四容器 Compose、`nextbufctl`、首次管理员、备份恢复、升级、宝塔和非 Docker 资产。容器/恢复验收由 GitHub Actions 在 Linux amd64/arm64 上执行；Mailpit 只出现在测试覆盖中，不进入生产拓扑。长期决策见 [ADR-0015](./adr/0015-production-packaging-setup-and-recovery.md)。

## 1. 发布包合同

每个正式版本至少发布：

```text
nextbuf-release/
├─ compose.yml
├─ .env.example
├─ nextbufctl
├─ runtime/                    非 Docker Web/Worker/CLI/生产依赖
├─ deploy/
│  ├─ nginx/nextbuf.conf.example
│  ├─ systemd/nextbuf-web.service
│  ├─ systemd/nextbuf-worker.service
│  └─ pm2/ecosystem.config.cjs
├─ checksums.txt
└─ VERSION
```

同时发布：

- amd64/arm64 应用镜像。
- Linux x64 非 Docker tar.gz 发布包；arm64 使用多架构容器镜像。
- SBOM、校验和、变更日志和升级说明。
- 与该版本完全匹配的文档快照。

`nextbufctl` 是面向单机部署者的薄封装，只组合 Docker Compose 和经过测试的脚本，不重新实现一套隐藏部署逻辑。必须支持：

```text
./nextbufctl init
./nextbufctl start
./nextbufctl stop
./nextbufctl status
./nextbufctl logs [web|worker|postgres|redis]
./nextbufctl doctor
./nextbufctl backup
./nextbufctl restore <backup-file>
./nextbufctl upgrade <version>
```

高级用户可以直接使用文档列出的等价 `docker compose` 命令。

## 2. Docker Compose 前置条件

- 64 位 Linux，amd64 或 arm64。
- Docker Engine 和 Compose v2。
- 一个解析到服务器的域名。
- 可用的 80/443 端口或已有反向代理。
- SMTP 服务；正式开放注册前必须验证邮件。
- 足够的磁盘用于 PostgreSQL、附件、日志和备份。

在 `v0.13.0` 压力测试完成前，资源数值只能作为开发估算。正式发布必须提供经过验证的试用、小型生产和中型单机档位，不能延续未经测试的最低配置。

## 3. Docker 首次安装

### 3.1 获取发布文件

只从正式 Release 下载与目标版本匹配的发布包，并验证 `checksums.txt`。生产环境使用精确版本：

```dotenv
NEXTBUF_IMAGE=<正式发布时确定的镜像地址>
NEXTBUF_VERSION=1.0.0
```

禁止生产部署默认使用 `latest`、`edge` 或未校验的第三方镜像。

### 3.2 初始化配置

```bash
cp .env.example .env
chmod 600 .env
./nextbufctl init
```

`init` 必须：

- 检查 Docker、Compose 和目录权限。
- 生成 `POSTGRES_PASSWORD`、`REDIS_PASSWORD`、`AUTH_SECRET`、`MAIL_PAYLOAD_KEY` 和 `SETUP_TOKEN`。
- 不覆盖用户已经设置的非占位密钥。
- 创建本地上传、备份和日志目录（如部署模式需要）。
- 运行配置 Schema 校验并输出脱敏摘要。

用户必须设置：

- `APP_URL`。
- `NEXTBUF_IMAGE` 和 `NEXTBUF_VERSION`。
- 邮件配置。
- 注册策略：`open`、`invite` 或 `closed`。
- 本地/S3 存储选择。

完整变量见 [配置参考](./12-configuration-reference.md)。

### 3.2.1 当前身份配置

生产部署使用本地存储时至少需要：

```dotenv
APP_URL=https://community.example.com
AUTH_SECRET=<至少 32 个字符的随机值>
SETUP_TOKEN=<至少 32 位的一次性随机令牌>
AUTH_REGISTRATION_MODE=invite
MAIL_PAYLOAD_KEY=<Base64 编码的 32 字节随机值>
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<smtp-user>
SMTP_PASSWORD=<smtp-password>
SMTP_FROM=NextBuf <noreply@example.com>
STORAGE_DRIVER=local
STORAGE_LOCAL_PATH=/app/data/uploads
AVATAR_MAX_UPLOAD_BYTES=1048576
ATTACHMENT_MAX_UPLOAD_BYTES=20971520
ATTACHMENT_MAX_IMAGE_PIXELS=40000000
ATTACHMENT_ORPHAN_GRACE_HOURS=24
```

官方 Compose 把 `/app/data/uploads` 挂载为 `nextbuf_uploads` 命名卷，并由备份工具从应用容器读取。非 Docker 环境改为 `/var/lib/nextbuf/uploads`。S3 模式设置 `S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY_ID` 和 `S3_SECRET_ACCESS_KEY`；兼容服务再设置 `S3_ENDPOINT`/`S3_FORCE_PATH_STYLE`。Bucket 保持私有，Web 与 Worker必须使用同一配置。切换前先迁移已有头像和附件对象。

邀请制由应用 CLI 创建邀请码：

```bash
nextbuf invite create --uses 1 --expires-hours 168 --label initial-admin
```

Docker 中使用 `docker compose run --rm --no-deps setup invite create ...`，或直接运行镜像的 `invite` 入口；源码开发环境使用 `pnpm nextbuf invite create ...`。邀请码只在创建时显示一次，数据库只保存 HMAC。

GitHub OAuth 可选，变量为 `GITHUB_CLIENT_ID` 和 `GITHUB_CLIENT_SECRET`，回调地址是 `${APP_URL}/api/auth/callback/github`。只配置其中一个会被启动校验拒绝。非开放注册模式不允许 OAuth 新建账号。

### 3.3 配置检查

```bash
docker compose --env-file .env -f compose.yml config
./nextbufctl doctor
```

依赖尚未启动时使用 `./nextbufctl init` 和 `docker compose config` 完成静态检查。`doctor` 是运行态诊断：它要求数据库、Redis、迁移、运行门禁、首次管理员、Worker、队列、SMTP 和存储都通过，并输出脱敏 JSON。

### 3.4 启动

```bash
./nextbufctl start
```

等价核心流程：

```bash
docker compose pull
docker compose up -d postgres redis
docker compose run --rm setup
docker compose up -d --no-deps web worker
docker compose ps
```

Compose 必须自动执行一次性 `setup`，等待 PostgreSQL、Redis 健康，并在 setup 成功后启动 Web 和 Worker。setup 失败时 Web/Worker 不得进入假健康状态。

检查：

```bash
./nextbufctl status
./nextbufctl logs web
./nextbufctl logs worker
```

### 3.5 首次管理员

1. 浏览器访问 `${APP_URL}/setup`。
2. 从服务器权限为 600 的 `.env` 读取 `SETUP_TOKEN`，不要通过聊天或 URL 查询参数传递。
3. 填写昵称、`@username`、邮箱和至少 12 位密码；账号由 Better Auth 创建。
4. 打开验证邮件并完成邮箱验证，再登录 `/admin`。
5. `installation.completed` 与管理员角色写入同一受控流程后，安装端点永久拒绝再次创建管理员。
6. 从 `.env` 删除 `SETUP_TOKEN`，运行 `docker compose up -d --force-recreate web`。
7. 在 `/admin/settings` 调整站点名称/注册策略并测试 SMTP、存储与 GitHub OAuth。

安装向导不得在已有用户或已初始化数据库上重新创建管理员。若令牌丢失且数据库还没有任何用户，生成新令牌并重建 Web；若已经留下用户或安装 claim，先备份并查看 `doctor`/Web 日志，不能直接修改数据库角色字段。

## 4. 宝塔面板安装

### 4.1 导入编排

1. 在宝塔 Docker 的“编排/Compose”中创建 NextBuf 项目。
2. 上传正式 `compose.yml` 和 `.env`，或粘贴 Release 中的精确内容。
3. 确认 PostgreSQL、Redis 端口没有发布到公网。
4. 将 Web 仅绑定到 `127.0.0.1:${WEB_PORT}`。
5. 启动整个编排，不单独手工启动某一个依赖容器。

预期四个运行中服务角色：

```text
web       NextBuf Web
worker    NextBuf Worker
postgres  PostgreSQL
redis     Redis
```

宝塔中实际容器名可能带 Compose 项目名前缀和序号，例如 `nextbuf-web-1`。官方 Compose 不应通过固定 `container_name` 阻止后续扩容；判断角色应看服务名 `web`、`worker`、`postgres`、`redis`。

setup 是一次性容器，成功退出属于正常状态；面板可能额外显示一个状态为 Exited(0) 的 setup 记录，但它不是常驻容器，也不应配置自动重启。

### 4.2 反向代理

在宝塔网站中：

1. 创建对应域名站点。
2. 申请并强制 HTTPS。
3. 反向代理到 `http://127.0.0.1:${WEB_PORT}`。
4. 转发 Host、真实协议和经过限制的客户端 IP 头。
5. 配置请求体上限不低于 `max(AVATAR_MAX_UPLOAD_BYTES, ATTACHMENT_MAX_UPLOAD_BYTES)`，同时保留合理余量供 multipart 开销。

应用只信任明确配置的宝塔/Nginx 代理地址，不能无条件接受任意 `X-Forwarded-For`。

### 4.3 宝塔升级

不要在面板中只把镜像标签改成 `latest`。按照“升级”章节先备份、修改精确版本、拉取镜像、迁移并观察健康状态。

## 5. 反向代理合同

最低要求：

- HTTP 重定向 HTTPS。
- 保留原始 Host 和协议。
- 设置合理上传上限和请求超时。
- WebSocket 若未来使用，需要显式转发 Upgrade 头。
- `/health/live` 可以供本机健康检查，但不向公网暴露内部诊断详情。
- 管理后台不通过静态缓存或 CDN 公共缓存。

官方发布提供 Nginx 示例，但域名、证书路径和代理 IP 必须由部署者确认，不能无脑覆盖宝塔生成配置。

## 6. 日常操作

### 状态

```bash
./nextbufctl status
./nextbufctl doctor
```

至少检查：Web readiness、Worker readiness、PostgreSQL、Redis、迁移版本、Outbox 积压和失败任务。

### 日志

```bash
./nextbufctl logs web
./nextbufctl logs worker
```

日志默认结构化并轮转。排障包必须脱敏 Cookie、Authorization、邮箱验证码、连接串密码和 Provider Secret。

### 重启

```bash
docker compose restart web
docker compose restart worker
```

不应为普通页面问题重启 PostgreSQL/Redis。Worker 重启前确保停止宽限期足以释放正在处理的任务锁。

## 7. 备份

### 7.1 备份内容

默认 local 存储的完整备份包含：

- PostgreSQL 一致性转储。
- 本地上传目录，或 S3 版本/清单。
- `.env` 中的实例密钥，单独加密保存。
- Compose、应用版本和迁移版本信息。
- 备份元数据和校验和。

Redis 不作为主要数据备份。Outbox 保证关键任务可以从 PostgreSQL 恢复投递。

### 7.2 执行

```bash
./nextbufctl backup
# 输出 backups/nextbuf-<version>-<UTC timestamp>.tar.gz
```

备份工具必须：

1. 检查剩余磁盘空间。
2. 使用与 PostgreSQL 主版本匹配的 `pg_dump`。
3. 记录应用、数据库和迁移版本。
4. 备份本地附件或生成对象存储清单。
5. 生成 `manifest.json` 和逐项 `SHA256SUMS`。
6. 临时文件失败时清理，不把半成品标成成功。

归档内 `config.env` 包含认证、邮件、数据库和对象存储秘密，文件权限为 600，但仍应在复制到异机前再次加密。S3 模式的工具只记录 Bucket/Endpoint 清单，`attachmentsIncluded=false`；必须另外启用 Bucket 版本控制、Provider 快照或对象复制，不能把该归档单独视为完整附件备份。

生产建议把备份复制到与应用服务器不同的存储，并设置保留策略。只在同一磁盘保留备份不能应对磁盘损坏。

### 7.3 验证

每个备份至少验证文件可读、校验和匹配和 PostgreSQL 转储清单可解析。定期在空环境执行完整恢复；没有恢复演练的备份不能视为可靠。

## 8. 恢复

恢复是破坏性操作，必须明确目标实例和备份来源。

```bash
./nextbufctl stop
./nextbufctl restore /path/to/nextbuf-backup.tar.gz
./nextbufctl start
./nextbufctl doctor
```

恢复工具必须在写入前显示：

- 目标数据库和数据卷。
- 备份创建时间、应用版本和数据库版本。
- 是否会覆盖现有数据。
- 附件和加密密钥是否齐全。

恢复到全新且允许删除现有 Compose 卷的演练命令：

```bash
./nextbufctl restore /path/to/backup.tar.gz --empty-install --restore-config
```

该命令必须人工输入 `YES`；自动化测试只可在隔离项目中使用 `NEXTBUFCTL_ASSUME_YES=1`。默认不覆盖当前 `.env`，并要求 `AUTH_SECRET`、`MAIL_PAYLOAD_KEY`、存储 driver（以及 S3 Bucket）与备份一致；只有与 `--empty-install` 同时使用的 `--restore-config` 才恢复全部配置和密钥，避免现有 PostgreSQL 卷密码与环境文件分叉。标准恢复流程：

1. 在隔离或维护状态停止 Web 和 Worker。
2. 备份当前残留状态，以便误操作回退。
3. 恢复 PostgreSQL。
4. 恢复附件和正确的 `ENCRYPTION_KEY`。
5. 使用与备份兼容的精确应用版本启动；`NEXTBUF_VERSION` 不匹配时 preflight 拒绝。
6. 必要时按版本顺序执行迁移。
7. 检查登录、主题、附件、邮件和 Worker。

禁止把较新数据库直接交给不兼容的旧应用镜像启动。

## 9. 升级

### 9.1 升级前

1. 阅读从当前版本到目标版本的全部发布说明。
2. 确认目标版本支持直接跨越；否则逐个中间版本升级。
3. 执行并验证完整备份。
4. 运行 `doctor` 和迁移预检。
5. 记录当前 `NEXTBUF_IMAGE`、`NEXTBUF_VERSION` 和迁移版本。

### 9.2 单机标准升级

```bash
./nextbufctl upgrade 1.2.3
```

工具内部实际流程：

```text
拉取目标镜像
验证目标是高于当前版本的精确 SemVer
创建并校验升级前备份
停止 Web 与 Worker
运行目标镜像的一次性 setup（先迁移，再协调运行时状态和周期任务）
以目标版本启动 Web 与 Worker
等待 readiness
执行冒烟检查
保留升级日志
```

升级不能只执行迁移后直接启动。目标版本 `setup` 是幂等升级入口，负责部署迁移、协调安装状态、注册目标版本需要的周期任务，并更新 `runtime.initialized`；它不会重复创建首位管理员。

PostgreSQL 和 Redis 不因每次应用补丁自动升级主版本。基础服务主版本升级使用独立指南和备份恢复测试。

### 9.3 升级后检查

- 首页、登录、主题页和后台可访问。
- Web 与 Worker 运行同一应用版本。
- 数据库迁移状态与镜像匹配。
- Outbox 和队列继续下降，没有持续失败任务。
- 邮件、附件和 OAuth Provider 正常。
- 错误率和资源占用没有异常上升。

## 10. 回滚

回滚分两类：

### 仅代码回滚

目标迁移向后兼容时，可以切回旧镜像并重新启动 Web/Worker。发布说明必须明确支持的回滚范围。

### 数据恢复回滚

迁移不可逆或旧代码不兼容新 Schema 时：

1. 停止 Web/Worker。
2. 恢复升级前数据库和附件备份。
3. 恢复旧版本配置和镜像。
4. 启动并执行完整检查。

不能承诺“改回镜像标签”就总能回滚。所有破坏性迁移必须在发布说明中突出标记。

## 11. 非 Docker 部署

### 11.1 系统布局

建议：

```text
/opt/nextbuf/releases/<version>/    不可变发布目录
/opt/nextbuf/current -> releases/... 当前版本符号链接
/etc/nextbuf/nextbuf.env            环境配置，权限 600
/var/lib/nextbuf/uploads            本地附件
/var/log/nextbuf                    日志（若不只输出 journald）
```

创建不可登录系统用户 `nextbuf`，不得以 root 运行应用。

### 11.2 安装流程

1. 安装 Node.js 24 LTS、PostgreSQL 18 客户端/服务、Redis 8 和反向代理。
2. 验证发布包校验和。
3. 解压到版本目录，设置 `nextbuf` 用户只读应用权限。
4. 创建 `/etc/nextbuf/nextbuf.env` 并运行配置检查。
5. 进入 `runtime/`，执行 `deploy/bin/nextbuf migrate` 和 `deploy/bin/nextbuf setup`。
6. 安装并启用 `nextbuf-web.service`、`nextbuf-worker.service`。
7. 配置 Nginx/Caddy 和 HTTPS。

复制发布包中的两个 systemd 单元到 `/etc/systemd/system/`，创建 `/var/lib/nextbuf/uploads` 与 `/var/lib/nextbuf/cache` 并归属 `nextbuf` 用户，然后执行 `systemctl daemon-reload && systemctl enable --now nextbuf-web nextbuf-worker`。PM2 用户使用 `pm2 start deploy/pm2/ecosystem.config.cjs`，仍然是两个独立 app。

### 11.3 非 Docker 升级

新版本解压到新目录，先执行预检和迁移，再切换 `current` 符号链接并重启两个服务。不要直接覆盖正在运行的版本目录，否则无法可靠回退代码。

## 12. 外部 PostgreSQL/Redis/S3

使用托管依赖时：

- 从 Compose 中禁用内置 PostgreSQL/Redis 服务或使用官方外部依赖 override。
- `DATABASE_URL`、`REDIS_URL` 使用 TLS 和最小权限账号。
- 确认 Redis 支持 BullMQ 命令和持久化需求。
- 多实例强制使用 S3 或可靠共享文件系统。
- S3 Bucket 保持私有，并允许 Web/Worker 读写原件、派生文件和删除已确认的孤儿对象。
- 备份责任需要明确由托管服务还是 NextBuf 运维承担。

切换存储前必须迁移已有附件并验证对象键，不能只修改 `STORAGE_DRIVER`。

## 13. 常见故障

### setup 退出且 Web 未启动

这是保护行为。查看 setup 日志，通常是数据库不可达、迁移失败、密钥无效或已有不兼容 Schema。不要删除迁移表强行启动。

### Web 正常但 Worker 不健康

检查 Redis、数据库、Worker 配置、任务注册和停止锁。Web 可以继续提供只读或部分功能，但后台必须显示通知/邮件可能延迟。

### PostgreSQL 容器重建后数据为空

立即停止写入，检查 PostgreSQL 18 卷是否挂载 `/var/lib/postgresql`，不要在错误的新空库继续初始化。

### 登录后循环跳转或 Cookie 不生效

检查 `APP_URL`、HTTPS、Host、代理协议头和可信代理设置。不要通过关闭 Secure Cookie 解决生产 HTTPS 配置错误。

### 上传成功但重启后附件丢失

检查 `nextbuf_uploads` 命名卷是否仍挂载到 Web/Worker；非 Docker 检查 `STORAGE_LOCAL_PATH`。多实例检查是否错误使用各自独立的本地存储。

### 邮件积压

检查 Worker、SMTP、`email_deliveries`、Outbox 和失败任务。确认 `MAIL_PAYLOAD_KEY` 与创建邮件时一致；密钥错误不能靠重试恢复。修复后重放幂等任务，不直接在数据库把所有任务标成成功。

### 验证或重置链接全部失效

检查是否轮换了 `AUTH_SECRET`、修改了 `APP_URL`，或验证记录已过期。`AUTH_SECRET` 同时参与 Cookie 签名和验证标识 HMAC，轮换会按设计使旧会话与未使用链接失效。

## 14. 上线检查清单

- 使用精确应用版本和经过验证的镜像。
- PostgreSQL、Redis 不暴露公网。
- HTTPS、`APP_URL` 和可信代理正确。
- 默认密码和示例密钥已替换。
- 首次安装 token 已失效。
- 邮箱验证、重置密码和发件地址测试成功。
- 附件持久化和恢复测试成功。
- 完整备份已复制到异机并验证。
- 管理员二次验证按当前版本能力启用。
- 日志脱敏、轮转和磁盘告警有效。
- Web/Worker readiness 和队列积压可观察。
- 已阅读当前版本已知问题和回滚限制。

## 15. 文档实现责任

`v0.12.0` 交付物包括：

- `compose.yml`。
- `.env.example`。
- `nextbufctl`。
- 宝塔安装步骤。
- 非 Docker systemd 单元。
- 备份/恢复和升级/回滚工具。
- 本文中的全部核心命令。

CI 在定时、手动和正式标签运行中使用原生 amd64/arm64 Runner 执行真实 setup、Web/Worker 健康和一次性管理员冒烟；amd64 额外把 PostgreSQL、配置和附件备份恢复到删除卷后的空安装。普通主分支提交只追加原生 amd64 冒烟，避免重复执行正式发布构建。非 Docker x64 包会在标签运行中解压并执行内置版本命令。生产部署者仍应在自己的域名、SMTP、对象存储和备份目标上完成上线清单，因为 CI 不能替代实例级凭据和灾难恢复演练。

`v0.13.0` 的 `nextbufctl doctor` 同时输出 PostgreSQL 数据量/连接、Redis 内存/淘汰策略、Worker 并发和 Queue/Outbox/邮件积压。报告不包含连接串和凭据，可以用于工单诊断；但仍应在分享前检查实例名称、对象存储桶名和业务规模是否属于不应公开的信息。
