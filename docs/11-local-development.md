# 本地开发手册

本文定义 NextBuf 开发环境的实际命令和工作流。`v0.12.0` 额外增加生产镜像/Compose、setup/preflight、一次性首次管理员、备份恢复和发布包；开发 Compose 仍只启动 PostgreSQL、Redis 与 Mailpit。

## 1. 前置条件

开发机需要：

| 工具 | 版本 | 用途 |
| --- | --- | --- |
| Node.js | 24 LTS | Next.js、Worker、脚本 |
| pnpm | 通过 Corepack 固定仓库版本 | 包管理 |
| Docker Engine/Desktop | 支持 Compose v2 | 本地 PostgreSQL 18、Redis 8、Mailpit 与集成测试 |
| Git | 当前稳定版 | 版本控制 |

可选工具：

- PostgreSQL 客户端，用于只读诊断。
- Redis CLI，用于队列和缓存诊断。
- VS Code 及 ESLint、Prettier、Playwright 扩展。

`package.json` 的 `packageManager` 字段已经锁定 pnpm 版本，开发者不应全局安装任意版本覆盖 Corepack。

## 2. 首次初始化流程

目标命令：

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
docker compose -f deploy/compose/compose.dev.yml up -d
pnpm db:generate
pnpm nextbuf setup
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
- 全新开发库执行 setup 后访问 `/setup`，使用开发 `.env` 的 `SETUP_TOKEN` 创建首位管理员并从 Mailpit 完成邮箱验证；普通注册在安装完成前被拒绝。

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
| PostgreSQL | `localhost:5432` | 仅开发机回环地址 |
| Redis | `localhost:6379` | 仅开发机回环地址 |
| Mailpit SMTP | `localhost:1025` | Worker 开发发信 |
| Mailpit Web | `http://localhost:8025` | 查看验证和重置邮件 |

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
| `pnpm build:runtime` | 将 Worker 与 CLI 编译到 `dist/` |
| `pnpm prepare:standalone` | 将 `.next/static` 和 `public` 整理进 standalone 运行目录；通常由 `build:web` 自动调用 |
| `pnpm start:web` | 运行已构建 Web |
| `pnpm start:worker` | 运行已构建 Worker |
| `pnpm nextbuf <命令>` | 开发时运行 `web`、`worker`、`migrate`、`setup`、`doctor` 入口 |
| `pnpm nextbuf:built <命令>` | 验证构建后的 CLI 入口 |
| `pnpm nextbuf invite create --uses 1 --expires-hours 168 --label text` | 创建只显示一次明文的邀请码 |

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
| `pnpm test:e2e` | 使用 Chromium 验证已构建的 standalone Web |
| `pnpm test:all` | CI 级完整检查 |

## 5. 环境文件

建议：

```text
.env.example       已提交，全部配置说明和安全占位符
.env               本地共享默认值，不提交
.env.test.example   已提交的隔离测试模板
.env.test           从模板复制的本地测试配置，不提交
.env.local          开发者个人覆盖，不提交
```

Next.js 对环境文件有自己的加载规则，但 Worker 和 CLI 也必须使用同一个经过 Zod 校验的配置模块，不能分别解析出不同结果。

只有明确允许进入浏览器的变量才使用 `NEXT_PUBLIC_` 前缀。数据库 URL、Redis URL、认证密钥和 Provider Secret 永远不能使用该前缀。

完整变量见 [配置参考](./12-configuration-reference.md)。

默认本地 Provider 把头像写入 `data/uploads/avatars`，把附件原件/派生文件写入 `data/uploads/attachments`。该目录已被 Git 忽略，但属于本地事实数据；需要保留开发数据时不能在清理构建产物时一并删除。可通过 `STORAGE_LOCAL_PATH` 改为其他路径；限制与 S3 配置见[配置参考](./12-configuration-reference.md)。本地切换 S3 之前必须迁移已有对象，不能只修改环境变量。

生产构建必须通过 `pnpm start:web` 启动 standalone Web。该入口会先加载仓库根 `.env`，并在 Next.js standalone 改变进程工作目录前把相对 `STORAGE_LOCAL_PATH` 固定为相对于启动目录的绝对路径，确保 Web 与独立 Worker 读写同一目录。使用相对本地存储路径时不要绕过该入口直接执行 `.next/standalone/server.js`；生产部署仍建议配置明确的绝对持久卷路径。

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

