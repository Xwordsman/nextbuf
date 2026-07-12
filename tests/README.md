# Tests

- 与源码紧密关联的单元测试放在对应 `src/**/*.test.ts`。
- PostgreSQL/Redis 集成测试位于 `tests/integration`，必须使用独立真实服务运行。
- Playwright 端到端测试将在 `tests/e2e` 建立。

`v0.2.0` 已覆盖环境配置、迁移 readiness、setup 幂等、Outbox 投递、Worker 重启续跑、任务幂等和 Redis 清空后的事实数据完整性。
