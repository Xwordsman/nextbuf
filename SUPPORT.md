# NextBuf Support Policy

本文说明 NextBuf 官方维护范围、版本生命周期和获取帮助的方式。安全问题使用 [SECURITY.md](./SECURITY.md) 的私密渠道，不进入公开 Issue。

## 当前状态

`v1.0.1` 是当前完整稳定补丁，处于 Active 支持状态；同一 minor 的 `v1.0.0` 已由它替代。`v1.0.2` 正在按补丁范围进行不改变公开行为的性能优化。`v0.13.10` 是最后一个完整 Beta，只保留到 `v1.0.0` 的历史升级路径，不再单独获得一般缺陷修复。

## 稳定版本生命周期

从 `v1.0.0` 起，版本按以下状态维护：

| 状态        | 范围                                                     | 维护内容                               |
| ----------- | -------------------------------------------------------- | -------------------------------------- |
| Active      | 最新稳定 minor 的最新 patch                              | 回归、数据正确性、安全和严重可用性修复 |
| Security    | 前一个稳定 minor 的最新 patch，自下一 minor 发布起 90 天 | 高/严重安全问题和必要升级阻断修复      |
| End of life | 更旧 minor、已被新 patch 替代的同 minor 版本             | 不再单独发补丁，必须先升级             |

例如，`v1.0.x` 在 `v1.1.0` 发布前处于 Active；`v1.1.0` 发布后，`v1.0` 的最后一个补丁进入 90 天 Security 窗口。每个 minor 只支持其最新 patch，修复不会回移到该 minor 的所有旧补丁。

重大版本的支持窗口将在该重大版本发布说明中定义；本政策不预先承诺 LTS。紧急修复可以缩短升级建议时间，但不能静默改变数据库回退边界。

## 预发布与镜像通道

- 精确 `MAJOR.MINOR.PATCH` 和对应 Digest 是支持请求的正式产物身份。
- `latest` 指向最新完整稳定补丁；它是便利入口，不是可复现身份。
- `edge` 和 `sha-*` 用于主线验证，不属于稳定支持版本。
- `v0.x`、alpha、beta、RC、源码工作区和第三方改包属于预发布或自维护范围。
- `ci-*` 是可回收的内部候选标签，不能用于部署。

通道的发布顺序和不可变规则见 [ADR-0020](./docs/adr/0020-stable-release-channels-and-lifecycle.md)。

## 官方支持边界

问题必须能在对应 Release 文档声明的官方组合中复现。V1 正式支持：

- 官方 GHCR 镜像的 Linux amd64/arm64 Docker Compose 部署；
- 官方 Linux x64 standalone 归档；
- PostgreSQL 18、Redis 8、Node.js 24 及配置参考中列出的 Provider 合同；
- 官方 `compose.yml`、`compose.baota.yml`、`nextbufctl` 和发布归档中的服务模板；
- 未删除 `Powered by NextBuf`、未改写迁移历史且未直接修改数据库事实的实例。

面板、反向代理、SMTP、S3 和托管数据库厂商本身由各自提供方维护。NextBuf 会处理符合公开 Provider 合同的兼容问题，但不承担第三方账号、网络策略、配额、计费、数据保留或服务可用性。私有分支、第三方插件、非官方镜像、手工改表和超出文档矩阵的基础服务需要由部署者自行复现和维护。

## 获取帮助

- 可复现缺陷和文档错误：提交 GitHub Issue。
- 使用方法与方案讨论：使用仓库 Discussions；若未启用，提交明确标注为 question 的 Issue。
- 安全漏洞：使用 GitHub Private vulnerability reporting，见 [SECURITY.md](./SECURITY.md)。

公开报告应包含：

1. 精确版本、完整 commit（如适用）和镜像 Digest。
2. 部署入口、CPU 架构、PostgreSQL/Redis 版本和存储类型。
3. 最小复现步骤、预期结果、实际结果和时间范围。
4. 已脱敏的 Web/Worker 日志、`nextbuf doctor` 输出和相关 request/job ID。
5. 最近升级、迁移、配置或基础设施变更。

不要上传 `.env`、Cookie、Token、密码、完整数据库、邮件正文、对象存储密钥、真实用户数据或未修复漏洞细节。维护者可能先要求在最新受支持 patch 上复现。

## 响应方式

NextBuf 是社区维护的开源项目，不提供可用性或修复时限 SLA。维护者按安全影响、数据损坏、升级阻断和可复现性排序；功能请求不属于补丁支持承诺。商业托管或定制支持需由提供该服务的一方另行约定，不能冒充本项目的官方 SLA。
