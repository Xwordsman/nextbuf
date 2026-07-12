# Deployment Assets

`compose/compose.dev.yml` 和 `compose/compose.test.yml` 只用于本地开发与隔离集成测试，当前已经固定 PostgreSQL 18 与 Redis 8 基线。

生产 Docker Compose、应用镜像、systemd、Nginx 和安装脚本将在 `v0.12.0` 按 `docs/13-installation-operations-runbook.md` 实现。

开发/测试 Compose 不包含 Web、Worker、生产密码、备份或升级流程，不得直接用于公网部署。
