# 安装与运维运行手册

本文定义 NextBuf 面向部署者的目标操作流程，包括 Docker Compose、宝塔、非 Docker、升级、备份、恢复和故障排查。

> 当前实现状态：已发布 `v1.0.1` 交付生产镜像、四容器 Compose、无需 `.env` 且固定容器名的宝塔单文件入口、通用空节点安装、首位用户 UID 1、官方 shadcn/ui 前后台、`nextbufctl`、首次管理员、可验证备份恢复与稳定升级。当前 `v1.0.2` 是以 `1.0.1` 为直接基线、无新迁移和配置的性能补丁。容器/恢复验收由 GitHub Actions 在 Linux amd64/arm64 上执行；Mailpit 只出现在测试覆盖中，不进入生产拓扑。长期决策见 [ADR-0015](./adr/0015-production-packaging-setup-and-recovery.md)、[ADR-0016](./adr/0016-panel-friendly-compose-bootstrap.md)、[ADR-0017](./adr/0017-single-file-panel-compose.md)、[ADR-0019](./adr/0019-editor-autosave-idempotency-and-draft-privacy.md) 和 [ADR-0020](./adr/0020-stable-release-channels-and-lifecycle.md)。

## 1. 发布包合同

每个正式版本至少发布：

```text
nextbuf-release/
├─ compose.yml
├─ compose.baota.yml          宝塔单文件入口，不使用 .env
├─ .env.example
├─ nextbufctl
├─ runtime/                    非 Docker Web/Worker/CLI/生产依赖；服务工作目录
│  └─ deploy/bin/
│     ├─ nextbuf              CLI 包装器
│     └─ nextbuf-service      Web/Worker 服务包装器
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
./nextbufctl backup --baota <deployed-compose.baota.yml>
./nextbufctl restore <backup-file> [--keep-stopped]
./nextbufctl upgrade <version>
```

高级用户可以直接使用文档列出的等价 `docker compose` 命令。

## 2. Docker Compose 前置条件

- 64 位 Linux，amd64 或 arm64。
- Docker Engine 和 Compose v2。
- util-linux `flock`（多数发行版默认安装），用于串行化启动、停止、备份、恢复和升级。
- `tar`、`sha256sum` 和至少能容纳数据库与附件两倍大小再加 100 MiB 余量的备份目录。
- 一个解析到服务器的域名。
- 可用的 80/443 端口或已有反向代理。
- SMTP 服务；正式开放注册前必须验证邮件。
- 足够的磁盘用于 PostgreSQL、附件、日志和备份。

