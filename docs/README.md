# NextBuf 开发文档

本目录是 NextBuf 的产品、架构和工程基线。它用于回答三个问题：我们要做什么、为什么这样设计、开发和发布时必须遵守什么。

> 当前阶段：`v0.9.0` 通知、邮件和 Worker 完整链路已完成，下一阶段为 `v0.10.0` 举报、治理、角色和信任等级。`UI/index.html` 仅是历史视觉参考，运行页面以 `src/app` 和 `src/components` 为准。

## 项目定位

NextBuf 是一个面向 AI、建站、主机、域名及相关技术话题的开源综合社区。产品体验参考 V2EX 的高信息密度排版和 Discourse 的社区治理经验，但不复刻任何项目的页面或实现。

核心目标：

- 前台、管理后台和 API 在同一个 Next.js 工程中开发和发布。
- 首版保持可控，架构上允许后续增加交易、开放 API、插件和多节点能力。
- Docker 用户可以在宝塔面板或命令行中一键启动完整依赖。
- 非 Docker 用户可以通过发布包配合 systemd 或 PM2 部署。
- 权限、信任等级、专业声誉和交易信用相互独立，避免一个分数控制全部能力。

## 文档导航

| 文档 | 内容 | 主要读者 |
| --- | --- | --- |
| [00-reference-projects.md](./00-reference-projects.md) | new-api、sub2api、Rhex、Discourse 的实现与部署启示 | 架构、维护者 |
| [01-product-scope.md](./01-product-scope.md) | 产品定位、用户、V1 范围和非目标 | 产品、设计、开发 |
| [02-system-architecture.md](./02-system-architecture.md) | 技术栈、模块边界、运行时和扩展原则 | 开发、架构、运维 |
| [03-domain-model.md](./03-domain-model.md) | 用户、节点、主题、回复、通知和治理数据模型 | 后端、前端 |
| [04-identity-trust-security.md](./04-identity-trust-security.md) | 登录、授权、信任等级、安全和审计 | 后端、安全、运营 |
| [05-deployment-operations.md](./05-deployment-operations.md) | 镜像、四容器拓扑、宝塔、非 Docker、备份升级 | 运维、发布 |
| [06-development-guide.md](./06-development-guide.md) | 目录、编码边界、测试、数据库和 CI 约束 | 开发、贡献者 |
| [07-roadmap.md](./07-roadmap.md) | 主要阶段目标和升级原则 | 全体参与者 |
| [08-decisions-and-open-questions.md](./08-decisions-and-open-questions.md) | 已确定决策、暂定项和仍需讨论的问题 | 维护者 |
| [09-detailed-development-plan.md](./09-detailed-development-plan.md) | 从项目骨架到 V10 的功能版本开发顺序和验收门槛 | 产品、开发、测试、发布 |
| [10-repository-structure.md](./10-repository-structure.md) | `src` 目录、模块责任、导入与前后端边界 | 开发、架构 |
| [11-local-development.md](./11-local-development.md) | 本地依赖、命令、数据库和测试工作流 | 开发、贡献者 |
| [12-configuration-reference.md](./12-configuration-reference.md) | 环境变量名称、类型、默认值和秘密边界 | 开发、部署、运维 |
| [13-installation-operations-runbook.md](./13-installation-operations-runbook.md) | Docker、宝塔、非 Docker、升级、备份与恢复步骤 | 部署、运维 |
| [14-project-status-handoff.md](./14-project-status-handoff.md) | 当前状态、下一步、阻断项和交接规则 | 所有参与者、AI |
| [15-license-attribution-policy.md](./15-license-attribution-policy.md) | AGPLv3、页脚署名、商标和贡献许可规则 | 所有参与者、部署者 |
| [adr/](./adr/) | 关键架构决策的背景、取舍和后果 | 架构、维护者 |

## 推荐阅读顺序

第一次参与项目时按以下顺序阅读：

1. [项目现状与交接](./14-project-status-handoff.md)：确认现在做到哪里、下一步做什么。
2. [产品定位与范围](./01-product-scope.md)：确认 V1 做什么和不做什么。
3. [系统架构](./02-system-architecture.md)与[仓库结构](./10-repository-structure.md)：确认如何组织代码。
4. [详细开发计划](./09-detailed-development-plan.md)：只实现当前版本范围。
5. 开发前阅读[本地开发手册](./11-local-development.md)，部署前阅读[配置参考](./12-configuration-reference.md)和[运行手册](./13-installation-operations-runbook.md)。

当前已有可运行的 Next.js Web、Worker、CLI、开发/测试 Compose、身份认证、账号资料、真实节点/主题/回复、Markdown、本地/S3 附件、互动、浏览聚合、热门排序、PostgreSQL 搜索、通知/偏好/普通邮件及 Worker 恢复链路，但仍没有生产 Dockerfile、生产 Compose 或正式发布包。文档中标注为未来合同的命令必须在对应版本实现后才能使用。

## 决策状态

文档中的技术或产品事项必须属于以下一种状态：

- **已确定**：开发默认遵守。变更时需要记录原因和迁移影响。
- **暂定**：当前推荐方案，可以在进入对应开发阶段前调整。
- **待决定**：不能据此实现不可逆的数据结构或公开接口。

若不同文档发生冲突，以 [08-decisions-and-open-questions.md](./08-decisions-and-open-questions.md) 中较新的记录为准，并同步修正文档正文。

更完整的优先级：已接受 ADR和决策台账 > 当前详细开发计划 > 专题规范/运行手册 > 高层路线图 > UI 静态稿。发现冲突时不能自行挑选方便的版本，应先修正文档或记录新决策。

## 术语

- **Web**：Next.js 页面、管理后台、Route Handlers 和服务端渲染进程。
- **Worker**：消费异步队列，执行邮件、通知、内容处理和周期任务的进程。
- **节点（Node）**：主题的主要分类。每个主题在 V1 只属于一个节点。
- **主题（Topic）**：用户发起的讨论；界面中也可以称为“帖子”。
- **信任等级（TL）**：由社区参与行为获得的使用能力，不等于管理角色。
- **Provider**：对存储、邮件、搜索等外部能力的内部适配接口。
- **Addon/插件**：在明确扩展协议下安装的功能包；V1 不执行第三方服务端代码。

## 文档维护规则

1. 影响公开 API、数据库、权限或部署方式的变更，必须先更新文档或在同一个合并请求中更新。
2. 版本号、镜像标签和依赖要求应写出精确值或明确的兼容范围，避免“最新版”长期失真。
3. 示例配置不得包含真实密钥、真实域名和个人信息。
4. 已实现行为与规划不一致时，应标记差异，不能让规划文档冒充当前实现。
5. 每个正式版本发布前检查文档链接、环境变量、升级步骤和备份恢复流程。
