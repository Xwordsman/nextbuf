# ADR-0004：统一 src 结构，不拆 frontend/backend

- 状态：Accepted
- 日期：2026-07-12

## 背景

new-api 和 sub2api 的前后端使用不同语言和构建链，因此源码分为 frontend/backend。NextBuf 使用 Next.js，React 页面、Server Components、Route Handlers、Server Actions 和 Node 服务端属于同一框架。人为拆成两个工程会增加认证、类型、构建和部署边界。

## 决策

- 应用源码全部放入 `src/`。
- App Router 使用 `src/app/`。
- UI 使用 `src/components/`。
- 领域业务使用 `src/modules/`。
- 数据库、缓存、队列等适配使用 `src/infrastructure/`。
- Worker 入口使用 `src/worker/`。
- 不创建顶层 `frontend/` 和 `backend/` 工程。
- 使用 `server-only`、文件后缀和 lint 规则防止服务端代码进入客户端包。

## 备选方案

### 顶层 frontend/backend

边界直观，但 Server Components 和 Server Actions 同时属于页面与服务端，最终会跨目录共享大量代码，形成虚假分离。

### 根目录 app + src 业务代码

Next.js 支持，但应用源码分散在根目录和 `src`，不利于统一路径、lint 和贡献者理解。

### 所有代码放 app

初期文件少，但领域、基础设施和路由会快速混合，不适合长期社区项目。

## 后果

正面影响：

- 所有 TypeScript 应用代码有一个明确根目录。
- 保留 Next.js 全栈能力和共享类型优势。
- UI、领域、基础设施和 Worker 仍有清晰责任。

负面影响：

- 目录本身不能自动保证安全，需要 lint 和 `server-only`。
- 开发者必须理解 Server Component 与 Client Component 的运行区别。

## 迁移与回退

当前尚未初始化应用代码，无迁移成本。工程创建后改变顶层结构需要同步 tsconfig alias、测试、Docker 构建上下文和文档，因此默认不再变更。

## 关联文档

- [仓库结构与模块边界](../10-repository-structure.md)
- [开发指南](../06-development-guide.md)
- [系统架构](../02-system-architecture.md)
