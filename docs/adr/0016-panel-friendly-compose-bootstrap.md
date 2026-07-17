# ADR-0016：面板友好的 Compose 启动协调

- 状态：已接受
- 日期：2026-07-17
- 适用版本：`v0.13.0` Beta 修订

## 背景

ADR-0015 将 setup 设计为成功后退出的一次性 Compose 服务。Docker CLI 能正确区分 `Exited(0)` 与故障，但部分服务器面板只要发现编排内存在停止容器，就把整个项目显示为“已停止”。结果是 Web、Worker、PostgreSQL 和 Redis 全部健康时，宝塔左侧仍显示红色停止状态，普通部署者无法判断实例是否真正故障。

这个问题不能通过让 setup 永久运行、自动重启或合并 Web/Worker 解决。setup 没有常驻职责，Web/Worker 仍必须独立监督，迁移和 `runtime.initialized` 门禁也不能绕过。

## 决策

### 1. 默认编排只创建四个常驻容器

根 `compose.yml` 默认只激活 Web、Worker、PostgreSQL 和 Redis。`setup` 保留为同一镜像的工具 profile，只在 `docker compose run --rm setup`、升级、恢复或人工运维时显式创建，并在命令结束后自动删除。

因此面板启动整个默认编排后，只应看到四个运行中容器，不应存在 `nextbuf-setup-1` 的停止记录。旧版编排留下的 setup 容器需要在更新编排时删除一次；数据库卷和附件卷不受影响。

### 2. 单机 Web 是默认启动协调者

默认 Compose 的 Web 命令按以下顺序执行：

1. 等待 PostgreSQL 和 Redis 通过 Compose 健康检查。
2. 执行现有幂等 `setup`，部署已有迁移、检查依赖、协调安装状态、注册周期任务并写入 `runtime.initialized`。
3. 执行 Web preflight，检查镜像/配置版本、迁移全集、依赖、存储和运行门禁。
4. 使用 `exec` 启动 Next.js standalone Web。

Worker 依赖 Web 健康后才启动，并继续执行自己的 preflight。setup 或 Web preflight 失败时，Web 不会进入健康状态，Worker 也不会启动；面板此时显示异常才代表真实故障。

### 3. 显式运维 setup 继续保留

`nextbufctl upgrade` 和恢复流程仍在停写阶段显式执行目标镜像的 setup，再恢复 Web/Worker。Web 随后重复一次幂等 setup 是允许的，不能替代升级前备份、停写和迁移失败处理。

默认 Compose 只承诺单个 Web 副本。外部编排若运行多个 Web 副本，必须先把 setup 作为单独 Job 成功执行，再让各副本使用镜像原生 `web` 命令；不能让多个副本承担发布协调责任。

## 备选方案

### 保留停止的 setup 容器并补充说明

CLI 语义正确，但面板仍把健康项目显示为停止，无法满足面向普通站长的一键部署目标，因此拒绝。

### 让 setup 常驻或自动重启

这会制造无业务职责的第五个进程，反复执行迁移并掩盖真实失败，因此拒绝。

### 把 Worker 合并进 Web

这会破坏 ADR-0003 的独立监督、健康检查、优雅停止和故障隔离，且与本问题无关，因此拒绝。

## 后果

- 宝塔和类似面板的项目状态与四个真实常驻服务一致。
- 空数据库直接启动默认 Compose 即可完成运行时初始化，不再要求面板理解一次性容器。
- setup、preflight、`runtime.initialized` 和 Worker 启动门禁全部保留。
- 每次默认 Web 容器启动都会执行一次幂等 setup，带来少量启动时间，但不增加常驻资源。
- 多 Web 发布需要显式外部协调，不能把默认单机流程直接当作横向扩容方案。

## 迁移与回退

现有实例更新 `compose.yml` 后，删除一次旧的已停止 setup 容器并重建编排；不要删除 PostgreSQL、Redis 或附件卷。`nextbufctl start` 会自动清理这条旧记录。回退旧 Compose 会重新出现一次性 setup 容器及面板误报，但不需要数据库迁移。

## 关联文档

- [ADR-0003：单镜像与分离运行时](./0003-single-image-separated-runtimes.md)
- [ADR-0015：生产打包、首次安装门禁与恢复边界](./0015-production-packaging-setup-and-recovery.md)
- [部署与运维](../05-deployment-operations.md)
- [安装与运维运行手册](../13-installation-operations-runbook.md)
