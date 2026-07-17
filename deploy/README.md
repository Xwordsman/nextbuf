# Deployment Assets

根目录 `compose.yml`、`.env.example`、`nextbufctl` 和生产 `Dockerfile` 是 `v0.13.2` 公开 Beta 受控单机部署合同；`compose.baota.yml` 是无需 `.env` 的面板单文件入口。两者默认只创建 Web、Worker、PostgreSQL、Redis 四个常驻容器。Web 启动前幂等执行 setup/preflight，显式 setup 服务位于工具 profile，不会在面板留下停止记录。空安装不创建业务节点，访问根地址会进入首次安装页。

`compose/compose.dev.yml` 和 `compose/compose.test.yml` 只用于本地开发与隔离集成测试，固定 PostgreSQL 18、Redis 8 与测试 Mailpit 基线。

开发/测试 Compose 不包含 Web、Worker、生产密码、备份或升级流程，不得直接用于公网部署。
