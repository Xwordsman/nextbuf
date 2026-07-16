# Domain Modules

业务模块从对应版本开始加入本目录。模块只通过公开的服务端入口协作，不能跨模块直接修改数据表。

当前真实模块：

- `identity`：Better Auth 身份、会话、邀请码、邮件和审计。
- `profiles`：UID、用户名、头像、资料和隐私。
- `community`：节点、主题、position=1 首帖、修订、授权和社区审计。
- `interactions`：点赞、收藏、关注、阅读状态、浏览聚合、热门和搜索发现。
- `notifications`：结构化通知、渠道偏好、投递意图和通知邮件模板。
- `worker`：站点管理员授权的队列摘要、失败重放和测试邮件操作。
- `moderation`：举报聚合、案件查询、内容处置、制裁、角色层级和治理审计。
- `trust`：版本化 TL 规则、真实指标、宽限期、历史和可恢复批次重算。

完整管理后台、站点设置和插件仍按路线图逐阶段加入，不能通过演示数据伪造完成状态。

计划模块和边界见 `docs/02-system-architecture.md` 与 `docs/10-repository-structure.md`。
