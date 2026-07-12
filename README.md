# NextBuf

NextBuf 是一个面向 AI、建站、主机、域名及相关技术话题的开源综合社区。

当前版本为 `v0.2.0` 运行时基础：已经接入 PostgreSQL 18、Prisma 7、Redis 8、BullMQ、Outbox、独立 Worker 和运行诊断。注册、用户资料、主题、回复、通知、治理和管理后台仍将按照版本计划逐步实现。

## 技术基线

- Next.js 16.2.10、React 19、TypeScript 严格模式
- Node.js 24 LTS、pnpm 11
- App Router 与统一 `src/` 结构
- PostgreSQL 18、Prisma 7、Redis 8、BullMQ
- 一个应用镜像，Web 与 Worker 分开运行
- 事务性 Outbox、数据库内幂等任务和 Web/Worker 健康检查

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

`pnpm dev` 同时启动 Web 和 Worker；也可以分别运行 `pnpm dev:web` 与 `pnpm dev:worker`。开发 Compose 只提供 PostgreSQL/Redis，不是生产部署文件。

## 质量检查

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

真实 PostgreSQL/Redis 集成测试使用独立测试 Compose，步骤见 [本地开发手册](./docs/11-local-development.md)。

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
