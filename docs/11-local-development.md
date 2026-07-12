# 本地开发手册

本文定义 NextBuf 开发环境必须提供的命令和工作流。当前仓库尚未初始化应用代码，因此命令是 `v0.1.0`/`v0.2.0` 必须实现并持续维护的开发合同；在对应版本完成前，不应声称这些命令已经可运行。

## 1. 前置条件

开发机需要：

| 工具 | 版本 | 用途 |
| --- | --- | --- |
| Node.js | 24 LTS | Next.js、Worker、脚本 |
| pnpm | 通过 Corepack 固定仓库版本 | 包管理 |
| Docker Engine/Desktop | 支持 Compose v2 | 本地 PostgreSQL、Redis、邮件测试服务 |
| Git | 当前稳定版 | 版本控制 |

可选工具：

- PostgreSQL 客户端，用于只读诊断。
- Redis CLI，用于队列和缓存诊断。
- VS Code 及 ESLint、Prettier、Playwright 扩展。

仓库完成初始化后，`package.json` 的 `packageManager` 字段必须锁定 pnpm 版本，开发者不应全局安装任意版本覆盖 Corepack。

## 2. 首次初始化流程

目标命令：

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
docker compose -f deploy/compose/compose.dev.yml up -d postgres redis mailpit
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

Windows PowerShell 将复制命令替换为：

```powershell
Copy-Item .env.example .env
```

规则：

- `.env.example` 可以提交，只放占位值和开发默认值。
- `.env`、`.env.local` 和真实密钥禁止提交。
- 开发 Compose 只启动依赖；Web 和 Worker 默认在宿主机运行，便于热更新和调试。
- `db:seed` 只创建明确的开发基础数据，重复执行必须幂等。
- 测试数据和生产种子数据分开，生产 setup 不创建演示主题。

## 3. 启动开发服务

推荐两个独立终端：

```bash
pnpm dev:web
pnpm dev:worker
```

也可以提供便捷命令：

```bash
pnpm dev
```

`pnpm dev` 可以并行启动 Web 与 Worker，但只用于开发。生产环境必须由 Docker、systemd 或 PM2 分别监督两个进程。

默认地址：

| 服务 | 地址 | 说明 |
| --- | --- | --- |
| Web | `http://localhost:3000` | Next.js 应用 |
| Mailpit UI | `http://localhost:8025` | 查看开发邮件 |
| PostgreSQL | `localhost:5432` | 仅开发机回环地址 |
| Redis | `localhost:6379` | 仅开发机回环地址 |

端口冲突时通过 `.env` 或开发 Compose override 修改，不应直接改已提交的默认文件。

## 4. 必须提供的 package scripts

### 开发和构建

| 命令 | 行为 |
| --- | --- |
| `pnpm dev` | 开发模式同时启动 Web 和 Worker |
| `pnpm dev:web` | 启动 Next.js 热更新服务 |
| `pnpm dev:worker` | 监听 Worker 源码并重启 Worker |
| `pnpm build` | 构建 Web、Worker 和 CLI |
| `pnpm build:web` | 构建 Next.js standalone 产物 |
| `pnpm build:worker` | 将 Worker 编译到生产输出目录 |
| `pnpm start:web` | 运行已构建 Web |
| `pnpm start:worker` | 运行已构建 Worker |

### 数据库

| 命令 | 行为 |
| --- | --- |
| `pnpm db:generate` | 生成 Prisma Client |
| `pnpm db:migrate` | 创建/执行开发迁移 |
| `pnpm db:deploy` | 只执行已有生产迁移 |
| `pnpm db:seed` | 幂等写入开发基础数据 |
| `pnpm db:studio` | 启动 Prisma Studio，仅本地诊断 |
| `pnpm db:check` | 检查迁移历史和 Schema 漂移 |

生产容器不得运行会创建新迁移的 `db:migrate` 开发命令，只运行 `db:deploy` 或封装后的 `nextbuf migrate`。

### 质量和测试