最低 2 vCPU、4 GiB RAM 和 40 GiB 可用 SSD；公开站点建议 4 vCPU、8 GiB RAM 起步。完整档位、连接计算和图片处理边界见[部署与运维](./05-deployment-operations.md#15-最低资源与容量)。

预标签候选验收还需要 Git、curl、Node.js 24 和 Docker Buildx（`docker buildx version`）；它们用于核对冻结 commit、等待 loopback Registry、按 Digest 复制完整 OCI index和验证双架构/attestation，不是普通稳定版安装依赖。开始验收前逐项执行 `git --version`、`curl --version`、`node --version`、`docker buildx version` 和 `docker compose version`，并确认 Node 主版本为 24；任一命令失败都先补齐工具，不能在复制镜像中途临时改流程。

## 3. Docker 首次安装

### 3.1 获取发布文件

只从正式 Release 下载与目标版本匹配的发布包，并验证 `checksums.txt`。使用 `nextbufctl` 的受控生产环境采用精确版本：

```dotenv
NEXTBUF_IMAGE=<正式发布时确定的镜像地址>
NEXTBUF_VERSION=1.0.2
```

宝塔单文件入口是明确例外：它使用只随最新完整稳定 Release 更新的 `latest`，不需要在每个补丁中手工改版本号。通过完整主分支门槛的候选发布到 `edge` 与不可变 `sha-*`，不会进入默认稳定通道。精确 SemVer 仍属于可复现 Release 和受控部署；该入口的升级和回滚边界见第 4 节与 ADR-0020。

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
TOPIC_VIEW_PREVIOUS_AUTH_SECRETS=[]
SETUP_TOKEN=<至少 32 位的一次性随机令牌>
AUTH_REGISTRATION_MODE=invite
MAIL_PAYLOAD_KEY=<Base64 编码的 32 字节随机值>
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_CONNECTION_TIMEOUT_MS=15000
SMTP_GREETING_TIMEOUT_MS=15000
SMTP_SOCKET_TIMEOUT_MS=60000
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

全新安装把 `TOPIC_VIEW_PREVIOUS_AUTH_SECRETS` 保持为 `[]`。轮换 `AUTH_SECRET` 时，先把即将替换的旧值作为 JSON 字符串加入该数组，再写入新的 `AUTH_SECRET`，然后同时重建全部 Web 与 Worker。JSON 编码必须保留密钥中的空白、逗号和其他字符，不能手工改成逗号分隔文本。旧值只用于注销时计算并清理历史用户浏览桶，不会继续验证 Cookie、验证/重置链接或新浏览；因此轮换仍会立即注销旧会话并使未使用链接失效。

记录最后一个旧 Web 停止写入的 UTC 时间。旧值至少保留到该时间 30 天之后，并且下面的查询返回 `0` 后才能从数组移除；未聚合浏览事实会一直保留到对应 Outbox 成功，因此只经过 30 天并不构成移除证据。Worker 每分钟最多清理 500 条已聚合且超过 30 天的桶，积压时继续保留旧值并先修复 Worker/Outbox。数组最多 8 个且不能包含当前 `AUTH_SECRET`；修改后再次同时重建 Web 与 Worker。

```sql
SELECT count(*)
FROM interaction_topic_views
WHERE created_at <= TIMESTAMPTZ '<最后一个旧 Web 停止写入的 UTC 时间>';
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
docker compose up -d
docker compose ps
```

默认 Compose 先启动 PostgreSQL/Redis；Web 等待二者健康，在自己的启动阶段幂等执行 setup 和 preflight，最后启动 Next.js。Worker 只在 Web 健康后启动。setup 或 preflight 失败时 Web 不会健康、Worker 不会启动，不能产生假健康状态，也不会留下一个正常退出却被面板误报的 setup 容器。

升级、恢复和人工排障仍可显式执行 `docker compose run --rm setup`。该服务位于 `tools` profile，只有明确运行这条命令时才临时创建，结束后由 `--rm` 删除。

检查：

```bash
./nextbufctl status
./nextbufctl logs web
./nextbufctl logs worker
```

### 3.5 首次管理员

1. 浏览器访问 `${APP_URL}`；未完成安装时服务端自动临时重定向到 `/setup`。
2. 受控入口从服务器权限为 600 的 `.env` 读取 `SETUP_TOKEN`；宝塔单文件入口从编排内容读取。不要通过聊天或 URL 查询参数传递。
3. 填写昵称、`@username`、邮箱和至少 12 位密码；账号由 Better Auth 创建。
4. 打开验证邮件并完成邮箱验证，再登录 `/admin`。
5. `installation.completed` 与管理员角色写入同一受控流程后，安装端点永久拒绝再次创建管理员。
6. 从 `.env` 或 `compose.baota.yml` 删除 `SETUP_TOKEN`，再重建 Web；单文件模板中的 Worker 共享环境时一并重建。
7. 登录 `/admin/nodes`，创建至少一个适合当前社区的节点；发行版不会内置 AI、主机或域名等业务分类。
8. 在 `/admin/settings` 调整站点名称/注册策略并测试 SMTP、存储与 GitHub OAuth。

安装向导不得在已有用户或已初始化数据库上重新创建管理员。若令牌丢失且数据库还没有任何用户，生成新令牌并重建 Web；若已经留下用户或安装 claim，先备份并查看 `doctor`/Web 日志，不能直接修改数据库角色字段。

## 4. 宝塔面板安装

### 4.1 导入编排

1. 在宝塔 Docker 的“编排/Compose”中创建 NextBuf 项目。
2. 粘贴 Release 中完整的 `compose.baota.yml`；该文件不需要 `.env`。
3. 把所有 `replace-` 占位值替换为独立随机值，重新生成 `MAIL_PAYLOAD_KEY`，并修改 `APP_URL`、`SMTP_HOST`、`SMTP_USER`、`SMTP_PASSWORD` 和 `SMTP_FROM`。连接串和数据库/Redis 服务中重复的密码必须一致；`AUTH_SECRET`、`SETUP_TOKEN` 和 `MAIL_PAYLOAD_KEY` 不能复用。
4. 确认 PostgreSQL、Redis 端口没有发布到公网，Web 只绑定到 `127.0.0.1:3000`。
5. 启动整个编排，不单独手工启动某一个依赖容器。

这与把值写入 `.env` 的安全责任相同：Compose 本身包含数据库密码、会话密钥、邮件加密密钥和首次安装令牌，不得公开截图、上传到公开仓库或交给无关人员。正式模板中的示例密钥会被生产启动校验拒绝，不能原样启动。

预期四个运行中服务角色：

```text
nextbuf           NextBuf Web
nextbuf-worker    NextBuf Worker
nextbuf-postgres  PostgreSQL
nextbuf-redis     Redis
```

宝塔单文件模板固定上述四个容器名，因此不会出现 `web-1` 或 Compose 项目序号。容器在面板中的排列顺序由宝塔的排序方式和依赖创建顺序决定，不能由 Compose 可靠控制，也不代表健康状态。固定名称适合单机单实例；同一 Docker 主机运行多套 NextBuf 或横向扩容时应改用 `compose.yml + .env + nextbufctl`，由 Compose 管理项目隔离和实例序号。

从 `v0.13.2` 宝塔模板更新时，先备份 PostgreSQL 和附件卷，再停止编排、替换模板并选择重建。PostgreSQL、Redis 和 Worker 会按同一服务更新容器名；主应用服务从 `web` 改为 `nextbuf`，若面板重建后仍保留旧 `web-1`，只删除这个旧应用容器并再次启动编排，不要删除任何命名卷。

全新安装不应出现 `nextbuf-setup-1`，左侧编排状态应由上述四个常驻容器决定。从早期 `v0.13.0` Compose 更新时，如果面板仍保留旧的 `nextbuf-setup-1` 停止记录，只删除这个容器并重新启动编排；不要删除 `postgres`、`redis`、`web`、`worker` 或任何命名卷。使用 `./nextbufctl start` 会自动清理该旧记录。

### 4.2 反向代理

在宝塔网站中：

1. 创建对应域名站点。
2. 申请并强制 HTTPS。
3. 反向代理到 `http://127.0.0.1:${WEB_PORT}`。
4. 转发 Host、真实协议和经过限制的客户端 IP 头。
5. 配置请求体上限不低于 `max(AVATAR_MAX_UPLOAD_BYTES, ATTACHMENT_MAX_UPLOAD_BYTES)`，同时保留合理余量供 multipart 开销。

应用按 Better Auth 的 IP 解析规则处理 `X-Forwarded-For`：单一反代必须覆盖客户端传入的头；多级反代只有右侧代理全部命中 `AUTH_TRUSTED_PROXIES` 的 IP/CIDR 才会解析客户端地址。不要使用 `$proxy_add_x_forwarded_for` 直接把公网客户端提供的头转发给应用。

### 4.3 宝塔升级

`compose.baota.yml` 固定使用默认稳定 `latest` 通道，后续无需修改版本号。升级前先确认 GitHub Release 已完整发布、阅读目标版本的迁移与回退说明，并使用同版本 Release 中的 `nextbufctl backup --baota` 生成第 4.4 节定义的完整归档；不能把仅有 PostgreSQL、仅有面板卷快照或没有校验清单的文件称为完整 NextBuf 备份。验证归档后，在面板拉取 `ghcr.io/xwordsman/nextbuf:latest` 并重建 Web/Worker，Web 会在进入健康状态前执行幂等迁移和 preflight。

`latest` 只在最新稳定标签的不可变 SemVer 镜像和 GitHub Release 资产全部成功后更新，不会让已经运行的容器自行变化；`v0.x` 与带后缀的预发布标签不会移动它。每次宝塔升级后记录精确 SemVer、镜像 Digest 与 `/api/version` 返回的 commit；若需要精确回滚点、原子备份和恢复校验，改用 `compose.yml + .env + nextbufctl` 受控入口，或临时固定为已记录的正式 SemVer/`sha-<提交>`。数据库迁移成功后不能仅拉取旧镜像回滚，仍遵守第 7 节恢复边界。

### 4.4 宝塔生产导出到受控 Compose

宝塔面板中当前实际使用的编排全文先导出为服务器上的权限 600 文件，例如 `/root/nextbuf-live-compose.yml`。必须是带真实配置、能解析到当前四个固定容器的文件，不是仓库中的占位模板。随后从与当前目标 Release 或冻结候选 commit 匹配的干净目录执行：

```bash
chmod 600 /root/nextbuf-live-compose.yml
NEXTBUF_BACKUP_DIR=/root/nextbuf-restricted-backups \
  ./nextbufctl backup --baota /root/nextbuf-live-compose.yml
```

该命令只支持官方单实例固定容器名，并执行以下门槛：

1. 实际编排先复制为权限受限的不可变操作快照；后续解析、身份核对和归档只使用同一快照。该快照经 `docker compose config` 解析后必须且只能包含 `nextbuf`、`worker`、`postgres`、`redis` 四个服务，并精确解析到 `nextbuf`、`nextbuf-worker`、`nextbuf-postgres`、`nextbuf-redis`，四者开始时都健康；额外写进程不会被猜测或静默忽略。
2. 解析后的 Compose 声明环境必须与运行容器逐项相同；Web/Worker 还必须完整匹配 NextBuf 受管环境（包括 `.env.example` 键和 `NODE_ENV`），而镜像自带的 `PATH`、Node 版本等基础元数据不作为部署漂移。数据库/Redis 的身份与密码合同也必须匹配；数据库和 Redis URL 必须指向该编排中的 `postgres` 与 `redis`，local 存储必须使用 `/app/data/uploads`。Web/Worker 必须共享同一个附件命名卷，PostgreSQL 与 Redis 必须使用带当前 Compose 项目/逻辑卷标签的各自预期挂载点。文件过期、容器被其他编排重建、外部数据库、附件路径或卷归属漂移都会中止。
3. 从实际应用 image config 读取 SemVer、完整 commit 和构建时间，原样记录 RepoTags/RepoDigests、四个容器 config ID、Compose 项目和卷名。RepoDigest 仍只是原样事实，不能冒充 OCI index 证明。
4. 先停止 Worker，再停止 Web，并再次证明两者均未运行；随后在同一停写窗口生成 PostgreSQL custom dump 和 local 附件归档/逐对象 SHA-256。S3 模式只记录 Provider 清单，必须另有同一维护窗口的 Bucket 版本/快照身份。
5. 生成可供受控 `compose.yml` 使用的 `config.env`、源 `compose.baota.yml`、`source-deployment.json`、`manifest.json` 和内部 `SHA256SUMS`，以临时文件原子完成归档，并为归档本身生成 `.sha256`。Compose 与运行容器同时不存在的受管变量在 `config.env` 中继续省略，不从 `.env.example` 重新注入示例值；已删除的 `SETUP_TOKEN` 因而保持删除，未显式配置的选项继续使用同一运行时默认值。`AUTH_SECRET` 及历史密钥中的空格、Tab、`$`、`#`、反斜线和单双引号按 Compose dotenv 语义转义并无损保留；换行、NUL 和其他不受支持的控制字节会使导出失败。
6. 成功或失败后只恢复原本由命令停止的 Web/Worker；成功返回前两者必须重新健康。收到中断信号时，工具会先等待可能仍在 Docker daemon 中执行的 stop，再进行有界启动重试；若最终仍未恢复，会明确报告容器状态并以失败退出。若恢复失败，完整归档仍保留，但必须立即处理线上服务状态。helper 文件通过临时容器的 `docker cp` 交换，不依赖宿主 UID/GID bind mount 或 SELinux 标签。

归档及其 `.sha256` 必须复制到异机加密受限目录。先执行：

```bash
cd /root/nextbuf-restricted-backups
sha256sum -c nextbuf-<version>-<time>-<pid>.tar.gz.sha256
tar -tzf nextbuf-<version>-<time>-<pid>.tar.gz
```

正式 `v1.0.0` 验收不在宝塔现网直接升级。把归档复制到独立主机/daemon 的受控发布目录，持续设置专用项目名，然后恢复但保持写进程停止：

```bash
export COMPOSE_PROJECT_NAME=nextbuf-v1-production-copy
./nextbufctl restore /restricted/nextbuf-<version>-<time>-<pid>.tar.gz \
  --empty-install --restore-config --keep-stopped
```

此时 PostgreSQL 数据库与附件已恢复，空 Redis 已重建并启动，幂等 setup 已完成，Web/Worker 尚未启动。立即编辑恢复出的 `.env`：

- `APP_URL`、`WEB_PORT`、`AUTH_TRUSTED_ORIGINS` 和 `AUTH_TRUSTED_PROXIES` 指向隔离域名/代理。
- SMTP 指向 Mailpit 或专用验收收件域，GitHub OAuth 清空或改为验收应用；不能保留生产邮件投递能力。
- local 存储继续使用恢复卷；S3 改为从同一快照复制出的隔离 Endpoint/Bucket/凭据，并禁止写生产 Bucket。
- 保留 `AUTH_SECRET`、`TOPIC_VIEW_PREVIOUS_AUTH_SECRETS`、`MAIL_PAYLOAD_KEY`、来源 `NEXTBUF_VERSION` 以及当前恢复卷对应的 PostgreSQL/Redis 凭据。密钥连续性是登录、Session、邮件载荷和验收 HMAC 的一部分；恢复器通过 Compose 解码后的值校验连续性，不比较 dotenv 引号的表面写法。

保存隔离 `.env` 的 SHA-256 到受限证据目录，执行 `docker compose --env-file .env -f compose.yml config --quiet`，确认网络出口和 Provider 已隔离后才运行 `./nextbufctl start`。先核对来源版本、登录、UID、内容、附件和 Worker，再按公开路径执行 `0.13.8 -> 0.13.10`；中间版本重新完整备份后，才进入本手册的候选 Registry 和 `0.13.10 -> 1.0.0` 流程。原始宝塔归档保持不变，不用编辑归档内文件来伪造隔离配置。

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

Redis 不作为主要数据备份。Outbox 保证关键任务可以从 PostgreSQL 恢复投递：已发布、`processed_at` 为空且没有未重放最终失败的事件在默认 5 分钟等待窗口后，由每分钟 Worker 维护任务以稳定 Job ID 自动重新确认入队；已完成历史不再参与扫描，已执行旧重放记录不阻断后续 Redis 丢失恢复，新最终失败则重新阻断。重建空 Redis 或清空队列后无需手工修改 `published_at`，应保持 Worker 运行并观察 Outbox、Queue 和失败任务积压下降。

### 7.2 执行

```bash
./nextbufctl backup
# 输出 backups/nextbuf-<version>-<UTC timestamp>-<process id>.tar.gz

# 官方宝塔四容器入口；参数必须是面板当前实际使用的完整编排
./nextbufctl backup --baota /root/nextbuf-live-compose.yml
# 额外输出同名 .tar.gz.sha256
```

`nextbufctl` 使用发布目录中的 `.nextbufctl.lock` 获取非阻塞内核文件锁；另一个启动、停止、备份、恢复或升级仍在运行时，新操作会立即退出，不会与数据库转储或附件归档交错。锁随进程退出自动释放，锁文件本身保留是正常现象。

备份工具必须：

1. 检查剩余磁盘空间。
2. 使用与 PostgreSQL 主版本匹配的 `pg_dump`。
3. 记录应用、数据库和迁移版本。
4. 备份本地附件或生成对象存储清单。
5. 生成 `manifest.json` 和逐项 `SHA256SUMS`。
6. 临时文件失败时清理，不把半成品标成成功。

归档内 `config.env` 包含认证、邮件、数据库和对象存储秘密，文件权限为 600，但仍应在复制到异机前再次加密。S3 模式的工具只记录 Bucket/Endpoint 清单，`attachmentsIncluded=false`；必须另外启用 Bucket 版本控制、Provider 快照或对象复制，不能把该归档单独视为完整附件备份。

宝塔导出生成相同的 `nextbuf-backup-v1` 主格式，并额外包含源编排与 `source-deployment.json`。后者记录实际版本、commit、image config ID、RepoDigest 原样值、Compose 项目、四个容器及三个命名卷，不包含环境变量秘密；真实配置在同一加密归档的 `config.env` 与 `source-compose.baota.yml` 中。源编排与运行环境、容器/卷归属任一不一致时不会生成归档。

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

从生产备份建立隔离副本时必须增加：

```bash
./nextbufctl restore /path/to/backup.tar.gz \
  --empty-install --restore-config --keep-stopped
```

`--keep-stopped` 在恢复 PostgreSQL 与附件、重建并启动空 Redis、完成幂等 setup 后返回，但不创建/启动 Web 与 Worker。它用于先替换生产 `APP_URL`、SMTP、OAuth、代理和 S3 Provider，再由运维显式执行 `./nextbufctl start`；不带该参数的普通灾难恢复继续在恢复后等待 Web/Worker 健康。

该命令必须人工输入 `YES`；自动化测试只可在隔离项目中使用 `NEXTBUFCTL_ASSUME_YES=1`。默认不覆盖当前 `.env`，并要求 `AUTH_SECRET`、`TOPIC_VIEW_PREVIOUS_AUTH_SECRETS`、`MAIL_PAYLOAD_KEY`、存储 driver（以及 S3 Bucket）与备份一致；旧备份缺少历史列表时按 `[]` 解释。只有与 `--empty-install` 同时使用的 `--restore-config` 才恢复全部配置和密钥，避免现有 PostgreSQL 卷密码与环境文件分叉。标准恢复流程：

1. 在隔离或维护状态停止 Web 和 Worker。
2. 备份当前残留状态，以便误操作回退。
3. 恢复 PostgreSQL。
4. 恢复 local 附件或同窗口 S3 Provider 快照，并保持 `AUTH_SECRET`、`TOPIC_VIEW_PREVIOUS_AUTH_SECRETS`、`MAIL_PAYLOAD_KEY` 与存储配置连续。
5. 使用与备份兼容的精确应用版本启动；`NEXTBUF_VERSION` 不匹配时 preflight 拒绝。
6. 必要时按版本顺序执行迁移。
7. 隔离恢复先确认 Provider 已改到隔离资源，再启动 Web/Worker；检查登录、主题、附件、邮件和 Worker。

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
# 正式验收或存储迁移演练同时逐个读取并校验原始/派生附件对象
./nextbufctl upgrade 1.2.3 --verify-objects
```

工具内部实际流程：

```text
拉取目标镜像
验证目标是高于当前版本的精确 SemVer
创建并校验升级前备份
停止 Web 与 Worker
由目标镜像在只读、可重复读事务中生成升级前脱敏验收快照
运行目标镜像的一次性 setup（先迁移，再协调运行时状态和周期任务）
在 Web/Worker 尚未启动时生成升级后快照并严格比较稳定事实
以目标版本启动 Web 与 Worker
等待 readiness
执行冒烟检查
保留升级日志、两份快照、比较报告和各自 SHA-256
```

升级不能只执行迁移后直接启动。目标版本 `setup` 是幂等升级入口，负责部署迁移、协调安装状态、注册目标版本需要的周期任务，并更新 `runtime.initialized`；它不会重复创建首位管理员。验收采集器由目标镜像执行，因此能在迁移前读取 `v0.13.10` 公共 Schema，也能在迁移后检查目标 Schema；两次都从同一 `AUTH_SECRET` 派生域隔离 HMAC 密钥，只输出表/分组计数、不可逆摘要、迁移身份和结构校验结果。邮箱、用户名、UID/UUID、正文、草稿、密码哈希、OAuth Token、Cookie/Session、IP/User-Agent、附件对象键和治理详情不会写入 JSON。

稳定事实包括 active 用户身份、Better Auth 凭据与 Session、节点/主题/楼层/修订、草稿、提及、附件引用、互动、通知、角色、治理、信任、设置及持久任务事实。账号注销、Outbox `processed_at` 和邮件 attempt fencing 三条迁移允许的确定变换由独立后置检查证明，不会用笼统的“忽略差异”跳过。任一稳定指纹、迁移身份、完整性或附件校验失败时，`NEXTBUF_VERSION` 保持目标版本、Web/Worker 保持停止，并报告升级前备份和比较文件；此时按第 10 节恢复，不能删除证据后强行启动。

`--verify-objects` 会逐个读取数据库引用的 local/S3 原始附件，核对数据库 SHA-256，并确认派生对象存在；社区较大时会延长停写窗口。普通升级仍生成数据库不变量快照，但省略逐对象 I/O。正式版真实数据副本验收必须启用该选项。

#### 未公开 SemVer 候选的隔离 Registry

正式 SemVer 标签创建前，远端 Registry 中还没有 `1.0.0`。只在 Docker 本地创建同名 tag 不构成可执行或可复核的候选：`nextbufctl start`、`acceptance capture/compare` 和 `upgrade` 都会先执行 `docker compose pull`，远端标签缺失时会失败；忽略拉取失败还会失去不可变 Digest 约束。

在已经完成 `0.13.8 -> 0.13.10`、准备执行候选验收的隔离主机上，启动只绑定 loopback 的临时 Registry，把当前 `0.13.10` 基线和已冻结候选的完整 OCI index 都从记录的 Digest 复制进去。必须复制当前基线，因为 `nextbufctl upgrade` 在切换目标版本前会用当前版本的 setup 容器创建备份。命令从冻结候选 commit 的干净仓库检出根目录执行，以使用同一 commit 的 OCI 身份验证脚本；正式 Release 的精简归档不包含该维护脚本。仓库只提供验证器，镜像仍必须来自下面记录的 Digest，不能从检出源码构建：

```bash
set -eu

SOURCE_IMAGE=ghcr.io/xwordsman/nextbuf
LOCAL_REGISTRY=127.0.0.1:5510
LOCAL_IMAGE=$LOCAL_REGISTRY/nextbuf
REGISTRY_CONTAINER=nextbuf-v1-acceptance-registry
CANDIDATE_COMMIT=CANDIDATE_FULL_GIT_COMMIT

BASELINE_VERSION=0.13.10
BASELINE_INDEX_DIGEST=sha256:BASELINE_INDEX_DIGEST
CANDIDATE_VERSION=1.0.0
CANDIDATE_INDEX_DIGEST=sha256:CANDIDATE_INDEX_DIGEST
CANDIDATE_AMD64_DIGEST=sha256:CANDIDATE_AMD64_DIGEST
CANDIDATE_ARM64_DIGEST=sha256:CANDIDATE_ARM64_DIGEST

[ "$(git rev-parse HEAD)" = "$CANDIDATE_COMMIT" ]
[ -z "$(git status --porcelain)" ]

docker run -d \
  --name "$REGISTRY_CONTAINER" \
  --restart unless-stopped \
  -p 127.0.0.1:5510:5000 \
  registry:2.8.3

attempt=0
until curl --fail --silent "http://$LOCAL_REGISTRY/v2/" >/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || {
    docker logs "$REGISTRY_CONTAINER"
    exit 1
  }
  sleep 1
done

copy_exact_index() {
  version=$1
  expected_digest=$2
  source_actual=$(docker buildx imagetools inspect \
    "$SOURCE_IMAGE@$expected_digest" --format '{{.Manifest.Digest}}')
  [ "$source_actual" = "$expected_digest" ] || {
    printf 'source digest mismatch for %s: %s\n' "$version" "$source_actual" >&2
    return 1
  }

  docker buildx imagetools create \
    --tag "$LOCAL_IMAGE:$version" \
    "$SOURCE_IMAGE@$expected_digest"

  local_actual=$(docker buildx imagetools inspect \
    "$LOCAL_IMAGE:$version" --format '{{.Manifest.Digest}}')
  [ "$local_actual" = "$expected_digest" ] || {
    printf 'local digest mismatch for %s: %s\n' "$version" "$local_actual" >&2
    return 1
  }
}

copy_exact_index "$BASELINE_VERSION" "$BASELINE_INDEX_DIGEST"
copy_exact_index "$CANDIDATE_VERSION" "$CANDIDATE_INDEX_DIGEST"

sh scripts/verify-oci-image-identity.sh \
  "$LOCAL_IMAGE:$CANDIDATE_VERSION" \
  "$CANDIDATE_INDEX_DIGEST" \
  "$CANDIDATE_AMD64_DIGEST" \
  "$CANDIDATE_ARM64_DIGEST"

docker pull "$LOCAL_IMAGE:$BASELINE_VERSION"
docker pull "$LOCAL_IMAGE:$CANDIDATE_VERSION"

SERVER_ARCH=$(docker version --format '{{.Server.Arch}}')
case "$SERVER_ARCH" in
  amd64) CANDIDATE_PLATFORM_DIGEST=$CANDIDATE_AMD64_DIGEST ;;
  arm64) CANDIDATE_PLATFORM_DIGEST=$CANDIDATE_ARM64_DIGEST ;;
  *) printf 'unsupported acceptance architecture: %s\n' "$SERVER_ARCH" >&2; exit 1 ;;
