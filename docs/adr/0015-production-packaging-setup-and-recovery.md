# ADR-0015：生产打包、首次安装门禁与恢复边界

- 状态：已接受
- 日期：2026-07-16
- 适用版本：`v0.12.0`

## 背景

NextBuf 已经有独立 Web/Worker、迁移、setup 和 doctor 入口，但开发 Compose 与源码启动不能构成面向普通部署者的发布产品。生产交付必须解决同一版本镜像、初始化失败保护、首位管理员、备份可验证性和升级回滚边界，而不能把这些责任留给面板用户临时拼接命令。

## 决策

### 1. 一个不可变镜像，多种明确入口

同一 amd64/arm64 镜像包含 Next.js standalone Web、Worker、Prisma 迁移、CLI 和版本匹配的迁移目录。入口只接受 `web`、`worker`、`setup`、`migrate`、`doctor` 及已有受控 CLI 命令。Web/Worker 启动前执行相同 preflight：完整配置、镜像/配置版本、PostgreSQL、Redis、迁移集合、本地/S3 存储和 `runtime.initialized` 都必须有效。

非 Docker 归档以解压目录为发布根目录，实际 Node.js 应用和服务包装器固定放在其 `runtime/` 子目录。根目录的 `deploy/systemd` 和 `deploy/pm2` 只是安装模板；它们必须把工作目录设为 `/opt/nextbuf/current/runtime`，并执行 `/opt/nextbuf/current/runtime/deploy/bin/nextbuf-service`。CLI 与服务包装器统一通过 Node.js 24 原生 dotenv 支持加载 `NEXTBUF_ENV_FILE`、默认 `/etc/nextbuf/nextbuf.env` 或回退的 `runtime/.env`；当前进程环境优先级最高。非 Docker Web 包装器固定绑定 `127.0.0.1`，公网连接必须经过同机反向代理，防止直连客户端伪造单值转发头。归档内的只读 `.nextbuf-build.env` 只固化版本、完整 commit 和可复现的 commit 时间默认值，不执行为 Shell，也不保存实例秘密。归档发布门槛必须清除外部构建身份变量，从解压产物运行 setup，分别启动 Web 与 Worker，并精确核对 `/api/version`，而不是只检查文件存在。

默认 Compose 有四个常驻服务：Web、Worker、PostgreSQL、Redis。setup 是成功后退出的一次性服务；它不是第五个常驻进程。Web 与 Worker 继续由各自容器监督，遵循 ADR-0003。

> `v0.13.0` 的面板兼容修订见 [ADR-0016](./0016-panel-friendly-compose-bootstrap.md)：setup 仍是一次性运维能力，但默认 Compose 不再创建并保留该容器，由单机 Web 在启动前执行同一幂等 setup，Worker 等待 Web 健康。

> `v0.13.2` 的面板配置修订见 [ADR-0017](./0017-single-file-panel-compose.md)：宝塔可以使用无需 `.env` 的单文件 `latest` 通道；精确版本、备份恢复和保守升级合同继续由本 ADR 的受控入口承担。

### 2. setup 与首位管理员分离

`setup` 幂等执行已有迁移、依赖检查、周期任务和运行门禁写入。失败时不会写入 `runtime.initialized`，Web/Worker 的 preflight 因而拒绝启动。

全新数据库在 Web 可用后通过 `/setup` 创建首位管理员。请求必须携带至少 32 位随机 `SETUP_TOKEN`，服务端使用常量时间摘要比较；令牌不写入 PostgreSQL、不进入浏览器构建产物，也不在日志中回显。创建账号调用 Better Auth 的邮箱密码注册能力，保留其密码哈希、邮箱验证、Session 和 Cookie 语义；NextBuf 只在受锁事务中授予首个 `admin/site` 角色并写审计与 `installation.completed`。

安装完成后端点永久拒绝再次创建管理员，即使环境中仍残留令牌。部署者仍必须删除 `SETUP_TOKEN` 并重启 Web，以缩小配置暴露面。升级既有站点时，setup 发现已有站点管理员会幂等回填完成状态。

### 3. 备份是带清单的原子归档

`nextbufctl` 对启动、停止、备份、恢复和升级持有同一个非阻塞内核文件锁，避免两个运维进程交错改变 Web/Worker 状态或覆盖同秒产物。`nextbufctl backup` 必须确认 Web/Worker 已停止，再生成 PostgreSQL custom-format 一致性转储，随后收集本地附件、逐文件 SHA-256、`.env` 配置副本、Compose、应用/数据库/迁移版本和总校验清单，最后以临时文件原子改名为 `nextbuf-backup-v1` tar.gz。半成品不标记为成功，归档权限为仅部署用户可读，文件名包含 UTC 时间与进程 ID。

Redis 不进入主要备份，因为 PostgreSQL Outbox、任务失败和调度事实可重建队列。S3 模式只记录 Bucket/Endpoint 清单；对象数据必须由 Provider 版本控制或独立对象备份覆盖，工具不会把“只有数据库键”宣称为完整附件备份。

恢复默认保留当前配置并校验归档；只有显式 `--restore-config` 才恢复密钥。`--empty-install` 会在二次确认后删除当前 Compose 数据卷，供空服务器演练使用。恢复先停 Web/Worker，再恢复数据库和附件，运行当前版本 setup/迁移，最后等待两个进程健康。

### 4. 升级不承诺无条件镜像回退

升级必须使用精确版本、先备份、先拉取和校验镜像、停止写入进程、运行一次性迁移，再启动同版本 Web/Worker。迁移前失败可以恢复旧镜像配置；迁移成功后若新应用不健康，工具不会自动用旧代码读取新 Schema。是否允许代码回退由该版本发布说明决定，否则从升级前备份恢复数据库、附件、配置和旧镜像。

## 后果

- 宝塔单文件入口和命令行受控入口使用同一镜像、setup/preflight 与数据模型；配置载体不同但不存在隐藏安装逻辑。
- setup、首次管理员和普通注册有独立状态，公开注册不能抢占首个账号。
- 镜像标签、应用内版本和迁移目录不一致会快速失败。
- 本地附件备份可由 CI 在空安装上完整恢复；S3 数据保护责任保持可见。
- 备份包含高敏感配置，必须加密复制到异机并限制权限。

## 回退

本 ADR 不新增业务表，状态使用现有 `system_state`。回退到 `v0.11.0` 前保留这些键无害；旧版本会忽略它们。生产拓扑仍可按 ADR-0003 回退到源码/systemd，但必须保持同一数据库迁移兼容性和正确的密钥、附件路径。
