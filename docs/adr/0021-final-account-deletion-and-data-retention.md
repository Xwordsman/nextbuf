# ADR-0021：最终账号注销、匿名化与数据保留

- 状态：Accepted
- 日期：2026-07-30
- 适用版本：`v1.0.0`

## 背景

ADR-0009 已实现 14 天可撤销的注销申请，但没有执行到期后的最终处理。NextBuf 的 User 同时是公开内容作者、不可变修订编辑者、治理操作人和制裁目标；直接删除 User 会破坏 UID、Topic number、Post position、历史用户名占用和审计外键。只把账号标记为 deleted 又会保留邮箱、密码、OAuth 令牌、Session、私人草稿、社交关系和存储对象，不满足最终注销的隐私边界。

最终处理还必须面对多 Worker 并发、对象存储暂时故障和管理员连续性。一个失败对象不能阻塞后续到期账号；持有站点管理员角色的账号也不能在角色尚未交接时进入注销。

## 决策

### 1. 申请、撤销与管理员交接

- 首次申请固定记录请求时间和 14 天后的计划时间；重复申请不延长计划时间。
- 到期前撤销会清空计划、失败原因、下次尝试时间和尝试次数。
- 持有 `admin/site` 角色的用户必须先完成交接并撤销该角色，之后才能申请；Worker 最终执行前再次检查，覆盖申请后重新授予角色的情况。
- 管理员相关事务统一先取得管理员连续性 advisory transaction lock，再锁 User 行。角色授予/撤销、暂停/封禁、注销和 credential 变更不得建立相反锁顺序。
- “可接管管理员”必须同时满足：持有 `admin/site` 角色、`User.status=active`、邮箱已验证、没有注销申请或计划、没有当前有效的 suspend/ban，并存在 `provider_id=credential` 且密码非空的 Better Auth Account。TL、OAuth Account 或仅有角色行都不能替代这些条件。
- 新授予 `admin/site` 角色时必须在同一连续性锁内验证上述候选条件；已申请注销、未验证、受暂停/封禁或没有密码凭据的账号不能获授管理员。首次安装是唯一引导例外：先由 Better Auth 创建密码账号并授予首位管理员，邮件验证完成前 Doctor 明确报告连续性失败。
- 首次安装例外只放宽邮箱尚未验证和 `pending` 状态，不放宽密码凭据、注销计划、deleted 状态或有效暂停/封禁。setup 重试复用 Better Auth 已提交的用户前必须重新验证非空 credential，并在最终事务锁定该凭据、使用 Better Auth verifier 证明当前表单密码；证明过程不创建 Session/Cookie，密码不匹配时返回 `initial_administrator_password_mismatch`，不得授予角色、写入完成状态或覆盖现有哈希。只有 User、没有密码 Account 的半成品不能获得角色或写入安装完成状态。复用尚未验证的完整账号时重新请求 Better Auth 验证邮件。
- 撤销角色、暂停或封禁不得使可接管管理员从 1 变为 0；若站点已经是 0 位，仍保留现有 `admin/site` 角色作为修复入口，直到至少恢复 1 位可接管管理员后才允许撤销。Doctor 对 0 位报告失败，对 1 位报告可成功退出的冗余警告，对 2 位及以上报告健康；管理后台首页显示同一告警。
- V1 禁止通过 Better Auth `/unlink-account` 解绑 `credential` Account，OAuth Account 继续使用 Better Auth 原有解绑行为。最终注销只有在 `admin/site` 角色已经撤销后才会删除全部认证 Account。

### 2. User 保留为不可登录墓碑身份

最终注销不删除 User 行：