esac
CANDIDATE_CONFIG_DIGEST=$(docker buildx imagetools inspect \
  "$LOCAL_IMAGE@$CANDIDATE_PLATFORM_DIGEST" --raw |
  node -e 'const fs=require("node:fs"); const value=JSON.parse(fs.readFileSync(0,"utf8")); if (!value.config?.digest) process.exit(1); process.stdout.write(value.config.digest)')
LOCAL_CONFIG_ID=$(docker image inspect \
  --format '{{.Id}}' "$LOCAL_IMAGE:$CANDIDATE_VERSION")
[ "$LOCAL_CONFIG_ID" = "$CANDIDATE_CONFIG_DIGEST" ]
```

最后两次 pull 必须都成功；它们证明当前 Docker Engine 可以从 loopback Registry 取得本机架构的完整配置和层，而不只是读取顶层 index。复制成功后，在隔离实例 `.env` 中设置：

```dotenv
NEXTBUF_IMAGE=127.0.0.1:5510/nextbuf
NEXTBUF_VERSION=0.13.10
```

全新安装、生产恢复和合成覆盖副本必须使用三个独立工作目录。若它们共享一个 Docker daemon，每个目录在执行任何 `nextbufctl` 或 `docker compose` 命令前都要持续导出各自唯一的项目名，例如：

全新安装目录：

```bash
export COMPOSE_PROJECT_NAME=nextbuf-v1-fresh
```

生产恢复目录：

```bash
export COMPOSE_PROJECT_NAME=nextbuf-v1-production-copy
```

合成覆盖目录：

```bash
export COMPOSE_PROJECT_NAME=nextbuf-v1-synthetic
```

三个值分别在各自工作目录使用，不能在同一目录轮换或同一个 Shell 中连续执行。`COMPOSE_PROJECT_NAME` 的优先级高于 Compose 文件内的 `name: nextbuf`，并由 `nextbufctl` 继承；每次重新登录或自动化执行都必须恢复同一个值。开始验收前用 `docker compose --env-file .env -f compose.yml config | sed -n 's/^name: //p'` 核对项目名，并分别用 `docker volume ls --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME"` 与 `docker network ls --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME"` 保存隔离证据。任何两个副本共享项目标签、命名卷或网络时立即停止。宝塔模板固定 `container_name`，其候选验收必须放在没有同名容器的独立 Docker daemon/主机，不能与上述副本或线上实例共用 daemon。

先运行 `docker compose --env-file .env config --images`，确认五个应用入口都解析到本地 Registry，再正常执行：

```bash
./nextbufctl upgrade 1.0.0 --verify-objects

