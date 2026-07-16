# Deployment Assets

根目录 `compose.yml`、`.env.example`、`nextbufctl` 和生产 `Dockerfile` 是 `v0.12.0` 正式单机部署合同；默认运行 Web、Worker、PostgreSQL、Redis 四个常驻服务，setup 为一次性任务。

`compose/compose.dev.yml` 和 `compose/compose.test.yml` 只用于本地开发与隔离集成测试，固定 PostgreSQL 18、Redis 8 与测试 Mailpit 基线。

开发/测试 Compose 不包含 Web、Worker、生产密码、备份或升级流程，不得直接用于公网部署。
