# Tests

- 与源码紧密关联的单元测试放在对应 `src/**/*.test.ts`。
- PostgreSQL/Redis/Mailpit 集成测试位于 `tests/integration`，必须使用独立真实服务运行。
- 集成测试 PostgreSQL 账号必须拥有 `CREATE DATABASE` 权限；首次安装竞态用例会为每个场景创建、迁移并强制清理一个随机临时数据库，避免读取或删除其他测试数据。仓库提供的测试 Compose 与 GitHub Actions 服务账号已经满足该条件。
- Playwright 端到端测试位于 `tests/e2e`，通过构建后的 CLI 执行 setup，并同时运行 Next.js standalone Web 与 Worker，覆盖多视口社区外壳和真实身份邮件旅程。

已发布 `v0.13.10` 声明 77 项单元测试、47 个真实服务集成 case 和 14 个 Playwright spec；容器冒烟由 GitHub Actions 单独执行，并验证宝塔单文件 Compose 不依赖 `.env`、只包含四个服务、使用通过验证的滚动 `latest` 通道且具有四个固定容器名。覆盖建立在 setup token、首次管理员、生产 Compose、amd64/arm64 镜像和空卷恢复之上；全新安装还会验证首位管理员的 UID 为 1。该版本新增统一客户端 IP 解析、隐藏节点附件授权、真实发布归档、SemVer 升级和迁移后故障恢复门槛。不可变 `v0.13.9` 标签因 Linux x64 standalone 归档依赖链接被展平而启动失败，不构成完整发布或升级基线；`v0.13.10` 已通过精确 `v0.13.8 -> v0.13.10` 升级和全部归档/镜像门槛，当前公开升级基线为 `0.13.10`。

已审计自动化基线 `9342815e394b4e93d215ace98b2937412f422016` 包含 109 项单元测试、87 个真实服务集成 case 和 14 个 Playwright 旅程，并覆盖最终账号注销、治理证据/邮件隐私、管理员连续性、首次安装 claim 所有权与当前表单密码证明、Better Auth 资料更新边界、replay 与普通 Dispatcher 的终态 Redis Job 竞态，以及 `v0.13.10 -> v1.0.0` 升级恢复门槛。已记录升级证据代码基线 `1054a4de3ee2f6c2be2a72708ae842b3f7d16134` 在主线 CI 通过 124 项单元、91 项真实服务集成和 14 项 Playwright：新增严格 HMAC 快照合同，以及用真实 13 条历史迁移和 3 条候选迁移执行的验收比较回归。迁移策略单测继续覆盖冻结历史的合法前缀、checksum 漂移、缺口/额外记录和自定义 PostgreSQL schema。后续文档提交和最终冻结候选必须使用各自 commit 的独立 CI 与不可变 `sha-*` 证据，人工验收和正式标签资产完成前仍只构成候选自动化证据。

`v1.0.0` 仍是候选版本。候选集成测试覆盖最终账号注销的到期领取、取消、失败退避、精确墓碑身份、认证/私人数据清理、公开内容与治理证据保留、对象回收 Outbox，以及管理员连续性的合格条件、角色交接、并发撤销、制裁保护和 Doctor/后台告警。异步链路还覆盖 `processed_at` 历史回填与部分恢复索引、处理租约提交栅栏、已发布未处理事件在 Redis 丢失后的自动恢复、replay 后再次清空 Redis 的恢复、新最终失败重新阻断、慢 SMTP 超过 Prisma 默认事务期限仍只提交一次、明确未接受故障的自动重试、结果未知停止自动发送、重复风险确认、PostgreSQL 租约与 attempt fence，以及注销和邮件统一采用 `EmailDelivery -> WorkerJobFailure -> OutboxEvent` 锁序。它们不是稳定 Release 证据；发布前仍须在真实 PostgreSQL、Redis 与 Mailpit 上完成精确 `v0.13.10 -> v1.0.0` 升级、恢复和完整候选流水线。该升级的前置条件是至少 1 位可接管管理员，生产实例优先 2 位：`admin/site`、active、邮箱已验证、无注销申请/计划、无有效 suspend/ban，且有密码非空的 Better Auth `credential` Account。

Pull Request 只执行完整代码/真实服务/E2E 检查；主分支额外使用原生 amd64/arm64 构建、拉取和基础冒烟，并在 amd64 从当前公开版本执行带验收证据比较和附件校验的真实升级。主分支与正式标签只在 Linux x64 Runner 构建并解压冒烟 Linux x64 归档，校验 checksum、Next.js standalone 的 pnpm 链接不悬空或逃出归档、关键运行依赖可解析、systemd/PM2 路径合同，并在真实 PostgreSQL、Redis 和 Mailpit 上从归档执行 setup、启动独立 Web/Worker、创建首位管理员和运行 doctor；失败摘要会标明具体阶段并脱敏。每个架构用 artifact 固定实际测试的运行时与带 SBOM/provenance 的不可变 `sha-<提交>-<架构>` 源索引 Digest；只有双架构镜像、升级门槛和发布归档同时成功，主分支才从内容地址合并并完整验证 `sha-<提交>` 与滚动 `edge`。发布演练和正式标签复用同一源索引，不重新构建；SemVer manifest 必须与人工验收的 `sha-<提交>` Digest 完全相同。Release 资产完成后才更新 `latest`。复用完成状态或提升前会下载完成回执与三项必需资产，并从 API 核对 Release 正文，验证标签目标 commit、版本、正文 SHA-256、全部资产 SHA-256 和旁路归档校验和。每日定时、手动和 `v*` 标签运行的 amd64 在升级之外额外执行空卷恢复与故障注入；日常主分支不重复这两类深度演练。

`v0.13.x` 加固覆盖生产依赖审计、历史迁移 SHA-256、全部自有写接口同源、nonce CSP、递归日志脱敏、结构化上传、单列外键索引、Doctor 容量快照、后台积压告警、25 个 Outbox 任务预算、公共页面 p50/p95、多视口 axe、故障恢复和跨 Beta 镜像升级。容器冒烟还要求空数据库通过默认 Web 启动自动初始化，首次访问重定向 `/setup`，新安装没有业务节点，最终只有四个生产服务且没有停止的 setup 容器记录；升级测试同时保护已有节点。共享 Runner 的时间门槛用于发现严重回归，不替代指定资源和数据规模下的上线压测。

本地浏览器测试先执行：

```bash
pnpm exec playwright install chromium
pnpm build
pnpm test:e2e
```
