# Deployment Assets

根目录 `compose.yml`、`.env.example`、`nextbufctl` 和生产 `Dockerfile` 是已发布 `v0.13.10` 最终 Beta 的受控单机部署合同；`compose.baota.yml` 是无需 `.env` 的单实例面板入口，并固定显示为 `nextbuf`、`nextbuf-worker`、`nextbuf-postgres`、`nextbuf-redis`。两者默认只创建 Web、Worker、PostgreSQL、Redis 四个常驻容器。Web 启动前幂等执行 setup/preflight，显式 setup 服务位于工具 profile，不会在面板留下停止记录。空安装不创建业务节点，访问根地址会进入首次安装页，首位用户的 UID 从 1 开始。`v0.13.10` 不新增迁移或重写业务数据，发布流水线已通过精确 `v0.13.8 -> v0.13.10` 升级门槛；生产升级仍须先创建可验证备份。

当前源码版本为尚未发布的 `v1.0.0` 稳定化候选，新增最终账号注销迁移、管理员连续性诊断和稳定发布通道合同。源码中的 `NEXTBUF_VERSION=1.0.0`、候选迁移清单或 `edge` 镜像都不表示正式版已经发布；在主线 CI、真实 `v0.13.10 -> v1.0.0` 升级/恢复、双架构镜像、正式 Release 资产和人工验收完成前，生产基线仍是精确 `v0.13.10`。`main` 只更新 `edge` 与不可变 `sha-*`，完整稳定 Release 成功后才提升 `latest`。

`compose/compose.dev.yml` 和 `compose/compose.test.yml` 只用于本地开发与隔离集成测试，固定 PostgreSQL 18、Redis 8 与测试 Mailpit 基线。

开发/测试 Compose 不包含 Web、Worker、生产密码、备份或升级流程，不得直接用于公网部署。
