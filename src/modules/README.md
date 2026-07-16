# Domain Modules

业务模块从对应版本开始加入本目录。模块只通过公开的服务端入口协作，不能跨模块直接修改数据表。

当前真实模块：

- `identity`：Better Auth 身份、会话、邀请码、邮件和审计。
- `profiles`：UID、用户名、头像、资料和隐私。
- `community`：节点、主题、position=1 首帖、修订、授权和社区审计。
- `interactions`：点赞、收藏、关注、阅读状态、浏览聚合、热门和搜索发现。
- `notifications`：结构化通知、渠道偏好、投递意图和通知邮件模板。
- `worker`：站点管理员授权的队列摘要、失败重放和测试邮件操作。

治理、持久化信任计算和插件仍按路线图逐阶段加入，不能通过演示数据伪造完成状态。

计划模块和边界见 `docs/02-system-architecture.md` 与 `docs/10-repository-structure.md`。
