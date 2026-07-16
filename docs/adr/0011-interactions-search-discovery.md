# ADR-0011：互动事实、浏览聚合与 PostgreSQL 内容发现

- 状态：Accepted
- 日期：2026-07-16
- 适用版本：`v0.8.0` 起

## 背景

`v0.8.0` 需要开放点赞、收藏、关注、阅读状态、浏览计数、搜索和热门排序。这些能力横跨高并发重复写入、用户私有关系、匿名访问隐私、异步 Worker 和内容可见性。如果只在客户端切换按钮、只在 Redis 累加计数，或把“热门”保存成管理员可写布尔值，Redis 清空、并发请求或内容状态变化都会造成事实丢失、计数漂移和隐藏内容泄露。

搜索还必须保持低门槛自托管。V1 不能为了基础搜索增加第五个强制常驻服务，但查询边界需要允许未来替换为 Meilisearch 或 OpenSearch。

## 决策

### 1. PostgreSQL 保存互动事实

- `interaction_post_likes` 保存单一点赞反应，同一用户和 Post 使用复合主键保证唯一。
- `interaction_topic_bookmarks` 保存私有主题收藏；Topic 的 `bookmark_count` 是同事务更新的派生快照。
- `interaction_user_follows` 和 `interaction_topic_follows` 分别保存用户关注与主题关注；数据库禁止关注自己。
- `interaction_topic_read_states` 保存每用户每 Topic 的最大已读楼层和最近阅读时间。后退浏览不会降低最大已读楼层。
- Post 的 `like_count`、Topic 的 `bookmark_count` 和 `view_count` 是可核对的派生计数，不是授权来源。
- 写入接口采用“设置为已存在/不存在”语义。重复 `PUT` 或 `DELETE` 是幂等操作，只有真实新增或删除关系时才改变派生计数。

关系随用户或内容主体级联删除；软删除 Topic 不删除用户收藏，但公开列表和搜索不再暴露其内容。Redis 可以缓存查询或承担队列传输，但不拥有任何互动关系。

### 2. 浏览计数使用限量事实和 Outbox 聚合

主题页在浏览器挂载后向同源 POST 接口上报浏览。服务端将登录用户 ID，或匿名 IP/用户代理组合，使用 `AUTH_SECRET` 加领域前缀做 HMAC-SHA256；数据库只保存 64 位哈希，不保存原始 IP、用户代理或会话标识。

同一 Topic、访问者哈希和 30 分钟 UTC 时间桶只有一条 `interaction_topic_views` 记录。插入成功时在同一事务创建 `nextbuf.interactions.topic-view.aggregate@1` Outbox 事件。Worker 以 Outbox 事件 ID 幂等执行：仅未聚合记录可以把公开 Topic 的 `view_count` 增加一次，随后写入 `counted_at`。

已聚合原始桶保留 30 天，Worker 每次处理时限量清理最多 500 条过期记录。清空 Redis 不会丢失未投递 Outbox 或已接受浏览事实；Worker 重试不会重复计数。反向代理必须覆盖客户端传入的转发 IP 头，不能原样信任公网 `X-Forwarded-For`。

### 3. 热门算法 v1 是查询时派生结果

数据库不增加 `is_hot` 或管理员可写 `hot_score`。置顶、精华和未来管理员推荐与算法热门保持独立。热门页按以下分数降序排列：

```text
engagement = 1
  + 3.0 * ln(1 + min(replyCount, 40))
  + 4.0 * ln(1 + min(independentParticipants, 15))
  + 2.0 * ln(1 + min(likeCount, 80))
  + 1.5 * ln(1 + min(bookmarkCount, 30))
  + 0.5 * ln(1 + min(viewCount, 500))

hotScore = engagement / (1 + ageHours / 24) ^ 1.35
```

`independentParticipants` 只统计公开回复的不同作者。回复、参与者、点赞、收藏和浏览分别封顶，降低单一账号重复操作、刷回复或刷浏览的边际收益。分页游标保存固定 `asOf` 和 offset，使同一次浏览中的时间衰减基准保持一致；互动变化仍可能让跨页顺序发生合理变化。