for service in web worker; do
  container_id=$(docker compose --env-file .env -f compose.yml ps -q "$service")
  running_config_id=$(docker inspect --format '{{.Image}}' "$container_id")
  [ "$running_config_id" = "$CANDIDATE_CONFIG_DIGEST" ]
done
```

全新安装候选时使用同一个本地 Registry，但新实例的 `NEXTBUF_VERSION` 直接设为 `1.0.0`。实际运行容器的证据应同时记录：原候选 OCI index Digest、当前架构 manifest Digest、本地 Registry 中保持一致的 index Digest，以及容器 image config ID；不能把重标记后的单个 `RepoDigest` 当成完整候选身份。

临时 Registry 必须保留到全新安装、升级、失败恢复和证据重采集全部结束。若 `restore --restore-config` 恢复了升级工具生成的备份，其 `config.env` 已包含本地 `NEXTBUF_IMAGE`；若恢复的是更早的生产备份，应先按公开版本路径恢复并升级到 `0.13.10`，再切换本地 Registry、重新备份并开始候选升级。全部验收结束后才执行 `docker rm -f nextbuf-v1-acceptance-registry`。

需要在已经停止 Web/Worker 的隔离实例单独采集或重做比较时：

```bash
./nextbufctl acceptance capture 1.0.0 --verify-objects
./nextbufctl acceptance compare 1.0.0 \
  backups/acceptance-0.13.10-<time>-<pid>.json \
  backups/acceptance-1.0.0-<time>-<pid>.json
