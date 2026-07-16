# Tests

- 与源码紧密关联的单元测试放在对应 `src/**/*.test.ts`。
- PostgreSQL/Redis/Mailpit 集成测试位于 `tests/integration`，必须使用独立真实服务运行。
- Playwright 端到端测试位于 `tests/e2e`，同时运行 Next.js standalone Web 与 Worker，覆盖多视口社区外壳和真实身份邮件旅程。

`v0.11.0` 在既有身份、社区、互动、通知、治理和信任覆盖上增加站点设置校验与修订冲突、Session 绑定二次验证、用户后台分页、受控批量会话撤销、审计递归脱敏/CSV 安全和普通用户后台 API 拒绝。当前单元测试 44 项，真实服务集成测试 31 项，Playwright 6 项。

本地浏览器测试先执行：

```bash
pnpm exec playwright install chromium
pnpm build
pnpm test:e2e
```