使用独立测试 PostgreSQL、Redis 和 Mailpit：

```bash
docker compose -f deploy/compose/compose.test.yml up -d
cp .env.test.example .env.test
pnpm test:integration
docker compose -f deploy/compose/compose.test.yml down
```

PowerShell 使用 `Copy-Item .env.test.example .env.test`。集成测试配置会加载 `.env.test`，强制要求 `RUN_INTEGRATION_TESTS=true`，并在测试开始时通过 `setup` 执行已有迁移；未显式启用时命令会失败而不是静默跳过。

测试数据库名称、Redis DB/前缀与开发环境隔离。测试结束不能清理到开发或生产数据。

### E2E

首次在本机运行时安装仓库锁定版本对应的 Chromium：

```bash
pnpm exec playwright install chromium
```

CI 和本地均直接运行生产 standalone 构建：

```bash
pnpm build
pnpm test:e2e
```

Playwright 配置会执行 `pnpm start:e2e`，同时启动 `node .next/standalone/server.js` 和已构建 Worker。测试服务继承当前进程的完整环境配置，显式绑定 `127.0.0.1:3000`，并以 `/api/health/live` 作为启动探针，避免 CI Runner 自带的 `HOSTNAME` 改变 standalone 监听地址。`build:web` 会自动整理 `.next/static` 与 `public`，不能把启动命令改回不支持 standalone 的 `next start`。

`v0.12.0` E2E 依赖 PostgreSQL、Redis、Mailpit、Web 和 Worker，覆盖：

- 1440px 下 1380px 最大宽度、230px/300px 侧栏和 16px 间距。
- 1024px 双栏和右侧面板弹窗。
- 390px 搜索、移动布局与无横向溢出。
- 匿名搜索、节点筛选、登录/注册入口和右侧面板。
- 桌面/平板/手机完整截图和 serious/critical axe 检查。
- 注册、Mailpit 验证链接、登录、两设备会话、找回密码、旧会话撤销和新密码登录。
- 注册用户名、用户菜单中的 `@username`/UID/真实 TL、公开用户页、信任说明页和账号中心保护。
- 真实社区首页、节点路由、页内筛选、PostgreSQL 搜索、Markdown 预览、附件上传、发布/编辑主题、回复、提及、引用、点赞、收藏、用户/主题关注、个人列表、编辑回复、软删除/恢复和“我的主题”。
- 真实未读计数、通知列表、全部已读、归档和通知渠道偏好保存。
- 普通登录用户直接调用管理后台 Provider API 返回 403，不依赖导航隐藏作为授权边界。

身份/资料集成测试还会验证 UID/Profile 迁移、未激活资料不可公开、用户名历史别名与冷却、头像媒体写入/替换、隐私设置和 14 天注销申请幂等。头像测试文件写入 `STORAGE_LOCAL_PATH`，测试清理与工作区忽略规则必须保持一致。

后续认证、发帖和异步通知等核心旅程必须同时启动 Worker、PostgreSQL 和 Redis，不能用同步假实现掩盖队列问题。

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

`v0.12.0` 后，新贡献者应能够只阅读本手册完成：

1. 安装依赖。
2. 启动 PostgreSQL、Redis 与 Mailpit。
3. 执行迁移和种子。
4. 启动 Web 与 Worker。
5. 修改页面并看到热更新。
6. 创建任务并观察 Worker 消费。
7. 运行单元、真实服务集成测试和 standalone E2E。
8. 在 Mailpit 中完成邮箱验证和密码重置，并创建邀请制注册邀请码。
9. 注册带用户名的账号，修改资料与隐私，上传头像并访问公开用户页。
10. 发布草稿或主题，浏览节点流，编辑主题并验证修订、软删除和恢复。
11. 预览 Markdown，上传附件，发布/引用/编辑/删除/恢复回复，并观察 Worker 处理图片派生文件。
12. 点赞、收藏、关注用户/主题，查看个人互动列表，验证阅读状态、浏览聚合、热门排序和 PostgreSQL 搜索。
13. 触发并查看通知、设置普通通知渠道、通过 `pnpm nextbuf mail test --to <邮箱>` 验证 SMTP，并在管理员 Worker 页面查看失败与登记重放。
14. 举报主题、回复或用户，按角色范围处理案件与撤销制裁，并验证信任指标、规则预估和批次重算。

任何命令发生变化时，代码、CI、`.env.example` 和本文必须在同一个变更中更新。
