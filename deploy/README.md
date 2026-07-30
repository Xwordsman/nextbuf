# Deployment Assets

根目录 `compose.yml`、`.env.example`、`nextbufctl` 和生产 `Dockerfile` 是已发布 `v0.13.10` 最终 Beta 的受控单机部署合同；`compose.baota.yml` 是无需 `.env` 的单实例面板入口，并固定显示为 `nextbuf`、`nextbuf-worker`、`nextbuf-postgres`、`nextbuf-redis`。两者默认只创建 Web、Worker、PostgreSQL、Redis 四个常驻容器。Web 启动前幂等执行 setup/preflight，显式 setup 服务位于工具 profile，不会在面板留下停止记录。空安装不创建业务节点，访问根地址会进入首次安装页，首位用户的 UID 从 1 开始。`v0.13.10` 不新增迁移或重写业务数据，发布流水线已通过精确 `v0.13.8 -> v0.13.10` 升级门槛；生产升级仍须先创建可验证备份。

`compose/compose.dev.yml` 和 `compose/compose.test.yml` 只用于本地开发与隔离集成测试，固定 PostgreSQL 18、Redis 8 与测试 Mailpit 基线。

开发/测试 Compose 不包含 Web、Worker、生产密码、备份或升级流程，不得直接用于公网部署。
