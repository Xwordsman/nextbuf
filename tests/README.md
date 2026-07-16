# Tests

- 与源码紧密关联的单元测试放在对应 `src/**/*.test.ts`。
- PostgreSQL/Redis/Mailpit 集成测试位于 `tests/integration`，必须使用独立真实服务运行。
- Playwright 端到端测试位于 `tests/e2e`，同时运行 Next.js standalone Web 与 Worker，覆盖多视口社区外壳和真实身份邮件旅程。

`v0.12.0` 在既有身份、社区、互动、通知、治理、信任和后台覆盖上增加环境 setup token 校验、安装完成 fixture、生产 Compose/脚本静态检查、amd64/arm64 镜像首次安装冒烟、setup 失败门禁、重复管理员拒绝以及 amd64 删除卷后的备份恢复。当前单元测试 45 项，真实服务集成测试 31 项，Playwright 6 项；容器冒烟由 GitHub Actions 单独执行。

本地浏览器测试先执行：

```bash
pnpm exec playwright install chromium
pnpm build
pnpm test:e2e
```
