# 项目现状与交接

本文是每次开始开发、交接给其他开发者或交给 AI 前首先阅读的状态入口。它只记录当前有效状态，不重复所有设计细节。

- 最后更新：2026-07-12
- 当前阶段：`v0.1.0` 工程骨架已完成
- 当前开发版本：准备开始 `v0.2.0`
- 当前工作名称：NextBuf
- 当前可运行内容：Next.js 骨架首页、liveness、版本接口；`UI/index.html` 仍是后续页面视觉原型

## 1. 现在已经有什么

- 首页三栏静态稿和已确认的主要视觉信息层级。
- 产品范围、系统架构、领域模型和安全原则。
- 默认四容器部署决策：Web、Worker、PostgreSQL、Redis。
- `v0.1.0` 至 `v10.x` 的功能路线。
- 仓库结构、本地开发、配置和安装运维目标合同。
- PostgreSQL-only、模块化单体、单镜像双运行角色等 ADR。
- Next.js 16.2.10、pnpm、TypeScript、Tailwind 和 `src/app` 工程。
- 格式、lint、类型检查、Vitest、生产构建和 GitHub Actions CI。
- Zod 环境校验、结构化日志基础、AppError、request ID Proxy。
- AGPLv3、Section 7(b) NOTICE、DCO、贡献与安全政策。
- 首页、错误页、404、`/api/health/live` 和 `/api/version`。

## 2. 现在还没有什么

- 没有 Prisma Schema、数据库迁移和 Redis/BullMQ 代码。
- 没有 Dockerfile、可运行 Compose、镜像或镜像发布 Actions；基础 CI 已建立。
- 没有注册、登录、用户、主题、回复和管理后台实现。
- 没有可执行的 `nextbuf` CLI 或 `nextbufctl`。

因此文档中的开发和部署命令目前是必须实现的合同，不是当前执行结果。

## 3. 已确定且不得自行更改

1. Next.js 16.2.10、TypeScript、App Router、Node.js 24 LTS、pnpm。
2. PostgreSQL 18 是唯一官方数据库；Redis 8 + BullMQ。
3. 模块化单体，前台、后台、API 和 Worker 同仓库。
4. 所有应用源码进入 `src/`，使用 `src/app`，不拆 frontend/backend。
5. 一个应用镜像，默认四个常驻容器。
6. Web 与 Worker 分开运行，共享领域代码。
7. 管理角色、信任等级、专业声誉和交易信用分离。
8. V1 不执行任意第三方服务端插件。
9. 预览开发使用 `v0.x`，`v1.0.0` 才是首个稳定版。
10. V1 使用 Topic + 统一 Post，首帖是 position=1 的 Post。
11. V1 只做单一点赞，不做用户标签和私信。
12. 核心许可证采用 AGPL-3.0-only，并通过第 7(b) 条要求保留 `Powered by NextBuf` 页脚链接。
13. 官方仓库是 `https://github.com/Xwordsman/nextbuf`，外部贡献采用 DCO 1.1。
14. 每个完成阶段必须推送官方 `main` 并创建注释版本标签，远程 CI 通过后才形成回滚点。

若有证据需要改变，先更新决策台账并新增或替代 ADR，不能直接修改实现绕过文档。

## 4. 当前未决事项

不阻止私有的 `v0.1.0` 骨架开发：

- 正式产品名；当前代码和文档可以继续使用工作名 NextBuf。
- 最终镜像组织和域名。

后续版本阻断项：

- `v0.4.0` 前选择认证库和初始 OAuth。
- `v0.5.0` 前确定用户名修改规则。
- `v0.8.0` 前确定中文搜索实现和热门算法参数。
- `v0.11.0` 前确定管理员二次验证首发范围。
- `v0.13.0` 前确定内容协议与隐私政策。

完整列表见 [决策与待讨论事项](./08-decisions-and-open-questions.md)。

## 5. 下一步只做 v0.2.0

入口：[详细开发计划 v0.2.0](./09-detailed-development-plan.md#v020数据库缓存队列和运行角色)

执行顺序：

1. 在开始前验证 Prisma 对 PostgreSQL 18、Next.js 16 standalone 和 Worker 构建的兼容性，关闭 P-001。
2. 接入 PostgreSQL 18、Prisma Client 和初始迁移。
3. 接入 Redis 8、BullMQ 和 key 前缀约束。
4. 实现 Web、Worker、migrate、setup 和 doctor 入口。
5. 建立 Outbox 表、Dispatcher 骨架和幂等任务辅助。
6. 增加 `/health/ready` 和 Worker 健康状态。
7. 提供仅用于开发的 PostgreSQL/Redis Compose。
8. 建立真实 PostgreSQL/Redis 集成测试。
9. 按 v0.2.0 验收门槛验证并更新本文状态。

`v0.2.0` 不开发注册、用户资料、发帖、插件或交易。

## 6. v0.1.0 已交付

```text
package.json
pnpm-lock.yaml
next.config.*
tsconfig.json
src/app/
src/components/
src/modules/
src/infrastructure/
src/worker/
src/shared/
tests/
deploy/
.github/workflows/ci.yml
.env.example
LICENSE
NOTICE
```

验证结果：格式、ESLint、TypeScript、3 个 Vitest 测试和 Next.js 生产构建通过；首页、liveness、版本接口、request ID 和页脚署名已通过本地 HTTP 检查。

`v0.1.0` 已提交并推送官方仓库；版本标签和远程 CI 状态应在交付时再次核对。

## 7. 实现时的文档优先级

出现冲突时按以下顺序：

1. 已接受 ADR。
2. [决策台账](./08-decisions-and-open-questions.md)中最新的已确定决策。
3. [详细开发计划](./09-detailed-development-plan.md)中当前版本范围。
4. 对应专题文档：架构、领域、安全、仓库、配置、部署。
5. [高层路线图](./07-roadmap.md)。
6. `UI/index.html`，仅决定当前已确认的视觉表现，不决定后端规则。

若较高优先级文档明显过期，先修正文档，而不是继续制造新的不一致。

## 8. 禁止的捷径

- 不拆成独立 frontend/backend 工程。
- 不为兼容 MySQL 改写 PostgreSQL 设计。
- 不把 Worker 藏进 Web 容器后台 shell。
- 不让页面组件直接承担领域规则或 Prisma 写入。
- 不用 Redis 作为用户、主题、权限或交易事实来源。
- 不在 V1 提前实现任意服务端插件。
- 不把未来版本功能夹带进当前里程碑。
- 不提交真实 `.env`、密码、Token 或部署密钥。
- 不声称示意 Compose 或目标命令已经可运行。
- 不删除、隐藏、弱化或允许配置关闭 `Powered by NextBuf` 页脚链接。

## 9. 每次交接必须更新

完成一个版本或中断开发时更新本文件：

```text
最后更新：
当前版本：
已经完成：
正在进行：
验证结果：
已知问题：
未提交/未完成变更：
下一步：
新阻断项：
```

同时更新详细开发计划中的实际状态、决策台账和受影响专题文档。聊天记录不是项目状态的唯一来源。