### 4. V1 搜索使用 PostgreSQL Provider

迁移启用 `pg_trgm`，并为 Topic 标题、Post Markdown 源正文、用户公开身份、公开简介和节点信息建立 FTS/Trigram GIN 索引。`PostgresSearchProvider` 使用参数化 SQL，将 `websearch_to_tsquery('simple', ...)`、`similarity` 和转义后的 `ILIKE` 组合起来：

- 标题权重高于正文，用户名权重高于昵称和简介。
- 中文短语可以通过 Trigram/子串路径命中，不宣称具备语言学分词质量。
- Topic 及正文结果只包含 `published/closed` Topic、`published` Post 和 `public` Node。
- 用户结果只包含 active 用户；私有 Profile 的简介不参与结果展示。
- 节点结果只包含 public Node。
- `SearchProvider` 是页面依赖的内部合同；页面不直接拼 PostgreSQL SQL。未来外部 Provider 必须保持相同可见性语义和 PostgreSQL 降级路径。

V1 不增加 `SEARCH_URL`、索引同步 Worker 或第五个常驻服务。外部搜索仍属于后续版本。

### 5. 授权与当前范围

- 点赞、收藏、关注和阅读写入要求 active 登录用户，并执行同源检查。
- 匿名用户只能上报经过 HMAC 去标识化的浏览事实。
- 互动只允许指向公开 Node 中 `published/closed` Topic 和可见 Post。
- 本版本只保存关注关系，不提前生成站内通知或邮件。
- 本版本不把互动数据直接转换为信任等级、治理处罚或管理员权限。

## 备选方案

### 只使用 Redis Set 和计数器

写入快，但 Redis 清空或 key 过期会丢失点赞、关注和浏览事实，也无法稳定支持个人列表、备份和审计，因此拒绝。

### 每次主题 GET 直接增加浏览量

实现简单，但预取、刷新、爬虫和并发请求都会直接放大计数，且无法区分 Worker 重试，因而拒绝。

### 保存永久热门分数或管理员热门开关

查询更快，但容易形成不可解释、不可重建的运营字段，管理员也能直接伪造“算法热门”。V1 数据量允许查询时计算，因此拒绝。

### V1 强制部署 Meilisearch/OpenSearch

搜索能力更强，但会增加安装、升级、备份、健康检查和一致性成本，与低门槛四容器目标冲突，因此拒绝。

## 影响

正面影响：

- 重复请求、Redis 清空和 Worker 重试不会制造重复互动事实。
- 热门信号、权重、上限和时间衰减可以解释和测试。
- 搜索遵守与页面一致的可见性，不需要第五个服务。
- 个人收藏、关注、参与和阅读状态可以直接从 PostgreSQL 恢复。

负面影响：

- 互动写入需要事务维护关系和派生计数，吞吐高于当前规模后需要批量与分区评估。
- PostgreSQL `simple` FTS 对中文不做语言学分词，V1 依赖 Trigram/子串补足，相关性有限。
- 热门查询需要聚合参与者和点赞，在大规模数据前必须增加缓存、离线派生或物化策略，但不能改变事实来源。
- 匿名浏览防滥用依赖反向代理正确覆盖客户端 IP 头，不能抵御分布式代理刷量。

## 迁移与回退

迁移新增互动表、Post `like_count`、约束、`pg_trgm` 扩展和搜索索引，不重写已有主题正文。升级前需要确认迁移角色具备安装受信任扩展和创建 GIN 索引的权限。

短期代码回退到 `v0.7.0` 时可以保留新增表和列，但旧代码不会展示互动、处理浏览 Outbox 或使用新搜索索引；因此 Worker 必须与 Web 同版本回退。正式恢复应发布向前修复。若必须完全回退，只能恢复升级前 PostgreSQL 备份，并接受升级后互动和浏览事实丢失。
