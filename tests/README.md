# Tests

- 与源码紧密关联的单元测试放在对应 `src/**/*.test.ts`。
- PostgreSQL/Redis 集成测试将在 `tests/integration` 建立。
- Playwright 端到端测试将在 `tests/e2e` 建立。

当前 `v0.1.0` 只验证工程基础、错误模型和请求 ID。