- 保留内部 User UUID、不可变 UID、`created_at`、公开 Topic/Post 归属、楼层、修订编辑者关系和治理/制裁关系。
- 当前用户名转入永久 UsernameAlias；User 改为稳定的 `deleted-<UID>` 墓碑用户名。连字符不属于普通用户名规则，因此该内部命名空间不能被普通账号或既有合法别名预占；升级遇到异常占用时明确失败，不生成替代墓碑身份。历史用户名永不释放，墓碑账号的既有 Alias 不能改名、转移或删除。
- 昵称改为 `已注销用户`；邮箱替换为基于 User UUID 的 `@deleted.invalid` 墓碑地址；清空头像、邮箱验证、激活时间、用户名冷却和注销计划；状态改为 `deleted`，记录 `deletion_finalized_at`。公开内容和永久别名继续解析到只显示墓碑名称、墓碑用户名及 UID 的最小公开页，不显示 Profile、互动、信任状态或账号操作。
- `deleted-` 用户名空间和 `@deleted.invalid` 邮箱域只供墓碑身份使用。Better Auth 的所有 User 创建入口和 PostgreSQL 约束同时拒绝普通账号占用；`deleted_...` 仍是既有普通用户名规则允许的格式，升级不会改写它。升级若发现异常直接数据库写入已占用内部格式或墓碑邮箱域，会以明确约束错误中止，不自动改写既有公开身份。墓碑邮箱必须精确匹配当前 User UUID，墓碑用户名必须匹配当前 UID。
- 删除全部 Better Auth Account、Session，以及值直接等于 User UUID 或合法 JSON `link.userId` 精确指向该 UUID 的 Verification。数据库触发器以 User 行锁为顺序边界，拒绝为 `status=deleted` 的墓碑账号新增或改绑 Account/Session，也拒绝新增或改写精确指向墓碑 User 的 Verification，覆盖已发起登录、密码重置或 OAuth 回调与最终化并发；无关联的通用 Verification 值保持 Better Auth 原有行为。Better Auth 继续拥有正常账号的密码、Session、验证、OAuth 和 Cookie 语义，最终化只清理其持久事实，不自行实现认证。
- PostgreSQL 将墓碑 User 设为不可再次修改或硬删除，并拒绝为 deleted User 新建或改绑 Profile、别名、内容作者、草稿、附件、角色、治理操作人、信任状态、互动、通知和通知偏好等可变事实。守卫与最终化使用同一 User 行锁顺序，使已经在途的写入先完成并被本事务清理，或在墓碑提交后失败，不能在最终化之后重新附着私人状态。

### 3. 公开内容和治理证据保留

- 保留 published/closed/hidden/deleted Topic、published/soft-deleted Post、Post position、全部不可变 Revision、公开内容附件引用和当前引用。
- 保留 ModerationReport、ModerationCase、ModerationAction、ModerationSanction、GovernanceAuditEvent、TrustLevelHistory 和必要 CommunityAuditEvent。它们继续引用同一个墓碑 User，因此证据链和目标身份仍可解释。
- 删除私人 draft Topic、draft Post、CommunityPostDraft 和 ReplyEditorSession。删除前将 Moderation 表对这些私人 Topic/Post 的可空外键置空，保留已有 target key、snapshot 和处置事实；V1 迁移相应允许 topic/post 类型的历史治理记录处于已脱离内容外键的状态，同时继续保持目标类型互斥。CommunityAuditEvent 保留事件类型、时间和墓碑操作人，但先清空 `metadata`、`request_id`，再由外键动作清空私人 Topic/Post 引用。
- 当前 TrustUserState 删除，日常信任重算跳过 deleted User；历史信任变化继续保留。

### 4. 私人身份、互动、通知与邮件清理

- 删除 Profile、收到的 Notification、NotificationPreference、点赞、收藏、关注关系、Topic 关注、阅读状态、本人 HMAC 浏览桶和指向本人的 Mention 事实。`AUTH_SECRET` 轮换后，部署者把旧值无损编码到最多 8 个、只用于清理的 `TOPIC_VIEW_PREVIOUS_AUTH_SECRETS`；最终化同时计算当前与全部旧值对应的用户哈希，旧值不参与认证或新浏览写入。旧值从最后一个旧 Web 停止写入起至少保留 30 天，并继续保留到数据库确认没有早于该停止时间的浏览桶；默认恢复要求历史密钥数组与备份一致。
- 删除点赞和收藏时在同一 PostgreSQL 事务同步扣减 Post `like_count` 与 Topic `bookmark_count`，并以零为下限。
- 其他用户收到的历史通知可以保留，但清空 `actor_id`，并把 snapshot 中的 actor name/username 统一改为墓碑身份，避免通知私域继续保存旧身份。
- 删除收件人为旧邮箱的 EmailDelivery，以及由注销用户作为 actor 生成的历史通知 EmailDelivery，包括加密正文；NotificationDelivery 保留既有投递状态但由外键清空 `email_delivery_id`。注销按 UUID 排序 `FOR UPDATE` 锁定目标 EmailDelivery，随后删除投递并级联 WorkerJobFailure，最后清空相关 OutboxEvent 错误；邮件 claim、成功完成、最终失败和人工 replay 同样从 EmailDelivery 开始取得锁，统一遵循 `EmailDelivery -> WorkerJobFailure -> OutboxEvent`。若目标投递为 `sending` 或 `outcome_unknown`，本次注销事务回滚并记录退避，等待 attempt 明确结束或管理员确认重复风险后完成重放；这样 SMTP I/O 可以离开数据库事务，同时不会在仍可能完成或已被 Provider 接受的外部调用之前删除身份邮件事实。attempt token/generation 阻止迟到 Worker 改写新 attempt；遗留 Outbox 只保存随机 delivery ID，处理时发现投递不存在即幂等跳过。
- 验证和密码重置邮件使用 Better Auth 的事务后回调入队，再用 User ID 锁定已提交的当前 User，并在锁后核对非 deleted 身份与当前邮箱；注册事务中的 User 对邮件事务可见，已经读取旧邮箱但尚未提交的身份邮件也不能越过最终化重新落库。
- IdentityAuditEvent 只保留事件类型、User UUID 和时间；清空 Session ID、IP HMAC 和 metadata，并追加无网络信息的 `identity.deletion.finalized` 事件。
- 撤销用户拥有的全部社区角色；其历史治理动作继续指向墓碑 User。由该用户授予但仍有效的其他用户角色清空 `granted_by_id`，不删除被授予人的角色。
- ModerationCase 的 `assigned_to_id` 是当前工作分配而非历史证据，最终化时清空；PostgreSQL 拒绝把案件重新指派给 deleted User。举报来源、案件创建者、处置操作者、制裁创建/撤销人和 TrustLevelHistory 等历史证据继续引用墓碑 User。

