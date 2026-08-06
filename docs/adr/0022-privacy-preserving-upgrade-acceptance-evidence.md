# ADR-0022：隐私保护的升级验收证据与停写比较

- 状态：Accepted
- 日期：2026-08-03
- 适用版本：`v1.0.0` 及之后的受控升级
- 关联：ADR-0015、ADR-0020、ADR-0021

## 背景

NextBuf 已有真实公开 Beta 用户。合成升级夹具可以证明已知迁移路径，却不能单独证明真实实例中的 UID、Better Auth 密码凭据和 Session、主题编号、楼层、修订、草稿、附件引用、互动与治理事实全部保留。直接把生产 SQL、备份或逐用户清单放进发布证据又会泄漏邮箱、用户名、UUID、正文、密码哈希、Token、对象键和治理详情。

人工在升级前后抄表还存在三个缺陷：查询不一定来自同一数据库快照；Worker 或真实请求可能在两次查询间产生合法变化；迁移明确允许的账号注销、Outbox 和邮件状态变换容易被笼统解释为“预期差异”，从而掩盖无关数据损坏。

## 决策

### 1. 生产只提供来源，破坏性验收在隔离副本执行

生产实例只在计划维护窗口生成完整备份、运行健康检查和必要的只读采集。生产备份恢复副本负责恢复、升级和真实既有事实核对；删卷、Redis 清空、故障注入、邮件重放和账号最终注销测试只在另一个合成覆盖副本执行。全新安装、生产恢复和合成覆盖使用独立工作目录；共享 Docker daemon 时必须持续设置三个不同的 `COMPOSE_PROJECT_NAME` 并证明 Compose 项目、命名卷和网络标签不重叠，固定容器名的宝塔验收使用独立 daemon。原始备份、配置、数据库输出、邮件和浏览器状态保存在加密受限位置，不提交仓库或公开 Release。

生产使用官方宝塔单文件入口时，完整备份必须由 `nextbufctl backup --baota <实际部署编排>` 生成：来源编排与运行环境、容器/卷身份必须一致，实际 SemVer、commit、image config ID 和 RepoDigest 原样进入受限身份记录，PostgreSQL 与 local 附件在同一停写窗口导出。恢复到生产副本使用 `--empty-install --restore-config --keep-stopped`；在 Web/Worker 启动前把 APP_URL、SMTP、OAuth、代理和存储写入切换到隔离资源，同时保留验收 HMAC、Session 与加密载荷所需密钥。S3 来源还必须绑定同一维护窗口的 Provider 快照/版本，数据库对象键本身不构成媒体备份。

### 2. 目标镜像生成只读快照

同一目标候选镜像在迁移前后执行 `nextbuf acceptance snapshot`。采集器使用 PostgreSQL `REPEATABLE READ READ ONLY` 事务和目标 Schema 的安全 `search_path`，并以流式、确定顺序读取规范 JSONB 行；它不写数据库、不调用会创建探针对象的 Provider 检查，也不依赖 Redis。

目标镜像的采集 SQL只能读取来源与目标版本共有的字段。新增列通过 `to_jsonb` 排除和 `information_schema` 能力检测处理，因此 `v1.0.0` 镜像可以在尚未执行三条候选迁移的 `v0.13.10` 数据库上形成升级前证据。未来若改变直接升级基线、表结构或迁移变换，必须在同一变更中更新采集合同、比较器、真实服务测试和运行手册。

### 3. 输出使用域隔离 HMAC，不输出事实原文

采集器从实例 `AUTH_SECRET` 派生只用于验收的 HMAC-SHA-256 根密钥，再按 Schema、表、分组、附件和 key-id 分域。每个表摘要覆盖规范行的长度前缀序列；分组和总摘要覆盖表名、行数与子摘要。`AUTH_SECRET` 和派生密钥不进入输出。相同实例配置可以比较升级前后；密钥变化会形成明确失败，而不是把所有数据误报为普通差异。

JSON 仅包含：应用版本/commit、迁移名称与公开 checksum、Schema/key HMAC、表/分组行数和摘要、完整性违规计数、管理员连续性数量、脱敏运行积压计数，以及可选附件校验汇总。它不得包含邮箱、用户名、UID/UUID、正文、草稿、文件名、对象键、IP/User-Agent、Cookie/Session/Token、密码/OAuth 哈希、验证码/密文、举报详情、审计 metadata 或通知 snapshot。

证据 JSON 使用固定、严格的字段合同：capability、稳定表、分组、完整性检查和运行计数的名称集合必须完整，任何缺失、额外字段或未知嵌套字段都拒绝比较。迁移会条件性修改的邮件、通知、Outbox 和 Worker failure 字段不得整列忽略；迁移前查询按冻结 SQL 的精确条件投影成迁移后预期值，迁移后查询读取实际值，只有二者一致且后置完整性检查通过才允许启动写进程。

快照仍会泄漏实例规模并允许持有同一密钥的证据跨时间关联，因此文件权限固定为 600，只放在受限验收目录并配套 SHA-256，不作为公开 Release 资产。

### 4. 稳定事实、迁移变换和运行态分开

严格相等的稳定指纹覆盖：

- 非墓碑用户身份、Profile、有效用户名别名；墓碑比较身份与公开锚点，同时把注销调度字段单独归入允许变换；
- 非墓碑 Better Auth Account、Session、Verification、邀请和管理员二次验证事实；
- Node、Topic、Post、稳定 position、Revision、Draft、编辑会话、Mention、Attachment 元数据及 current/revision/draft 三类引用；
- 点赞、收藏、用户/主题关注、阅读状态和接受的浏览桶；
- 通知事实与偏好、角色、案件、举报、动作、制裁、治理审计和信任历史；
- 站点设置、身份审计、静态安装状态、Outbox/邮件/失败任务中不由候选迁移改变的结构字段、ProcessedJob 和周期任务。

