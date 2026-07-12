# Domain Modules

业务模块从对应版本开始加入本目录。模块只通过公开的服务端入口协作，不能跨模块直接修改数据表。

当前真实模块：

- `identity`：Better Auth 身份、会话、邀请码、邮件和审计。
- `profiles`：UID、用户名、头像、资料和隐私。
- `community`：节点、主题、position=1 首帖、修订、授权和社区审计。

普通回复、附件、互动、通知、治理和信任计算仍按路线图逐阶段加入，不能通过演示数据伪造完成状态。

计划模块和边界见 `docs/02-system-architecture.md` 与 `docs/10-repository-structure.md`。
