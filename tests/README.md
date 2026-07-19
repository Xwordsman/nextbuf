# Tests

- 与源码紧密关联的单元测试放在对应 `src/**/*.test.ts`。
- PostgreSQL/Redis/Mailpit 集成测试位于 `tests/integration`，必须使用独立真实服务运行。
- Playwright 端到端测试位于 `tests/e2e`，通过构建后的 CLI 执行 setup，并同时运行 Next.js standalone Web 与 Worker，覆盖多视口社区外壳和真实身份邮件旅程。

当前 `v0.13.7` 基线包含 63 项单元测试、32 项真实服务集成测试和 14 项 Playwright；容器冒烟由 GitHub Actions 单独执行，并验证宝塔单文件 Compose 不依赖 `.env`、只包含四个服务、使用通过验证的滚动 `latest` 通道且具有四个固定容器名。覆盖建立在 `v0.12.0` 的 setup token、首次管理员、生产 Compose、amd64/arm64 镜像和空卷恢复之上；全新安装还会验证首位管理员的 UID 为 1。

Pull Request 只执行完整代码/真实服务/E2E 检查；主分支额外使用原生 amd64/arm64 构建、拉取和基础冒烟，并在两个架构都成功后合并 `sha-<提交>` 与滚动 `latest` GHCR manifest。每日定时、手动和 `v*` 标签运行的 amd64 追加空卷恢复、故障注入和升级；只有标签运行生成正式 SemVer manifest、供应链证明和非 Docker 资产。

`v0.13.x` 加固覆盖生产依赖审计、历史迁移 SHA-256、全部自有写接口同源、nonce CSP、递归日志脱敏、结构化上传、单列外键索引、Doctor 容量快照、后台积压告警、25 个 Outbox 任务预算、公共页面 p50/p95、多视口 axe、故障恢复和跨 Beta 镜像升级。容器冒烟还要求空数据库通过默认 Web 启动自动初始化，首次访问重定向 `/setup`，新安装没有业务节点，最终只有四个生产服务且没有停止的 setup 容器记录；升级测试同时保护已有节点。共享 Runner 的时间门槛用于发现严重回归，不替代指定资源和数据规模下的上线压测。

本地浏览器测试先执行：

```bash
pnpm exec playwright install chromium
pnpm build
pnpm test:e2e
```
