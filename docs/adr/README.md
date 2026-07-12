# 架构决策记录（ADR）

ADR 记录已经影响长期兼容性的技术决策。决策被替代时保留原文件并标记 `Superseded`，不能删除历史。

## 索引

| ADR | 状态 | 决策 |
| --- | --- | --- |
| [0001-modular-monolith.md](./0001-modular-monolith.md) | Accepted | 使用 Next.js 模块化单体 |
| [0002-postgresql-only.md](./0002-postgresql-only.md) | Accepted | PostgreSQL 是唯一官方数据库 |
| [0003-single-image-separated-runtimes.md](./0003-single-image-separated-runtimes.md) | Accepted | 一个镜像，Web/Worker 分离，默认四容器 |
| [0004-unified-src-layout.md](./0004-unified-src-layout.md) | Accepted | 使用统一 `src` 结构，不拆 frontend/backend 工程 |
| [0005-topic-post-model.md](./0005-topic-post-model.md) | Accepted | Topic 保存元数据，首帖和回复统一使用 Post |
| [0006-agpl-attribution-license.md](./0006-agpl-attribution-license.md) | Accepted | AGPLv3 + 第 7(b) 条页脚署名要求 |
| [0007-prisma-7-driver-adapter.md](./0007-prisma-7-driver-adapter.md) | Accepted | Prisma 7 + PostgreSQL driver adapter |

## 模板

新 ADR 应包含：标题、状态、日期、背景、决策、备选方案、后果、迁移/回退和关联文档。编号只递增不复用。
