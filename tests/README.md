# Tests

- 与源码紧密关联的单元测试放在对应 `src/**/*.test.ts`。
- PostgreSQL/Redis/Mailpit 集成测试位于 `tests/integration`，必须使用独立真实服务运行。
- Playwright 端到端测试位于 `tests/e2e`，同时运行 Next.js standalone Web 与 Worker，覆盖多视口社区外壳和真实身份邮件旅程。

`v0.7.0` 已覆盖环境/S3 配置、迁移 readiness、setup 幂等、Outbox/Worker、身份与资料完整链路，以及节点、主题/首帖、并发回复楼层、引用、提及、回复草稿、编辑修订、关闭主题权限、软删除恢复、Markdown 安全策略、文件签名、文本/图片附件处理、失败追踪、不可变修订附件引用、双向主题游标、30 楼回复分页和真实浏览器 Markdown/附件/回复旅程。

本地浏览器测试先执行：

```bash
pnpm exec playwright install chromium
pnpm build
pnpm test:e2e
```
