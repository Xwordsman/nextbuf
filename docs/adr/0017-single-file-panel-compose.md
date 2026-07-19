# ADR-0017：单文件面板 Compose 与镜像版本通道

- 状态：已接受；第 2 节由 ADR-0018 补充
- 日期：2026-07-18
- 适用版本：`v0.13.2` 起；`v0.13.3` 补充单实例固定容器名

## 背景

根 `compose.yml`、`.env` 与 `nextbufctl` 为精确版本升级、备份和恢复提供了完整合同，但宝塔用户通常只想粘贴一个 Compose、填写一次域名和密钥，之后通过面板拉取并重建。要求这类用户每个补丁版本都修改 `.env` 中的 `NEXTBUF_VERSION`，增加了没有业务价值的重复操作。

New API 等项目使用单文件 Compose，把镜像标签、连接串和秘密直接放入 `environment`。这种方式并非没有配置，而是把配置从 `.env` 移到 Compose；对面板用户更直观，但秘密保护、自动升级和回滚边界必须继续可见。

## 决策

### 1. 同一镜像提供两种官方部署入口

根 `compose.yml`、`.env.example` 和 `nextbufctl` 保持精确版本、自动生成密钥、备份、恢复和受控升级合同。

新增根 `compose.baota.yml` 作为官方单文件面板入口。它：

- 直接使用 `ghcr.io/xwordsman/nextbuf:latest`；
- 只创建 Web、Worker、PostgreSQL、Redis 四个常驻服务；
- 把域名、数据库/Redis 密码、应用密钥和 SMTP 参数放在 Compose 的 `environment`；
- 保留健康检查、Web 启动 setup/preflight、Worker 等待 Web、非公开数据库端口、日志轮转和命名卷；
- 在 `v0.13.3` 将主服务命名为 `nextbuf`，并将四个容器固定为 `nextbuf`、`nextbuf-worker`、`nextbuf-postgres`、`nextbuf-redis`；
- 不创建 setup 常驻或停止容器。

两个入口在每个已解析的镜像 Digest 上使用同一个应用镜像、相同数据库迁移和运行门禁，不形成第二套应用代码。

### 2. `latest` 只决定拉取通道

`latest` 的更新来源和构建身份策略由 [ADR-0018](./0018-validated-main-image-channel.md) 补充：它在通过完整检查和双架构基础 Compose 冒烟的 `main` 提交后更新，而不是等待正式版本标签。正式 `vX.Y.Z` 标签仍只发布不可变 SemVer 镜像和 Release 资产，不回写 `latest`。

镜像内部继续通过构建参数保存源码 SemVer；滚动构建的精确身份由 `NEXTBUF_COMMIT` 和镜像 Digest 提供。单文件 Compose 不用环境变量覆盖版本，因此 preflight、Worker 心跳、备份事实和诊断仍可区分应用 SemVer、提交和 Digest，而不是只看到字符串 `latest`。

`latest` 不等于无人值守更新。已有容器只在面板明确拉取新镜像并重建后升级，普通重启不应主动改变镜像。Web 在新容器启动前幂等执行迁移；部署者仍应先备份。

### 3. 单文件便利模式的边界

Compose 中所有 `replace-` 占位值和示例域名必须在首次启动前替换。秘密从 `.env` 移到 Compose 后仍是秘密，不能公开截图或提交到仓库。完成首位管理员后删除 `SETUP_TOKEN` 并重建 Web。

希望获得原子备份、恢复校验、精确升级和保守回滚的实例继续使用 `nextbufctl` 入口。单文件面板模式回滚时必须把镜像临时固定为已知精确标签，并按备份恢复边界处理数据库；不能只把 `latest` 指向旧代码读取已经迁移的 Schema。

固定容器名只服务宝塔单机单实例的可识别性，会阻止同一 Docker 主机直接运行第二套未改名模板，也不能使用 Compose `--scale`。需要项目隔离、多实例或横向扩容的部署继续使用不含 `container_name` 的受控 `compose.yml`。面板容器列表的排列由面板排序和依赖创建顺序决定，不属于 Compose 合同。

## 备选方案

### 让所有用户继续维护精确 `NEXTBUF_VERSION`

最可预测，但对只使用宝塔界面的用户造成每个补丁版本都要编辑配置的重复操作，因此不再作为唯一入口。

### 删除精确版本和 `nextbufctl` 方案

会损失可验证备份、升级前检查和清晰回滚点，不能满足生产运维，因此拒绝。

### 在单文件模板中删除 Worker 或健康检查

行数会更少，但破坏故障隔离和真实健康状态，与“配置集中到一个文件”无关，因此拒绝。

## 后果

- 宝塔用户首次只编辑一个文件，后续升级不再修改版本变量。
- 简单入口和受控运维入口共用同一镜像与数据模型。
- 面板 Compose 中包含秘密，文件权限、截图和备份必须按敏感配置处理。
- 使用 `latest` 的站点获得更低操作成本，同时承担它是经过验证的滚动 Beta 通道、应先备份再拉取和重建的责任。
- 宝塔单实例的四个容器名称稳定且没有 `-1` 后缀；受控 Compose 的扩容能力不受影响。
- 发布测试必须验证单文件模板可以独立解析、只有四个服务、不引用 `.env`、使用已验证 `latest` 镜像且具有四个固定容器名。

## 迁移与回退

现有宝塔实例可以继续使用原 `compose.yml + .env`，无需迁移。切换到单文件模板时必须把原密码、密钥、域名、SMTP 和存储配置逐项复制，且继续挂载原三个命名卷；不能在未备份时同时更换数据卷。

从 `v0.13.2` 单文件模板升级到 `v0.13.3` 时先备份并停止编排，再更新模板和重建四个服务。主服务名由 `web` 改为 `nextbuf`；若面板没有自动移除旧 `web-1`，只删除该旧应用容器，不删除 PostgreSQL、Redis 或任何命名卷。

若单文件入口不适合当前实例，重新使用与当前数据库版本兼容的 Release `compose.yml` 和 `.env` 即可。部署入口切换不修改数据库 Schema。

## 关联文档

- [ADR-0015：生产打包、首次安装门禁与恢复边界](./0015-production-packaging-setup-and-recovery.md)
- [ADR-0016：面板友好的 Compose 启动协调](./0016-panel-friendly-compose-bootstrap.md)
- [ADR-0018：主分支验证镜像通道](./0018-validated-main-image-channel.md)
- [部署与运维](../05-deployment-operations.md)
- [安装与运维运行手册](../13-installation-operations-runbook.md)
