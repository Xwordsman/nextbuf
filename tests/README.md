# Tests

- 与源码紧密关联的单元测试放在对应 `src/**/*.test.ts`。
- PostgreSQL/Redis 集成测试位于 `tests/integration`，必须使用独立真实服务运行。
- Playwright 端到端测试位于 `tests/e2e`，运行 Next.js standalone 构建，覆盖桌面、平板、手机、交互、截图、横向溢出和 axe。

`v0.3.0` 已覆盖环境配置、迁移 readiness、setup 幂等、Outbox 投递、Worker 重启续跑、任务幂等、Redis 清空后的事实数据完整性，以及社区页面框架的多视口 E2E。

本地浏览器测试先执行：

```bash
pnpm exec playwright install chromium
pnpm build
pnpm test:e2e
```
