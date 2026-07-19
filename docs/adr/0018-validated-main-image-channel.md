# ADR-0018：主分支验证镜像通道

- 状态：Accepted
- 日期：2026-07-19
- 补充：ADR-0017 第 2 节的 `latest` 更新来源

## 背景

宝塔单文件 Compose 固定拉取 `ghcr.io/xwordsman/nextbuf:latest`。此前只有推送 `vX.Y.Z` 标签才会构建并更新这个标签，日常 `main` 提交只完成 CI 和本地镜像冒烟。部署者因此必须额外推送版本标签，服务器才能拉到已经验证的代码；这不符合项目在公开 Beta 阶段“每次完成阶段即可在服务器验证”的工作流。

不能直接让每个构建先覆盖 `latest`：amd64 或 arm64 失败时会暴露半成品，也会让较早的慢速任务在新提交之后回写旧镜像。与此同时，正式 Release 的 SemVer、归档、SBOM、provenance 和回滚点必须保持不可变。

## 决策

### 1. `main` 是宝塔滚动通道的来源

- 每次 `main` push 都先完成格式、Lint、类型、单元测试、真实 PostgreSQL/Redis/Mailpit 集成测试、生产构建和 Playwright E2E。
- 检查成功后，原生 amd64 与 arm64 Runner 分别构建唯一 `ci-<运行>-<尝试>-<提交>-<架构>` 候选镜像，拉回相同候选并执行基础 Compose、首次管理员、Web/Worker 健康和宝塔四容器冒烟。
- 两个架构都成功后，工作流先确认该提交仍是远程 `main` HEAD，再创建不可变的 `sha-<完整提交>` 多架构 manifest，并把同一 manifest 标记为 `latest`。
- `latest` 是最近一次通过上述门槛的滚动 Beta 构建，不是正式 SemVer 版本。宝塔仍需手动拉取镜像并重建；普通容器重启不会自动升级。

### 2. 正式版本标签保持不可变

- `vX.Y.Z` 必须与 `package.json` 的版本匹配。
- 标签工作流重新构建并验证两个原生架构，只发布不可变 `X.Y.Z` manifest、归档、校验和、SBOM、provenance 和 GitHub Release；它不改写 `latest`。
- 如果目标 SemVer manifest 已存在，工作流失败，拒绝覆盖。仓库还应保护 `v*` 标签，禁止强制更新或删除。

### 3. 构建身份与回滚

- 源码 SemVer 继续由 `package.json`、`PROJECT.version` 与 `NEXTBUF_VERSION` 表示，保证 Web、Worker、setup、preflight 和受控 Compose 的既有一致性合同不变。
- 对未打正式标签的滚动构建，`NEXTBUF_COMMIT` 和镜像 Digest 才是精确身份；`/api/version` 和 `doctor` 均输出 commit。部署记录必须同时保存 Digest 和 commit，不能只记录 `latest` 或源码 SemVer。
- 受控 Compose、`nextbufctl` 和非 Docker 部署继续使用正式 SemVer。宝塔发生回滚时应固定到已记录的 `sha-<提交>` 或正式版本，并遵守迁移与备份恢复边界。

### 4. 慢速验证和候选保留

- 日常 `main` 构建执行双架构基础烟测并发布滚动镜像；空卷恢复、故障注入和跨版本升级保留给每日定时、手动和正式标签运行，避免每次日常提交重复长时间运行。
- `ci-*` 是内部候选标签，不是部署 API；GHCR 应配置保留策略，按时间清理它们。`sha-<提交>` 与正式 SemVer 是可追溯部署身份。

## 备选方案

### 继续只在版本标签更新 `latest`

正式发布最保守，但日常主分支提交无法被宝塔直接拉取，要求维护者额外推送标签，和当前 Beta 验收流程不匹配。

### 在架构冒烟前直接覆盖 `latest`

实现较短，但失败镜像会进入部署通道，且两个单架构镜像可能形成不完整或不一致的 manifest，因此拒绝。

### 只发布 amd64 的 `latest`

可缩短运行时间，但违反已公开的 amd64/arm64 支持合同，也会使 arm64 部署者获得不可预测的结果，因此拒绝。

### 新增 `edge` 而让宝塔继续使用标签驱动的 `latest`

可以保留原有发布语义，但仍要求宝塔用户更改 Compose 或手动选择两条通道，不能解决一次主分支推送即可验证服务器的目标。

## 后果

- 日常 `main` CI 增加一个并行 arm64 构建/烟测，但不再在每次提交执行恢复、故障注入和升级演练；墙钟时间受较慢架构限制。
- 只有双架构基础门槛和远程 HEAD 检查均通过的提交能移动 `latest`；被取消、失败或过期的工作流不会覆盖更新的通道。
- 版本标签不再代表 `latest` 当前内容。Release 文档、支持请求和回滚操作必须记录精确 SemVer 或 `sha-<提交>`/Digest。
- 滚动通道上的数据库变更必须保持升级兼容；破坏性迁移、需要特别回退说明的变更仍应作为有意的 SemVer Release 管理。

## 迁移与回退

不移动既有 `v0.13.7` 标签，也不重写其 Release 或镜像。部署本 ADR 的首次 `main` 工作流成功后，`latest` 才从 `v0.13.7` 更新到对应的 `sha-<提交>` manifest。

宝塔实例不需要修改 `compose.baota.yml`。更新前先备份，面板拉取新 `latest` 并重建 Web/Worker；随后记录实际 Digest 和 `/api/version` 中的 commit。若需要回退，先评估迁移兼容性，再将镜像临时固定为已记录的 `sha-<提交>` 或正式 SemVer，必要时恢复升级前备份。

## 关联文档

- [ADR-0015：生产打包、首次安装门禁与恢复边界](./0015-production-packaging-setup-and-recovery.md)
- [ADR-0017：单文件面板 Compose 与镜像版本通道](./0017-single-file-panel-compose.md)
- [部署与运维](../05-deployment-operations.md)
- [安装与运维运行手册](../13-installation-operations-runbook.md)
