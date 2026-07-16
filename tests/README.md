# Tests

- 与源码紧密关联的单元测试放在对应 `src/**/*.test.ts`。
- PostgreSQL/Redis/Mailpit 集成测试位于 `tests/integration`，必须使用独立真实服务运行。
- Playwright 端到端测试位于 `tests/e2e`，同时运行 Next.js standalone Web 与 Worker，覆盖多视口社区外壳和真实身份邮件旅程。

`v0.8.0` 已覆盖环境/S3 配置、迁移 readiness、setup 幂等、Outbox/Worker、身份与资料完整链路，节点、主题/首帖、并发回复楼层、引用、提及、回复草稿、编辑修订、软删除恢复、Markdown/附件，以及重复互动幂等、阅读楼层、浏览桶/Worker 聚合、热门算法、搜索可见性、个人列表和真实浏览器点赞/收藏/关注/搜索旅程。

本地浏览器测试先执行：

```bash
pnpm exec playwright install chromium
pnpm build
pnpm test:e2e
```