| 命令 | 行为 |
| --- | --- |
| `pnpm format` | 格式化源代码和受支持文档 |
| `pnpm format:check` | 检查格式，不写文件 |
| `pnpm lint` | ESLint 和导入边界检查 |
| `pnpm typecheck` | TypeScript 严格检查 |
| `pnpm test` | 单元测试 |
| `pnpm test:integration` | 使用真实 PostgreSQL/Redis 的集成测试 |
| `pnpm test:e2e` | Playwright 端到端测试 |
| `pnpm test:all` | CI 级完整检查 |

## 5. 环境文件

建议：

```text
.env.example       已提交，全部配置说明和安全占位符
.env               本地共享默认值，不提交
.env.test           测试默认值，不包含真实秘密
.env.local          开发者个人覆盖，不提交
```

Next.js 对环境文件有自己的加载规则，但 Worker 和 CLI 也必须使用同一个经过 Zod 校验的配置模块，不能分别解析出不同结果。

只有明确允许进入浏览器的变量才使用 `NEXT_PUBLIC_` 前缀。数据库 URL、Redis URL、认证密钥和 Provider Secret 永远不能使用该前缀。

完整变量见 [配置参考](./12-configuration-reference.md)。

## 6. 数据库开发流程

修改 Schema：

```bash
pnpm db:migrate --name describe_the_change
pnpm db:generate
pnpm test:integration
```

提交内容必须包含：

- `schema.prisma` 变更。
- 新迁移目录和 SQL。
- 需要的索引与约束。
- 对应集成测试。
- 若影响升级，更新部署和版本文档。

禁止：

- 修改已经进入公开版本的历史迁移。
- 使用 `db push` 代替正式迁移。
- 只更新 Prisma 类型而不提交数据库迁移。
- 在页面组件中直接执行数据修复。

需要清空个人开发数据库时可以提供 `pnpm db:reset`，但该命令必须检查 `NODE_ENV` 和数据库地址，拒绝明显的生产连接。

## 7. 测试环境

### 单元测试

不依赖外部服务，测试领域规则和纯函数。

### 集成测试

使用独立测试 PostgreSQL 和 Redis：

```bash
docker compose -f deploy/compose/compose.test.yml up -d
pnpm test:integration
docker compose -f deploy/compose/compose.test.yml down
```

测试数据库名称、Redis DB/前缀与开发环境隔离。测试结束不能清理到开发或生产数据。

### E2E

CI 和本地均使用接近生产的构建：

```bash
pnpm build
pnpm test:e2e
```

核心 E2E 需要同时启动 Web、Worker、PostgreSQL 和 Redis，不能用同步假实现掩盖队列问题。

## 8. 首次管理员和演示数据

开发环境允许通过 `pnpm db:seed` 创建固定的测试用户，但：

- 默认密码只用于本地且明确标记。
- 生产 `setup` 不读取开发测试密码。
- 测试管理员创建逻辑不能进入公开注册接口。
- E2E 用户使用独立 fixture，并在每次测试前重置。

生产首次管理员流程见 [安装与运维运行手册](./13-installation-operations-runbook.md)。

## 9. 常见诊断

### Web 可用但通知不发送

检查 Worker 是否运行、Redis 是否可达、Outbox 是否积压以及 SMTP 是否配置。不要在 Web 请求中临时改为同步发信。

### Prisma Client 与 Schema 不一致

执行 `pnpm db:generate`，检查 lockfile 和迁移状态。不能通过删除迁移解决。

### Redis 清空后数据消失

如果业务事实永久丢失，说明实现违反架构原则。Redis 只能保存缓存、限流状态和可恢复队列状态。

### Client Component 报 Node 模块错误

检查是否从 `src/modules` 或 `src/infrastructure` 导入服务端代码。应传递安全 DTO，不能通过动态 import 绕过边界。

## 10. 开发环境完成标准

`v0.2.0` 结束时，新贡献者应能够只阅读本手册完成：

1. 安装依赖。
2. 启动 PostgreSQL、Redis 和 Mailpit。
3. 执行迁移和种子。
4. 启动 Web 与 Worker。
5. 修改页面并看到热更新。
6. 创建任务并观察 Worker 消费。
7. 运行单元、集成和 E2E 测试。

任何命令发生变化时，代码、CI、`.env.example` 和本文必须在同一个变更中更新。
