# 参考项目分析

本文记录架构调研的结论。参考项目提供经验，不构成兼容或复制目标。

## 对比摘要

| 项目 | 主要技术 | 应用交付方式 | 常见依赖 | 对 NextBuf 的启示 |
| --- | --- | --- | --- | --- |
| new-api | Go、Gin、React | 前端构建产物嵌入 Go 二进制，单应用镜像 | PostgreSQL/MySQL、Redis | 用户只面对一个应用入口，发布体验简单 |
| sub2api | Go、Vue/Vite | 源码前后端分离，发布时合成单应用镜像 | PostgreSQL、Redis | 开发目录可以分层，交付不必分裂成两个产品 |
| Rhex | Next.js、Prisma、PostgreSQL、Redis | 同一应用镜像以不同命令运行 Web 和 Worker | PostgreSQL、Redis | 与 NextBuf 技术路线接近，可借鉴运行时拆分和扩展点 |
| Discourse | Ruby on Rails、Sidekiq、PostgreSQL、Redis | 官方 standalone 可在一个容器内监督多个进程 | PostgreSQL、Redis | 容器数不代表规模；成熟的多进程封装也可以简化安装 |

## new-api

new-api 的核心后端由 Go 编写，前端构建后通过 Go 的嵌入能力打进最终二进制。最终用户运行的是一个应用服务，不需要单独配置前端服务器。

可借鉴之处：

- 镜像拉取后即可运行，减少宝塔用户需要理解的概念。
- 配置集中在环境变量和 Compose 文件。
- 应用、数据库、Redis 作为一个部署单元提供。

不直接照搬之处：

- NextBuf 使用 Next.js 服务端渲染，不能把前端等同于纯静态文件。
- 社区的异步任务、权限和内容治理比 API 聚合服务更复杂。

## sub2api

sub2api 在源码层面使用 Go 后端和 Vue 前端，但构建流程将两者合并为一个可部署应用。其 Compose、本地目录挂载和安装脚本降低了非专业用户的安装门槛。

可借鉴之处：

- 提供默认 Compose、可持久化目录版和外部数据库版等部署变体。
- 安装脚本生成密钥和基础配置，而不是要求用户手工拼接。
- 数据库、Redis、应用均有健康检查和明确依赖关系。

不直接照搬之处：

- NextBuf 前后台本来就在同一个 Next.js 工程，无需复制其前端打包方式。
- 一键脚本必须是 Compose 的薄封装，不能形成另一套不可测试的部署逻辑。

## Rhex

Rhex 与计划中的 NextBuf 最接近：Next.js 负责 Web，独立 Worker 消费后台任务，二者使用相同镜像和代码，但运行不同命令。

其核心常驻拓扑为：

```text
web + worker + postgres + redis
```

Compose 中还可以出现一次性的 `setup` 服务和可选备份服务。`setup` 完成数据库初始化后退出，不应计入常驻容器数量。

可借鉴之处：

- Web 与 Worker 是两个运行角色，而不是两个代码仓库。
- 初始化任务先成功完成，再启动 Web 和 Worker。
- 数据库、缓存、应用之间通过健康状态协调启动。
- Addon 系统说明社区程序后期会需要明确扩展协议。

需要谨慎之处：

- 插件系统会影响权限、数据库迁移、升级兼容和安全边界，不能只复制目录结构。
- 项目模型数量和功能很多，不适合作为 NextBuf V1 的范围模板。
- 依赖版本、数据库卷路径和备份脚本必须由 NextBuf 自己验证。

## Discourse

Discourse 的官方 `standalone.yml` 明确称为 all-in-one 容器模板。它组合 PostgreSQL、Redis 和 Web 模板；Web 模板中配置 Unicorn 和 Sidekiq，并通过 runit 监督 Nginx、Rails Web、Sidekiq 等进程。

因此，“Discourse 没有 Worker 容器”不等于“Discourse 没有 Worker”。常见三容器部署通常是：

```text
discourse（内部运行 Web + Sidekiq）
postgres
redis
```

官方 standalone 还可以进一步把数据库和 Redis 放在同一应用容器内。大型托管环境则可以拆分数据库、缓存、Web 和后台任务。

结论：

- 容器数量是进程封装和运维策略，不是项目成熟度或承载能力指标。
- 单容器多进程需要可靠的进程监督、信号转发、日志和健康检查。
- 多容器可以获得独立重启、监控、资源限制和横向扩展，但 Compose 文件会多一个服务定义。

参考资料：

- [Discourse standalone template](https://github.com/discourse/discourse_docker/blob/main/samples/standalone.yml)
- [Discourse web template](https://github.com/discourse/discourse_docker/blob/main/templates/web.template.yml)
- [Rhex](https://github.com/lovedevpanda/Rhex)
- [new-api](https://github.com/QuantumNous/new-api)
- [sub2api](https://github.com/Wei-Shaw/sub2api)

## 对 NextBuf 的最终影响

NextBuf 不按参考项目的容器数量做表面选择，而按自身运行时边界设计：

1. 默认使用一个应用镜像。
2. 同一镜像以 `web` 和 `worker` 两种命令启动。
3. 默认 Compose 提供四个常驻容器：Web、Worker、PostgreSQL、Redis。
4. 数据库初始化和迁移使用一次性任务，不作为常驻容器。
5. 非 Docker 部署同样运行 Web 与 Worker 两个进程。
