# ADR-0015：生产打包、首次安装门禁与恢复边界

- 状态：已接受
- 日期：2026-07-16
- 适用版本：`v0.12.0`

## 背景

NextBuf 已经有独立 Web/Worker、迁移、setup 和 doctor 入口，但开发 Compose 与源码启动不能构成面向普通部署者的发布产品。生产交付必须解决同一版本镜像、初始化失败保护、首位管理员、备份可验证性和升级回滚边界，而不能把这些责任留给面板用户临时拼接命令。

## 决策

### 1. 一个不可变镜像，多种明确入口

同一 amd64/arm64 镜像包含 Next.js standalone Web、Worker、Prisma 迁移、CLI 和版本匹配的迁移目录。入口只接受 `web`、`worker`、`setup`、`migrate`、`doctor` 及已有受控 CLI 命令。Web/Worker 启动前执行相同 preflight：完整配置、镜像/配置版本、PostgreSQL、Redis、迁移集合、本地/S3 存储和 `runtime.initialized` 都必须有效。

默认 Compose 有四个常驻服务：Web、Worker、PostgreSQL、Redis。setup 是成功后退出的一次性服务；它不是第五个常驻进程。Web 与 Worker 继续由各自容器监督，遵循 ADR-0003。

### 2. setup 与首位管理员分离

`setup` 幂等执行已有迁移、依赖检查、周期任务和运行门禁写入。失败时不会写入 `runtime.initialized`，Web/Worker 的 preflight 因而拒绝启动。

全新数据库在 Web 可用后通过 `/setup` 创建首位管理员。请求必须携带至少 32 位随机 `SETUP_TOKEN`，服务端使用常量时间摘要比较；令牌不写入 PostgreSQL、不进入浏览器构建产物，也不在日志中回显。创建账号调用 Better Auth 的邮箱密码注册能力，保留其密码哈希、邮箱验证、Session 和 Cookie 语义；NextBuf 只在受锁事务中授予首个 `admin/site` 角色并写审计与 `installation.completed`。

安装完成后端点永久拒绝再次创建管理员，即使环境中仍残留令牌。部署者仍必须删除 `SETUP_TOKEN` 并重启 Web，以缩小配置暴露面。升级既有站点时，setup 发现已有站点管理员会幂等回填完成状态。

### 3. 备份是带清单的原子归档

`nextbufctl backup` 先生成 PostgreSQL custom-format 一致性转储，再收集本地附件、`.env` 配置副本、Compose、应用/数据库/迁移版本和 SHA-256 校验和，最后以临时文件原子改名为 `nextbuf-backup-v1` tar.gz。半成品不标记为成功，归档权限为仅部署用户可读。

Redis 不进入主要备份，因为 PostgreSQL Outbox、任务失败和调度事实可重建队列。S3 模式只记录 Bucket/Endpoint 清单；对象数据必须由 Provider 版本控制或独立对象备份覆盖，工具不会把“只有数据库键”宣称为完整附件备份。

恢复默认保留当前配置并校验归档；只有显式 `--restore-config` 才恢复密钥。`--empty-install` 会在二次确认后删除当前 Compose 数据卷，供空服务器演练使用。恢复先停 Web/Worker，再恢复数据库和附件，运行当前版本 setup/迁移，最后等待两个进程健康。

### 4. 升级不承诺无条件镜像回退

升级必须使用精确版本、先备份、先拉取和校验镜像、停止写入进程、运行一次性迁移，再启动同版本 Web/Worker。迁移前失败可以恢复旧镜像配置；迁移成功后若新应用不健康，工具不会自动用旧代码读取新 Schema。是否允许代码回退由该版本发布说明决定，否则从升级前备份恢复数据库、附件、配置和旧镜像。

## 后果

- 宝塔和命令行用户使用同一 Compose 与相同底层命令，不存在隐藏安装逻辑。
- setup、首次管理员和普通注册有独立状态，公开注册不能抢占首个账号。
- 镜像标签、应用内版本和迁移目录不一致会快速失败。
- 本地附件备份可由 CI 在空安装上完整恢复；S3 数据保护责任保持可见。
- 备份包含高敏感配置，必须加密复制到异机并限制权限。

## 回退

本 ADR 不新增业务表，状态使用现有 `system_state`。回退到 `v0.11.0` 前保留这些键无害；旧版本会忽略它们。生产拓扑仍可按 ADR-0003 回退到源码/systemd，但必须保持同一数据库迁移兼容性和正确的密钥、附件路径。
