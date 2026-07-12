# Tests

- 与源码紧密关联的单元测试放在对应 `src/**/*.test.ts`。
- PostgreSQL/Redis/Mailpit 集成测试位于 `tests/integration`，必须使用独立真实服务运行。
- Playwright 端到端测试位于 `tests/e2e`，同时运行 Next.js standalone Web 与 Worker，覆盖多视口社区外壳和真实身份邮件旅程。

`v0.5.0` 已覆盖环境配置、迁移 readiness、setup 幂等、Outbox 投递、Worker 重启续跑、任务幂等、Redis 清空后的事实数据完整性、scrypt 凭证、验证标识 HMAC、邮件 AES-GCM、邀请码原子使用、SMTP Worker、注册/验证/登录、两设备会话、密码重置撤销、用户名规则与历史别名、UID/Profile 自动创建、头像格式与替换、公开资料激活边界、隐私设置和注销申请。

本地浏览器测试先执行：

```bash
pnpm exec playwright install chromium
pnpm build
pnpm test:e2e
```
