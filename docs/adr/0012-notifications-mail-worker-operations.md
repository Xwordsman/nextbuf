# ADR-0012：通知、邮件与 Worker 恢复链路

- 状态：已接受
- 日期：2026-07-16
- 对应版本：`v0.9.0`

## 背景

回复、提及、主题关注和管理动作已经是 PostgreSQL 中的业务事实，但 `v0.8.0` 以前没有可靠的通知派生链路。Redis/BullMQ 可以被清空或短暂不可用，因此不能保存唯一的通知、失败任务或调度状态。邮件还涉及外部 SMTP 副作用，必须与站内通知和业务事务解耦。

## 决策

1. 业务写事务只保存业务事实和版本化 Outbox 事件。Dispatcher 在 Redis 恢复后仍可重新发布未投递事件。
2. Worker 按事件事实生成结构化 `Notification`。回复事件对每个接收者只生成一条通知，优先级为提及、直接回复、关注主题回复；本人不接收自己的通知。
3. `Notification` 保存类型、触发者、Topic/Post 外键、稳定去重键和最小渲染快照，不保存不可解释的最终文案。
4. `NotificationPreference` 按通知类型保存站内和邮件偏好。缺省为站内开启、邮件关闭；偏好在事件处理时生效，不追溯发送旧通知。
5. `NotificationDelivery` 记录 `in_app` 与 `email` 渠道的 delivered、queued、skipped 或 failed 结果。普通通知邮件复用加密的 `EmailDelivery` 和稳定 Message-ID；邮箱验证与密码重置不读取普通通知偏好。
6. BullMQ 最终失败写入 `WorkerJobFailure`。重放先保存请求，再由 Worker 周期任务移除 Redis 中的失败任务并重置对应 Outbox，防止 Web 请求中直接执行任务。
7. 周期任务的计划、租约和运行结果保存在 `WorkerScheduledTask`。多个 Worker 通过条件更新争抢租约；超时租约可被其他 Worker 接管。Worker 停止时不再领取新调度任务，并等待当前 BullMQ 任务关闭。
8. 队列健康、失败任务、重放和测试邮件仅向站点 `admin` 角色开放，不引入通用后台 CRUD。

## 投递语义

- 数据库通知和内部副作用由唯一键及 `ProcessedJob` 保证幂等。
- SMTP 是外部系统，采用至少一次尝试和稳定 Message-ID。SMTP 已接受邮件但进程在状态提交前崩溃时，协议本身无法提供严格的端到端 exactly-once；接收端可用稳定 Message-ID 去重。
- Redis 不是事实来源。清空 Redis 后，未完成的 Outbox、失败记录、重放请求和调度计划仍存在于 PostgreSQL。

## 回退与演进

- 回退应用版本前保留新增表；旧版本会忽略它们，不删除通知和失败证据。
- 大型站点可在后续版本将单个社区事件拆成分片 fan-out 任务，但必须保留当前去重键、偏好时点和渠道投递语义。
- 通知模板可以升级；历史记录继续用结构化类型和快照渲染。