```

`capture` 要求 PostgreSQL 正在运行且 Web/Worker 已停止，避免真实写入被误判为迁移差异。它和 `compare` 都使用目标精确 SemVer 镜像并在 `backups/` 生成权限 600 的 JSON 与 SHA-256；文件不含原始会员资料，但仍会暴露规模、状态计数和跨快照关联摘要，应只放在加密、受限的验收目录，不提交仓库。未公开 SemVer 前必须使用上面的隔离 Registry 流程，不能只创建本地 tag、跳过 pull 或用另一次构建冒充候选。

PostgreSQL 和 Redis 不因每次应用补丁自动升级主版本。基础服务主版本升级使用独立指南和备份恢复测试。

### 9.3 升级后检查

- 首页、登录、主题页和后台可访问。
- Web 与 Worker 运行同一应用版本。
- 数据库迁移状态与镜像匹配。
- Outbox 和队列继续下降，没有持续失败任务。
- 邮件、附件和 OAuth Provider 正常。
- 错误率和资源占用没有异常上升。
- `backups/acceptance-<from>-to-<to>-*-comparison.json` 为 `status=pass`；正式发布默认应有至少 2 位合格管理员。任何既有单管理员豁免不得自动延伸到后续补丁；若 `v1.0.2` 发布时仍只有 1 位，必须增加第二位或重新记录本次明确豁免。`administrator_redundancy_missing` 警告必须保留，0 位合格管理员始终是硬阻断，任何豁免都不能绕过。

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
4. 创建 `/etc/nextbuf/nextbuf.env`，权限设为 `600`，然后通过归档包装器运行配置检查。
5. 进入 `runtime/`，执行 `deploy/bin/nextbuf migrate` 和 `deploy/bin/nextbuf setup`。
6. 安装并启用 `nextbuf-web.service`、`nextbuf-worker.service`。
7. 配置 Nginx/Caddy 和 HTTPS。

复制发布包中的两个 systemd 单元到 `/etc/systemd/system/`，创建 `/var/lib/nextbuf/uploads` 与 `/var/lib/nextbuf/cache` 并归属 `nextbuf` 用户，然后执行 `systemctl daemon-reload && systemctl enable --now nextbuf-web nextbuf-worker`。单元中的工作目录和入口应分别是 `/opt/nextbuf/current/runtime` 与 `/opt/nextbuf/current/runtime/deploy/bin/nextbuf-service`；若自定义安装根目录，必须同时替换二者，不能让模板指向发布根目录下并不存在的 `deploy/bin`。`deploy/bin/nextbuf` 和 `deploy/bin/nextbuf-service` 都会自动读取 `/etc/nextbuf/nextbuf.env`；自定义配置位置时显式导出绝对路径 `NEXTBUF_ENV_FILE`。Web 包装器始终把监听地址收紧到 `127.0.0.1`，即使配置文件仍保留容器使用的 `HOSTNAME=0.0.0.0`；不要把非 Docker Web 进程直接暴露到公网。

PM2 用户从发布根目录执行 `pm2 start deploy/pm2/ecosystem.config.cjs`。配置文件位于发布根目录，但两个 app 的 `cwd` 均为 `/opt/nextbuf/current/runtime`，并从该目录执行 `deploy/bin/nextbuf-service`；包装器同样自动读取 `/etc/nextbuf/nextbuf.env`，Web 与 Worker 仍是两个独立 app。

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

### Web 在 setup/preflight 阶段反复重启

这是保护行为。查看 Web 日志，通常是数据库/Redis 不可达、迁移失败、密钥无效、存储不可写或已有不兼容 Schema。不要删除迁移表或 `runtime.initialized` 强行启动。人工运行 `docker compose run --rm setup` 可以获得一次性的完整错误输出，命令结束后不会留下容器。

`v1.0.0` 的迁移入口先把所有成功记录按名称和 checksum 与冻结的 16 条清单比较，只接受精确连续前缀。没有 `runtime.initialized` 的未完成首装可以从真实连续前缀继续；已初始化实例必须至少完整匹配 13 条 `v0.13.10` 基线，缺失、跳号、额外记录或任一 checksum 漂移都会在候选 DDL 前停止。连接串带 `?schema=` 时，迁移表、业务冲突和 marker 检查均使用与 Prisma 相同的安全限定 PostgreSQL schema。

通过历史门槛后，入口还会在 Prisma 写入迁移记录前检查保留的 `deleted-*` / `@deleted.invalid` 身份命名空间和注销申请/计划是否成对；发现冲突时先按错误提示修复数据，再重试，迁移尚未开始。三条新增迁移本身也由显式 PostgreSQL 事务包裹，后续约束失败不会留下部分列、函数或数据清理。

如果日志已经明确报告 Prisma `P3009`，并且失败名称精确为以下三项之一，先停止 Web/Worker、完成数据库与附件备份并确认失败原因已经修复：

- `20260730120000_account_deletion_finalization`
- `20260731120000_outbox_processed_status`
- `20260731180000_email_delivery_attempt_fencing`

这些候选迁移的事务确认已经回滚后，只把日志中那一项标记为 rolled back，再重新执行 setup：

```bash
# compose.yml
docker compose --profile tools run --rm migrate migrate \
  --resolve-rolled-back 20260730120000_account_deletion_finalization