### 5. 附件、头像与对象存储

- 删除草稿引用后，找出没有当前 Post、Revision 或 Draft 引用的附件，立即标记为 orphan，清空原文件名并写入版本化 Attachment collect Outbox。
- 仍被公开 Post 或不可变 Revision 引用的附件继续保留，即使上传者已经注销。
- 本地头像 URL 在 User 事务内清空，并写入独立头像回收 Outbox。存储删除是幂等操作；对象不存在视为成功。
- PostgreSQL 提交不依赖对象存储在线。存储失败沿用 ADR-0012 的 BullMQ 重试、WorkerJobFailure 和人工 replay 机制，不会重新暴露已清空的数据库身份。

### 6. Worker 抢占、失败隔离与重试

- `worker.maintenance` 每分钟扫描到期账号。单轮最多处理 10 个，使用 PostgreSQL `FOR UPDATE SKIP LOCKED` 逐个领取，并以 `deletion_next_attempt_at` 建立 5 分钟租约；后一个账号只会在前一个账号完成处理后才领取，避免串行批处理消耗后续账号的租约。
- 每个账号在独立事务中最终化，交互事务明确允许最多 2 分钟且短于 5 分钟领取租约，事务内单条 SQL 上限提高到 110 秒但仍短于事务上限；最终化前必须同时核对领取时的尝试次数和租约时间作为 fencing token。附件回收 Outbox 使用集合写入，处理规模不随附件数量增加数据库往返次数。邮件收件人、邮件 Outbox delivery ID、Verification owner 和 Worker failure Outbox 外键均有对应索引，避免历史表增长后反复触发默认 15 秒语句超时。单个失败写入 `deletion_attempt_count`、`deletion_last_error` 和指数退避的 `deletion_next_attempt_at`，随后继续处理本轮其他账号。
- 退避从 1 分钟开始，最长 24 小时。Worker 在事务内再次检查计划仍到期且领取 fencing token 仍归自己；并发撤销或新租约接管后，旧任务只记为 skipped。
- 失败回写必须同时匹配领取时的尝试次数和租约时间；撤销后重新申请或由新租约接管时，旧任务的迟到失败不能覆盖新状态。
- PostgreSQL 是注销状态和重试事实来源；清空 Redis 不会取消申请、重置失败或重复释放用户名。邮件 Provider 原始异常只在内存边界内存在，BullMQ、Worker 日志及 PostgreSQL 只接触不含收件人、用户名、原始响应、cause 或原始堆栈的受控错误。

### 7. 并发派生事实

- 登录用户浏览桶在写入前锁定 User；墓碑账号不再创建 HMAC 浏览事实。匿名浏览语义不变。
- 信任重算批次按 UID 领取时锁定非 deleted User，完成时以实际处理数量校正批次总数，不能在最终化后重新创建当前 TrustUserState。
- 通知 Worker 对 actor 和候选接收者按稳定顺序统一锁定 User，并在锁后重新检查 actor；最终化与通知生成竞争时，不会为墓碑 actor 生成新的身份快照或为墓碑接收者生成通知。

