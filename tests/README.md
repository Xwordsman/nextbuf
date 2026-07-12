# Tests

- 与源码紧密关联的单元测试放在对应 `src/**/*.test.ts`。
- PostgreSQL/Redis/Mailpit 集成测试位于 `tests/integration`，必须使用独立真实服务运行。
- Playwright 端到端测试位于 `tests/e2e`，同时运行 Next.js standalone Web 与 Worker，覆盖多视口社区外壳和真实身份邮件旅程。

`v0.6.0` 已覆盖环境配置、迁移 readiness、setup 幂等、Outbox/Worker、身份与资料完整链路，以及默认节点、主题/首帖/初始修订事务、内容规则、发布频率、作者与版主权限、不可变修订、管理状态、软删除恢复、节点归档/可见性、双向游标分页和真实浏览器发布编辑旅程。

本地浏览器测试先执行：

```bash
pnpm exec playwright install chromium
pnpm build
pnpm test:e2e
```
