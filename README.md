# NextBuf

NextBuf 是一个面向 AI、建站、主机、域名及相关技术话题的开源综合社区。

当前候选版本为 `v0.13.8` 公开 Beta 补丁：在 `v0.13.7` 官方 shadcn/ui 全站界面基础上，修复主题/回复自动保存与发布竞态、响应丢失恢复和后台私人草稿边界；保留真实社区数据、搜索、分页、认证流程、既有三栏布局和无需 `.env` 的宝塔单文件 Compose。最后已发布版本仍为 `v0.13.7`，候选通过完整 CI 前不视为已发布。

## 技术基线

- Next.js 16.2.10、React 19、TypeScript 严格模式
- Node.js 24 LTS、pnpm 11
- App Router 与统一 `src/` 结构
- PostgreSQL 18、Prisma 7、Redis 8、BullMQ
- Better Auth、数据库会话、scrypt 凭证和可选 GitHub OAuth
- Mailpit 开发邮件箱、AES-256-GCM 邮件载荷和 SMTP Worker
- 本地/S3 对象存储边界，统一承载头像、原始附件和图片派生文件
- UUID 内部主键、数字主题编号、Topic + Post + Revision 社区模型
- GFM Markdown、安全允许列表、稳定回复楼层、引用、提及和附件引用跟踪
- 幂等点赞/收藏/关注、阅读状态、反滥用浏览聚合和热门算法 v1
- PostgreSQL FTS/`pg_trgm` 搜索与可替换 `SearchProvider`
- 一个应用镜像，Web 与 Worker 分开运行
- 生产 Dockerfile、面板友好的四容器 Compose、setup/preflight 门禁和 GHCR 多架构发布
- `nextbufctl` 初始化、状态、日志、诊断、备份、恢复与升级
- 事务性 Outbox、数据库内幂等任务和 Web/Worker 健康检查
- 结构化通知、普通邮件偏好、持久化失败任务、手工重放和分布式周期调度
- 举报案件、不可变处置审计、节点/全站禁言、暂停与封禁
- 可解释 TL0-TL4、版本化规则、降级宽限期和 UID 游标重算 Worker
- PostgreSQL 站点运营设置、后台分页筛选、Provider 脱敏诊断和受控审计导出
- 当前 Session 绑定的管理员二次验证、确认文本、修订冲突和批量操作保护
- Tailwind CSS、Radix UI 原语、Lucide 图标和可访问的响应式社区页面
- Playwright 桌面/平板/手机 E2E、截图和 axe 严重问题检查
- 每请求 nonce CSP、精确同源写入保护、递归日志脱敏和结构化上传校验
- 外键索引/迁移历史门槛、容量诊断、故障注入和 `v0.12.0 -> v0.13.0` 升级冒烟

## 开始开发

```powershell
corepack enable
pnpm install --frozen-lockfile
Copy-Item .env.example .env
docker compose -f deploy/compose/compose.dev.yml up -d
pnpm nextbuf setup
pnpm dev
```

Linux/macOS 将复制命令替换为：

```bash
cp .env.example .env
```

访问 <http://localhost:3000>。

`pnpm dev` 同时启动 Web 和 Worker；也可以分别运行 `pnpm dev:web` 与 `pnpm dev:worker`。开发 Compose 提供 PostgreSQL、Redis 和 Mailpit，Mailpit Web 界面位于 <http://localhost:8025>。它不是生产部署文件。

## Docker 部署

宝塔面板用户可以直接粘贴 [`compose.baota.yml`](./compose.baota.yml)，首次替换其中的域名、密码、应用密钥和 SMTP 配置后启动。该模板使用通过验证的 `main` `latest` 通道和 `nextbuf`、`nextbuf-worker`、`nextbuf-postgres`、`nextbuf-redis` 四个固定容器名；后续升级只需在面板拉取新镜像并重建，不再编辑版本号。

需要 `nextbufctl` 精确升级、备份和恢复的用户使用正式 Release：

正式 Release 解压后执行：

```bash
chmod +x nextbufctl
./nextbufctl init
# 编辑 .env 中的 APP_URL、SMTP 与存储配置
./nextbufctl start
```

首次启动后直接访问配置的 `APP_URL`，未安装站点会自动跳转到 `/setup`。使用 `.env` 或宝塔编排中仅部署者可见的 `SETUP_TOKEN` 创建首位管理员，登录后在 `/admin/nodes` 创建适合当前社区的节点；发行版不内置特定社区分类。完整宝塔、反向代理、备份恢复与升级步骤见 [安装与运维运行手册](./docs/13-installation-operations-runbook.md)。

## 质量检查

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

`pnpm test:e2e` 同时运行已构建的 Next.js standalone Web 与 Worker。真实 PostgreSQL、Redis、SMTP/Mailpit 集成测试使用独立测试 Compose，完整步骤见 [本地开发手册](./docs/11-local-development.md)。

## 文档

第一次参与项目时先阅读：

1. [项目现状与交接](./docs/14-project-status-handoff.md)
2. [产品定位与范围](./docs/01-product-scope.md)
3. [系统架构](./docs/02-system-architecture.md)
4. [仓库结构与模块边界](./docs/10-repository-structure.md)
5. [详细开发计划](./docs/09-detailed-development-plan.md)

完整索引见 [docs/README.md](./docs/README.md)。

## 贡献

项目使用 Developer Certificate of Origin（DCO）。提交贡献前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)，并使用 `git commit -s` 添加 `Signed-off-by`。

## 许可证

NextBuf 核心采用 GNU AGPLv3 only，并依据第 7(b) 条增加页面署名要求。所有提供 Web 界面的原始版本和修改版本都必须在页面底部保留：

> Powered by [NextBuf](https://github.com/Xwordsman/nextbuf)

允许自用、修改、商业运营和收费部署，但必须遵守 [LICENSE](./LICENSE) 与 [NOTICE](./NOTICE)。页脚链接不能被删除、隐藏、替换或通过配置关闭。
