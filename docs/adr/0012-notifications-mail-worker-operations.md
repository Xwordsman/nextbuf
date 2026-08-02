# ADR-0012：通知、邮件与 Worker 恢复链路

- 状态：已接受
- 日期：2026-07-16
- 对应版本：`v0.9.0`

## 背景

回复、提及、主题关注和管理动作已经是 PostgreSQL 中的业务事实，但 `v0.8.0` 以前没有可靠的通知派生链路。Redis/BullMQ 可以被清空或短暂不可用，因此不能保存唯一的通知、失败任务或调度状态。邮件还涉及外部 SMTP 副作用，必须与站内通知和业务事务解耦。

## 决策

1. 业务写事务只保存业务事实和版本化 Outbox 事件。Dispatcher 发布后，PostgreSQL 仍保留事件；处理成功时，Handler 副作用、既有失败记录的解决状态、`ProcessedJob` 与 Outbox `processed_at` 在同一事务提交。初始 Dispatcher 与每分钟维护任务都排除尚未执行管理员重放的未解决最终失败；维护任务只从部分索引检查超过恢复窗口且 `processed_at` 为空的事件，并用事件 UUID 作为稳定 BullMQ Job ID 重新确认入队。恢复过程不依赖人工把 `published_at` 改回空值，也不会随已完成历史无限增长而反复扫描。
2. Worker 按事件事实生成结构化 `Notification`。回复事件对每个接收者只生成一条通知，优先级为提及、直接回复、关注主题回复；本人不接收自己的通知。
3. `Notification` 保存类型、触发者、Topic/Post 外键、稳定去重键和最小渲染快照，不保存不可解释的最终文案。
4. `NotificationPreference` 按通知类型保存站内和邮件偏好。缺省为站内开启、邮件关闭；偏好在事件处理时生效，不追溯发送旧通知。
5. `NotificationDelivery` 记录 `in_app` 与 `email` 渠道的 delivered、queued、skipped 或 failed 结果。普通通知邮件复用加密的 `EmailDelivery` 和稳定 Message-ID；邮箱验证与密码重置不读取普通通知偏好。
6. BullMQ 最终失败写入 `WorkerJobFailure`。邮件失败以 `email_delivery_id` 外键关联 `EmailDelivery` 并随投递删除；重放先保存请求，再由 Worker 周期任务移除 Redis 中的失败任务并重置对应 Outbox，防止 Web 请求中直接执行任务。
7. 周期任务的计划、租约和运行结果保存在 `WorkerScheduledTask`。多个 Worker 通过条件更新争抢租约；超时租约可被其他 Worker 接管。Worker 停止时不再领取新调度任务，并等待当前 BullMQ 任务关闭。
8. 队列健康、失败任务、重放和测试邮件仅向站点 `admin` 角色开放，不引入通用后台 CRUD。

## 投递语义

