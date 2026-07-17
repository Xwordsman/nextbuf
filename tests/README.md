# Tests

- 与源码紧密关联的单元测试放在对应 `src/**/*.test.ts`。
- PostgreSQL/Redis/Mailpit 集成测试位于 `tests/integration`，必须使用独立真实服务运行。
- Playwright 端到端测试位于 `tests/e2e`，通过构建后的 CLI 执行 setup，并同时运行 Next.js standalone Web 与 Worker，覆盖多视口社区外壳和真实身份邮件旅程。

`v0.12.0` 在既有身份、社区、互动、通知、治理、信任和后台覆盖上增加环境 setup token 校验、安装完成 fixture、生产 Compose/脚本静态检查、amd64/arm64 镜像首次安装冒烟、setup 失败门禁、重复管理员拒绝以及 amd64 删除卷后的备份恢复。当前单元测试 46 项，真实服务集成测试 32 项，Playwright 6 项；容器冒烟由 GitHub Actions 单独执行。

Pull Request 只执行完整代码/真实服务/E2E 检查；主分支额外执行原生 amd64 镜像冒烟。每日定时、手动和 `v*` 标签运行使用原生 amd64/arm64 Runner，amd64 追加空卷恢复；只有标签运行生成供应链证明、合并正式 GHCR manifest 并发布非 Docker 资产。

`v0.13.0` 加固覆盖生产依赖审计、历史迁移 SHA-256、全部自有写接口同源、nonce CSP、递归日志脱敏、结构化上传、单列外键索引、Doctor 容量快照、后台积压告警、25 个 Outbox 任务预算、公共页面 p50/p95 和键盘跳转主内容。共享 Runner 的时间门槛用于发现严重回归，不替代指定资源和数据规模下的上线压测。

本地浏览器测试先执行：

```bash
pnpm exec playwright install chromium
pnpm build
pnpm test:e2e
```