### 8. 备份与恢复

- 最终化立即作用于在线 PostgreSQL 和对象存储，不改写已经离线生成的历史备份。历史备份继续受部署者的加密、访问控制和保留周期约束。
- 恢复到最终化之前的备份会恢复当时的数据状态。恢复演练或灾难恢复期间不得在 Worker 完成所有已到期注销前重新开放公网写入；运维验收需要检查注销积压和失败原因。
- 最终注销不可作为普通产品操作回滚。需要恢复误注销数据时只能使用受控备份恢复，并同时承担恢复点之后所有站点数据回退的后果。

## 备选方案

### 硬删除 User 并级联全部关系

不采用。它会删除公开讨论、复用 UID/用户名语义、破坏楼层和治理证据，并让通知、修订和制裁外键失去解释来源。

### 只设置 `User.status=deleted`

不采用。凭证、Session、邮箱、OAuth 令牌、私人草稿、通知、互动和对象存储仍然存在，不是完整注销。

### 在 Web 请求内同步删除对象存储

不采用。14 天到期通常没有浏览器请求，而且 S3/文件系统故障会延长数据库敏感字段的保留并阻塞其他账号。数据库先匿名化、存储走可重试 Outbox，故障边界更清楚。

### 用 Redis 锁或队列作为到期事实

不采用。Redis 可清空，不能承载注销截止时间、尝试次数或失败原因。PostgreSQL 行锁和租约可以让多 Worker 并发且可恢复。

## 后果

- 正面：公开讨论、稳定编号和治理证据保持完整；凭证与私人数据有明确清理边界；多 Worker 并发不会重复处理；存储故障与账号扫描隔离。
- 代价：User 墓碑和必要治理历史会长期存在；附件对象回收是最终一致而非与 User 事务同步；恢复旧备份后必须重新执行到期注销。
- 限制：本 ADR 不提供用户数据导出、自定义站点保留周期或备份自动销毁；这些能力需要独立政策和后续版本决策，不能改变本 ADR 的稳定身份与公开内容合同。

## 迁移与回退

迁移 `20260730120000_account_deletion_finalization` 新增最终化时间、尝试次数、下次尝试、最后错误、状态/墓碑命名空间约束和到期/隐私清理索引，并为 `WorkerJobFailure` 增加级联到 `EmailDelivery` 的可空外键；历史邮件失败通过对应 Outbox 的随机 `deliveryId` 回填，既有邮件投递、失败记录和邮件 Outbox 的原始错误降为固定安全文本。既有正常申请保持原请求与计划时间，升级后由 Worker 正常领取；不会重新开始 14 天等待。申请时间与计划时间必须同时存在或同时为空；没有申请时不得残留重试租约、错误或尝试次数，异常旧行会明确阻断升级而非被静默解释为到期注销。

升级前已经存在的 `status=deleted` 旧账号属于待完成的半成品，而不是完成墓碑。迁移先永久占用其旧用户名，立即撤销 Account、Session、精确 Verification、发往旧邮箱的投递以及由旧账号作为通知 actor 生成的待发邮件，再将计划时间强制设为迁移时刻，使其当前即到期；公开资料解析在 `deletion_finalized_at` 写入前保持不可见。该过渡状态不能恢复为 active，也不能修改身份和私人事实，只允许 Worker 更新领取/失败租约并向最终墓碑状态前进。这样旧状态不会继续登录、收信或永久跳过扫描。

旧镜像认识 `status=deleted`，但不执行新字段和存储回收。迁移后短时回退不会让已最终化账号恢复登录，但会停止新到期任务和失败重试，因此回退期间必须暂停注销承诺并尽快恢复当前 Worker。若要撤销迁移，只能恢复迁移前 PostgreSQL 与附件备份，不能删除列后继续声称已完成最终注销。

## 关联文档

- [ADR-0008：Better Auth](./0008-better-auth.md)
- [ADR-0009：公开用户标识与头像存储](./0009-public-user-identity-and-avatar-storage.md)
- [ADR-0010：回复、Markdown 与附件管线](./0010-replies-markdown-attachment-pipeline.md)
- [ADR-0012：通知、邮件与 Worker 运维](./0012-notifications-mail-worker-operations.md)
- [ADR-0013：治理、角色、制裁与信任等级](./0013-governance-roles-trust.md)
- [ADR-0015：生产打包、安装与恢复](./0015-production-packaging-setup-and-recovery.md)