- 数据库通知和内部副作用由唯一键及 `ProcessedJob` 保证幂等；`processed_at` 是恢复扫描的持久终态，不替代 `ProcessedJob` 的重复执行保护。升级迁移使用既有 `ProcessedJob.completed_at` 回填历史终态。
- Worker 处理事件时使用既有 Outbox 锁字段取得独占处理租约，并按 `OUTBOX_LOCK_TIMEOUT_MS` 的三分之一周期续租。处理器在执行 Handler 前检查当前 owner，并在同一数据库事务写入 `ProcessedJob` 前以 `FOR UPDATE` 再次栅栏校验；失租的旧处理器回滚数据库副作用且不写最终失败记录。重复 Queue Job 遇到有效处理租约时直接让当前处理器继续；进程失联后租约过期，恢复扫描才能重新入队。默认恢复等待为 5 分钟，维护任务每分钟最多检查 `OUTBOX_BATCH_SIZE` 条；无积压时，Redis 丢失事件在发布后约 5 至 6 分钟重新入队。
- 尚未执行管理员重放的未解决最终失败不会被初始 Dispatcher 或自动恢复绕过；重放会在同一事务删除原 `ProcessedJob` 并清空 `published_at`、`processed_at` 和租约。重放已经执行后，旧失败记录保留审计但不再阻止该次事件初始派发或在 Redis 再次丢失时自动恢复；若重放任务产生新的最终失败，失败更新会清空 `replayed_at`，初始派发与恢复扫描再次停止并等待新的管理员重放。队列中仍存在的 waiting/delayed/active Job 通过稳定 Job ID 去重，扫描只刷新 PostgreSQL 发布确认；已写入 `processed_at` 的历史事件不再进入扫描。迁移后极短窗口内由旧 Worker 写入、尚未带终态的 `ProcessedJob` 会被稳定 Job ID 重新确认一次，新 Worker 读取既有幂等记录后补齐终态而不重复副作用。
- SMTP 网络 I/O 不得位于 Prisma 交互事务内。Worker 先用短事务锁定 `EmailDelivery`，把 `pending` 原子改为 `sending`，生成新的 attempt token/generation 并增加投递尝试次数；事务提交后才调用 Provider。Provider 成功后，第二个短事务按 `EmailDelivery -> WorkerJobFailure -> OutboxEvent` 锁序写入 `sent`，并把失败解决、`ProcessedJob` 与 Outbox `processed_at` 原子提交。claim、成功、失败与结果未知转换都匹配相同 attempt fence；旧 Worker 的迟到回调只能得到失租结果，不能覆盖新 attempt。
- SMTP 协议无法把“服务器已经接受邮件”和本地 PostgreSQL 提交做成同一个原子动作。V1 将 Provider 失败分成三类：4xx、原生 connect 失败及连接/问候阶段超时等明确未接受的临时故障回到 `pending`，由 BullMQ 在五次总尝试内自动重试；5xx、认证和无效信封等永久拒绝进入 `failed`；DATA 后断线、通用 Socket 超时、Worker 中断或 SMTP 成功后的本地完成失败进入独立的 `outcome_unknown`。遗留 `sending` 同样转换为固定 `EOUTCOMEUNKNOWN`，不自动再次发送。
- `outcome_unknown` 的人工 replay 必须显式确认可能重复投递，确认时间进入失败事实和治理审计。请求和执行阶段都按 `EmailDelivery -> WorkerJobFailure -> OutboxEvent` 取锁，并拒绝尚未过期的 PostgreSQL 处理租约；重放会立即轮换 attempt fence，再由下一次 claim 生成发送 attempt。稳定 Message-ID 只用于诊断和接收端去重，不构成 exactly-once 保证。
- Nodemailer 连接、问候和 Socket 缺省超时分别为 15 秒、15 秒和 60 秒，可由 `SMTP_CONNECTION_TIMEOUT_MS`、`SMTP_GREETING_TIMEOUT_MS` 与 `SMTP_SOCKET_TIMEOUT_MS` 调整。连接/问候超时发生在消息提交前，可以自动重试；无法证明发生阶段的 Socket/连接中断按 `outcome_unknown` 处理。
- Nodemailer/SMTP 异常在邮件 Provider 和 Worker 边界转换为固定安全错误，只保留受控错误码和数字型 SMTP response code，不传播原始响应、收件人、用户名、`cause` 或原始堆栈。邮件 BullMQ Job 完成或最终失败后立即删除，且不保存堆栈；PostgreSQL 保存的投递和 Worker 失败原因使用同一安全文本。
- 最终邮件失败在一个 PostgreSQL 事务中先锁定并核对 `EmailDelivery` attempt fence，再写入 `WorkerJobFailure`、`EmailDelivery` 和 `NotificationDelivery`。成功完成和人工 replay 同样先锁定 `EmailDelivery`，再处理失败事实与 Outbox。跨邮件与注销路径统一遵循 `EmailDelivery -> WorkerJobFailure -> OutboxEvent` 主锁序；投递已经被注销事务删除时不再创建失败记录，若失败事务先锁定，后续删除通过 `ON DELETE CASCADE` 清理失败记录。注销遇到 `sending` 或 `outcome_unknown` 时回滚该用户本次最终化并持久退避，等待明确完成、失败或经确认的重放结果。
- Redis 不是事实来源。清空 Redis 后，即使 Outbox 已经写入 `published_at`、Queue Job 尚未生成 `ProcessedJob`，维护任务也会从 PostgreSQL 自动重建；失败记录、重放请求和调度计划同样仍存在于 PostgreSQL。

## 回退与演进

- 回退应用版本前保留新增表；旧版本会忽略它们，不删除通知和失败证据。
- `v1.0.0` 保留 Outbox 与 `ProcessedJob` 历史，不引入时间型自动删除：前者是异步意图，后者仍承担重复执行保护。`processed_at` 部分索引把日常恢复成本限制在未完成集合；未来若增加归档或删除，必须先定义各 topic 的审计、隐私和幂等保留期，并用新的 ADR 与迁移替代这一合同。
- 迁移 `20260731120000_outbox_processed_status` 负责加入 `processed_at`、回填既有完成事实并创建部分恢复索引；`20260731180000_email_delivery_attempt_fencing` 增加 attempt token/generation、结果未知状态与重放风险确认时间，并把升级时遗留的 `sending` 安全转换为 `outcome_unknown`。两者进入 `v1.0.0` 的 16 条候选冻结清单。
- 大型站点可在后续版本将单个社区事件拆成分片 fan-out 任务，但必须保留当前去重键、偏好时点和渠道投递语义。
- 通知模板可以升级；历史记录继续用结构化类型和快照渲染。