`v0.13.10 -> v1.0.0` 的允许变换不进入通用忽略列表，而由稳定指纹和独立后置校验共同证明：旧 `deleted` 用户的注销调度与认证隔离；`OutboxEvent.processed_at` 对历史 `ProcessedJob.completed_at` 的精确回填；邮件 attempt token/generation、`sending -> outcome_unknown` 和失败投递关联。精确迁移值由 before 投影与 after 实值比较，长期完整性检查只要求 Outbox/ProcessedJob 完成状态成对、`attempt_generation >= attempts`、token 存在且无遗留 `sending`；因此正常 Worker 完成时间和邮件重放不会被误报为损坏。任何其他稳定表增删改均失败。

Worker 心跳、积压、发送状态等运行态只报告计数，不作为停写比较之外的长期相等门槛。Topic 首帖、next position、回复数、修订序列、点赞/收藏派生计数、索引 ready/valid、约束 validated 和管理员连续性始终独立检查，避免两个同样损坏的快照因摘要相等而通过。

### 5. `nextbufctl upgrade` 在启动写进程前强制比较

受控升级顺序为：验证目标镜像、创建一致性备份并停止 Web/Worker、用目标镜像采集 before、设置目标版本并运行 setup/迁移、在 Web/Worker 尚未启动时采集 after、比较、再启动并等待健康。快照、比较报告和 SHA-256 与升级日志放在 `backups/`。

正式 SemVer 尚未发布时，目标镜像仍须经过正常 pull 获得。验收主机把当前基线与已记录候选的完整 OCI index 从源 Digest 复制到只绑定 loopback 的临时 Registry，验证复制前后 Digest 后再把受控 Compose 指向该 Registry；只创建本地 tag、忽略 pull 失败或从源码重建都不能绑定已演练候选。临时 Registry 保留到升级、恢复和证据重采集结束，具体命令见[运行手册](../13-installation-operations-runbook.md#未公开-semver-候选的隔离-registry)。

比较要求：同一候选版本/commit和 HMAC key；来源迁移是目标迁移的 checksum 精确前缀；目标迁移等于目标镜像冻结清单；目标 Schema 能力与后置检查全部通过；所有适用完整性检查为零；稳定表和总摘要相同；管理员至少有一位可接管。只有一位管理员时升级可以完成但报告明确警告，正式 Release 验收仍要求配置第二位管理员。项目所有者可以对某个明确版本书面接受单管理员发布风险，但豁免必须绑定版本、日期和原话，不能隐藏警告、自动延伸到下一版本或绕过 0 位硬阻断；`v1.0.0` 的 2026-08-06 豁免只证明该版本。

迁移或比较失败后，目标版本配置保留、Web/Worker 保持停止，运维必须诊断或从升级前备份恢复；比较器不会自动用旧代码读取新 Schema。迁移前快照失败且尚未改写版本/Schema时，工具恢复原先运行的 Web/Worker。为区分 Docker/Compose 在创建容器前失败与目标 setup 已真正开始，`nextbufctl` 在权限 700 的证据根目录内创建只允许容器写入/进入但不能列目录的短期 scratch，并且只把该目录挂载给一次性 setup；目标镜像入口在调用迁移 CLI 前写入固定路径标记。标记出现前的失败恢复原版本配置和原运行状态，标记出现后的失败保持停机，结束后删除 scratch；任意环境变量不能把标记重定向到其他容器路径。

`--verify-objects` 额外逐个读取数据库引用的 local/S3 原始附件并核对 SHA-256，同时确认派生对象存在并比较内容摘要。它会延长停写窗口，正式真实数据副本验收必须启用，普通升级可只执行数据库不变量门槛。

GitHub Actions 对每个 `main` 候选在 amd64 从当前公开基线执行一次带 `--verify-objects` 的合成数据升级，门槛通过后才允许更新 `edge` 与不可变 `sha-*`。定时、手动和正式标签在此基础上重跑升级，并额外执行空卷恢复与依赖故障注入；合成门槛不替代生产备份恢复出的隔离副本人工验收。

## 后果

- 真实 Beta 升级形成可复核但不含会员原文的机器证据，人工浏览器仍负责登录、现有 Session、Cookie、Provider、页面和权限行为。
- 升级增加只读扫描时间和少量受限证据文件；大实例必须先在隔离副本测量停写窗口。
- `AUTH_SECRET` 连续性成为比较密钥连续性的一部分，错误轮换会在迁移启动前后明确暴露。
- HMAC 摘要证明同一密钥下事实相等，不证明备份保管、真实邮件送达、S3 Bucket 版本控制或浏览器行为；这些门槛继续单独验收。

## 回退

删除采集器不会回滚数据库，但会失去升级前后自动不变量门槛。若工具本身出现误判，应保留 before/after、日志和升级前备份，在修复版本中重跑隔离演练；不得编辑 JSON 或跳过比较后把原候选宣布为正式版。

## 关联文档

- [安装与运维运行手册](../13-installation-operations-runbook.md)
- [`v1.0.0` 发布就绪门槛](../19-v1.0.0-release-readiness.md)
- [`v1.0.0` 人工验收模板](../21-v1.0.0-manual-acceptance.md)
- [`v1.0.1` 发布就绪与验收清单](../24-v1.0.1-release-readiness.md)