# compose.baota.yml 的等价一次性容器
docker compose -f compose.baota.yml run --rm nextbuf migrate \
  --resolve-rolled-back 20260730120000_account_deletion_finalization

# Linux x64 standalone，在 runtime/ 目录
deploy/bin/nextbuf migrate \
  --resolve-rolled-back 20260730120000_account_deletion_finalization
```

命令只接受上面三个尚未公开的候选迁移名，并要求数据库只有一条对应的未解决失败记录：名称和 checksum 必须匹配冻结清单，成功历史必须恰好停在该迁移之前，当前 schema 中该事务的首个 marker 列必须不存在。不要对其他迁移照搬，不要删除或手工伪造 `_prisma_migrations`，也不要在未确认事务回滚时把失败项标成 rolled back；状态不明确时从升级前备份恢复。

### Web 正常但 Worker 不健康

检查 Redis、数据库、Worker 配置、任务注册和停止锁。Web 可以继续提供只读或部分功能，但后台必须显示通知/邮件可能延迟。

### PostgreSQL 容器重建后数据为空

立即停止写入，检查 PostgreSQL 18 卷是否挂载 `/var/lib/postgresql`，不要在错误的新空库继续初始化。

### 登录后循环跳转或 Cookie 不生效

检查 `APP_URL`、HTTPS、Host、代理协议头和可信代理设置。不要通过关闭 Secure Cookie 解决生产 HTTPS 配置错误。

### 上传成功但重启后附件丢失

检查 `nextbuf_uploads` 命名卷是否仍挂载到 Web/Worker；非 Docker 检查 `STORAGE_LOCAL_PATH`。多实例检查是否错误使用各自独立的本地存储。

### 邮件积压

检查 Worker、SMTP、`email_deliveries`、Outbox 和失败任务。确认 `MAIL_PAYLOAD_KEY` 与创建邮件时一致；密钥错误需先恢复正确密钥。明确未接受的临时 SMTP 故障会在五次总尝试内自动重试，永久拒绝进入 `failed`。`outcome_unknown` 表示 Provider 可能已经接受邮件，后台会显示“确认风险后重放”；先核对 Provider 投递记录和稳定 Message-ID，再由管理员确认可能重复投递。不要直接修改数据库状态或批量标成成功。

Worker 日志中的 `Connection timeout` 表示 TCP/TLS 连接尚未建立，不是 SMTP 用户名或密码被拒绝。核对邮件 Provider 控制台提供的 SMTP 主机和区域，确认服务器允许访问对应出口端口；465 通常必须配 `SMTP_SECURE=true`，587 或 Provider 明确支持的替代端口通常配 `false`。阿里云等服务还要求 SMTP 专用密码，不能填写 AccessKey 或控制台登录密码。修改宝塔 Compose 后重建 Web 和 Worker，再从检查邮件页重发；不要绕过 Better Auth 邮箱验证。

`SMTP_CONNECTION_TIMEOUT_MS`、`SMTP_GREETING_TIMEOUT_MS` 和 `SMTP_SOCKET_TIMEOUT_MS` 默认分别为 15000、15000、60000 毫秒。通用 Socket 超时或连接在消息提交阶段断开时，Nodemailer 的 `command=CONN` 也不足以证明邮件未被接受，因此系统会保守记录 `EOUTCOMEUNKNOWN`，而不是自动再次发送。

### 验证或重置链接全部失效

检查是否轮换了 `AUTH_SECRET`、修改了 `APP_URL`，或验证记录已过期。`AUTH_SECRET` 同时参与 Cookie 签名和验证标识 HMAC，轮换会按设计使旧会话与未使用链接失效。

### 首次安装提示请求已过期或被接管

首次安装 claim 的租约为 10 分钟。注册或邮件 Provider 长时间阻塞后，后续同身份请求可以接管；旧请求会以 `setup_claim_lost` 结束，且不会删除新请求的 claim。确认 PostgreSQL、SMTP 和 Web 日志没有持续故障后，使用相同邮箱和用户名重新提交安装表单；不要直接编辑 `installation.claim` 或手工插入管理员角色。

如果迟到的旧请求已经创建账号，而当前接管请求填写了不同密码，当前请求会以 `initial_administrator_password_mismatch` 结束。此时不会产生管理员角色、`installation.completed`、登录 Session 或 Cookie，也不会覆盖数据库中的 Better Auth 密码哈希。使用此前真正创建该账号时填写的密码重新提交；如果该密码已经遗失，先按管理员连续性恢复流程处理凭据。`initial_administrator_not_eligible` 表示现有账号没有可用密码凭据、已进入注销流程或存在其他连续性阻断，同样需要先完成恢复。

## 14. 上线检查清单

- 受控 Compose 与非 Docker 部署使用精确应用版本；宝塔 `latest` 部署记录已验证目标稳定 Release、镜像 Digest 和 Git commit。
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
- Beta 部署按[公开 Beta 人工验收模板](./17-public-beta-acceptance-template.md)留证；首个稳定版按[`v1.0.0` 正式版人工验收模板](./21-v1.0.0-manual-acceptance.md)保存完整证据，补丁版还必须使用本版本清单（当前为 [`v1.0.2`](./26-v1.0.2-release-readiness.md)），不能复用硬编码旧升级路径代替直接基线验收。

## 15. 文档实现责任

`v0.13.10` 发布交付物包括：

- `compose.yml`。
- `.env.example`。
- `nextbufctl`。
- 宝塔安装步骤。
- 非 Docker systemd 单元。
- 备份/恢复和升级/回滚工具。
- 本文中的全部核心命令。

CI 在主分支、定时、手动和正式标签运行中使用原生 amd64/arm64 Runner 验证空数据库通过默认 Compose 自动 setup、Web/Worker 健康、四个生产容器且无停止的 setup 记录，以及一次性管理员流程。日常主分支对两个架构执行基础镜像冒烟，并在 amd64 从当前公开版本真实备份/升级到候选，强制运行停写比较和附件对象校验；只有这些门槛通过且提交仍是远程 HEAD，才发布 `edge` 与不可变 `sha-<提交>`，不写入 `latest`。耗时更长的 amd64 空卷恢复和依赖故障注入由每日定时、手动和正式标签运行执行，这些深度通道同时重跑升级。正式标签另发布不可变 SemVer、非 Docker x64 包和供应链资产；最新完整稳定 Release 成功后才提升同一 manifest 为 `latest`。生产部署者仍应在自己的域名、SMTP、对象存储和备份目标上完成上线清单，因为 CI 不能替代实例级凭据和灾难恢复演练。

正式版本的标签、镜像和 Release 全部通过后，下一次开发提交才把 `.github/workflows/ci.yml` 的 `NEXTBUF_UPGRADE_BASELINE` 提升到该已发布版本；不能在标签验证前提前提升，否则会跳过真正需要证明的旧版升级。`v1.0.1` 标签验证已经通过，`v1.0.2` 的当前公开升级基线为 `1.0.1`。

`v0.13.0` 的 `nextbufctl doctor` 同时输出 PostgreSQL 数据量/连接、Redis 内存/淘汰策略、Worker 并发和 Queue/Outbox/邮件积压。报告不包含连接串和凭据，可以用于工单诊断；但仍应在分享前检查实例名称、对象存储桶名和业务规模是否属于不应公开的信息。
