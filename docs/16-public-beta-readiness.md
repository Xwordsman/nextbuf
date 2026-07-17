# 公开 Beta 就绪与加固记录

本文是 `v0.13.0` 的安全、性能、迁移、恢复、无障碍和真实安装验收记录。它不替代安全专题、ADR 或运行手册，而是把公开 Beta 的阻断项、验证证据和剩余风险集中到一个可审计入口。

- 当前状态：**Public Beta**
- 基线版本：`v0.12.0`
- 目标版本：`v0.13.0`
- 最后审计：2026-07-17
- 候选验证：[GitHub Actions CI #56](https://github.com/Xwordsman/nextbuf/actions/runs/29569138325)，提交 `68c4a9b`，amd64 完整候选门槛已通过
- 发布验证：[GitHub Actions CI #58](https://github.com/Xwordsman/nextbuf/actions/runs/29570284403)，标签 `v0.13.0`，amd64/arm64、恢复、升级、manifest、归档、SBOM/provenance 和 Release 已通过
- 发布入口：[GitHub Release](https://github.com/Xwordsman/nextbuf/releases/tag/v0.13.0)；[GHCR `0.13.0`](https://github.com/Xwordsman/nextbuf/pkgs/container/nextbuf)

`v0.13.0` 已满足自动化公开 Beta 发布门槛；真实域名、生产 SMTP/对象存储和邀请用户旅程仍按人工验收模板持续记录。`v0.13.0` 仍不是 `v1.0.0` 稳定版。

## 1. 威胁模型

### 1.1 需要保护的资产

- Better Auth 密码凭证、会话、验证标识和 OAuth Token。
- `AUTH_SECRET`、`MAIL_PAYLOAD_KEY`、`SETUP_TOKEN`、SMTP/S3/OAuth 凭据。
- 用户身份、邮箱、隐私偏好、主题、回复、修订、举报和治理记录。
- PostgreSQL 事实数据、附件原件与派生文件、备份和恢复密钥。
- 管理员角色、二次验证状态、制裁、信任规则和不可变审计。
- 镜像、发布归档、校验和、SBOM 和迁移历史。

### 1.2 攻击者与失败来源

- 未登录的公网访问者、垃圾注册者和自动扫描器。
- 已登录但试图越权、刷限额、读取隐藏内容或上传恶意文件的用户。
- 受限版主试图突破节点作用域，或普通用户直接调用后台接口。
- 诱导管理员执行高风险操作的 CSRF、钓鱼或会话窃取攻击。
- 配置错误的反向代理、SMTP、S3、数据库、Redis 和备份权限。
- 依赖漏洞、镜像供应链污染、失败迁移、队列重放和服务中断。
- 能读取日志、备份或环境变量但不应获得业务凭据的运维旁路。

### 1.3 信任边界

```text
Browser
  -> HTTPS reverse proxy
  -> Next.js proxy.ts / Route Handlers / Better Auth
  -> PostgreSQL (facts and audit)
  -> Redis + BullMQ (rebuildable delivery state)
  -> Worker
  -> SMTP / S3 / fixed GitHub OAuth endpoint

Operator
  -> .env secrets / nextbufctl / backup files / release artifacts
```

- 浏览器输入、Header、Cookie、文件名、Markdown 和 JSON 默认不可信。
- Route Handler 必须重新执行同源、认证、输入和领域授权；页面隐藏不是授权。
- Better Auth 独占密码、会话、验证、OAuth 和 Cookie 协议行为。
- PostgreSQL 是事实来源；Redis 可以清空，不能保存唯一业务事实。
- SMTP、S3 endpoint 和代理规则是部署者控制的启动配置，不是在线用户输入。
- Web 与 Worker 使用同一镜像但分进程；Client Component 不接触数据库、队列和密钥。

## 2. 安全控制与证据

| 风险 | 当前控制 | 自动证据 | 剩余边界 |
| --- | --- | --- | --- |
| XSS/CSP | 服务端清洗 Markdown；每请求随机 nonce；生产脚本不允许 `unsafe-inline`；禁止 object/frame | `security-headers.test.ts`、`markdown.test.ts`、浏览器 E2E | Radix/React 运行时样式仍需要 `style-src 'unsafe-inline'`，后续可评估 hash/style nonce |
| CSRF | 除 Better Auth 自有 Handler 外，所有改变状态的 Route Handler 都要求精确 `APP_URL` Origin | `same-origin.test.ts` 扫描全部 API 写入口；跨源请求集成测试 | 反向代理必须保持正确 Host/Origin；Better Auth 继续使用其原生来源与 Cookie 防护 |
| SSRF | 应用唯一主动 HTTP fetch 固定到 GitHub OAuth；S3/SMTP 只读启动配置；S3 endpoint 禁止非 HTTP(S)、内嵌凭据、query 和 fragment | 环境配置测试、Provider 后台越权 E2E | 自托管 MinIO 可使用内网地址，因此不能对管理员启动配置统一禁止私网；未来链接预览必须另建出站地址策略 |
| 上传攻击 | 字节上限、结构签名、声明 MIME、随机对象键、强制安全扩展名、文件名控制字符/双向字符清理、图片像素上限和 Worker 重编码 | `attachment-format.test.ts`、`avatar-storage.test.ts`、真实附件集成测试 | 不提供病毒扫描；ZIP/PDF 只下载不解压/执行；部署者若需要合规扫描应在对象存储边界扩展 |
| 凭据泄漏 | 结构化日志递归按键脱敏，并清理连接串密码、Bearer 与 Cookie/Authorization 字符串 | `logger.test.ts`、后台审计递归脱敏测试 | 宿主机、Docker daemon、`.env` 与备份访问仍由部署者负责 |
| 依赖漏洞 | 精确核心版本、lockfile、生产依赖审计、镜像 SBOM/provenance | `pnpm audit:prod`；2026-07-17 结果为 0 项 | 覆盖必须在上游发布安全版本后复核并移除，不能长期掩盖不兼容升级 |
| 越权管理 | 服务端角色/作用域/制裁检查，高风险操作绑定当前 Session 二次验证和确认文本 | 治理/后台集成测试、普通用户 Provider 403 E2E | OAuth-only 管理员尚无 TOTP/Passkey step-up，公开运营前应避免只使用 OAuth 的管理员账号 |
| 数据损坏 | 事务、数据库约束、稳定楼层、不可变修订、Outbox、幂等 Worker、可验证备份 | 真实服务集成测试、Compose setup/restore smoke | S3 对象需要 Provider 级版本/快照；迁移成功后不承诺盲目代码降级 |

## 3. 依赖审计

执行：

```bash
pnpm audit --prod --json
```

2026-07-17 基线发现：

- `postcss 8.4.31`：GHSA-qx2v-qp2m-jg93，中危。
- `@hono/node-server 1.19.11`：GHSA-92pp-h63x-v22m，中危，只经 Prisma 工具链进入。

仓库级 pnpm override 固定到已修复的 `postcss 8.5.10` 和 `@hono/node-server 1.19.13`，完整安装、单元测试、类型检查和生产构建必须验证兼容性。修复后生产审计为 0 项。CI 对生产依赖执行审计，并至少阻断 high/critical。

依赖升级不能批量追逐最新版。Better Auth、Prisma、Next.js、PostgreSQL、Redis、BullMQ、Sharp 或邮件链路升级后，必须重新执行真实服务、身份、附件、Worker、迁移和恢复测试。

## 4. 请求与出站网络规则

- `Origin` 必须是规范化后的精确应用 origin；缺失、非法、带路径或相似域名一律拒绝。
- 首次管理员 setup 和公开注册同样执行同源检查，setup token 不能代替 CSRF 防线。
- Better Auth Handler 是唯一 Route Handler 例外，其 trusted origin、Cookie 和 CSRF 行为由 Better Auth 管理，不重复实现协议。
- 用户主页、Markdown 链接和图片不会由服务端抓取；站外图片降级为链接。
- GitHub Provider 诊断只请求编译期固定 URL，使用八秒超时且不跟随用户给出的目标。
- S3/SMTP 连接测试只能由管理员触发，目标来自启动环境；站点设置数据库和浏览器请求不能改写目标。
- 未来增加链接预览、Webhook 或任意 Provider URL 时，必须拒绝 loopback、link-local、云元数据、私网解析和重定向逃逸，并增加 DNS rebinding 测试。

## 5. 上传与内容处理规则

- PNG 必须包含签名与 IHDR；JPEG 必须包含起止标志；WebP 必须有有效 RIFF/WEBP 和 VP8 chunk；PDF 必须有受支持版本头与尾标志；ZIP 必须有 EOCD。
- 识别到已知二进制前缀但结构不完整时直接拒绝，不能回退成纯文本。
- 下载文件名始终使用检测到的扩展名，清除路径分隔符、控制字符、双向覆盖字符和误导性前后点号。
- 原始图片不直接内联给其他用户；Worker 在像素上限下解码、旋转、去元数据并生成 WebP。
- ZIP/PDF 不在服务端展开、渲染或执行，只通过 `attachment` 与 `nosniff` 下载。

## 6. 日志与错误

- JSON 和 pretty 日志使用相同递归脱敏器。
- Password、Secret、Token、Cookie、Authorization、连接串、邮件/IP 和请求载荷字段按键隐藏。
- 即使敏感值嵌入普通错误字符串，也清理数据库/Redis URL 密码、Bearer 和敏感 Header。
- 循环诊断对象不会导致日志序列化崩溃；Error 只保留脱敏后的名称和消息，不输出堆栈到结构化上下文。
- 用户错误页只显示稳定描述与重试入口；内部堆栈、环境变量和 Provider 错误不得进入浏览器。

## 7. Beta 验收矩阵

| 范围 | 状态 | 完成证据 |
| --- | --- | --- |
| 威胁模型、依赖、CSP、CSRF、SSRF、上传 | 已完成 | 本文第 1-6 节、单元/集成/E2E、生产审计 |
| 首页、主题、搜索、后台和 Worker 性能基准 | 已完成 | HTTP 基准、公共页面 10 次 p50/p95、25 个 Outbox 任务十秒预算 |
| 索引、慢查询、连接池、Redis 和积压容量 | 已完成 | 外键索引检查、Doctor 容量快照、后台积压告警和 2 vCPU/4 GiB 最低档位 |
| 桌面、平板、移动端、键盘和 axe | 已完成 | 390/1024/1440 三种视口；首页、节点、搜索、主题页 serious/critical axe 门槛；跳转主内容和 reduced-motion |
| 从受支持 Beta 升级、备份和恢复 | 已完成 | CI #56：`v0.12.0 -> v0.13.0` 镜像升级、升级前备份与候选镜像空卷恢复 |
| 故障诊断和管理员告警 | 已完成 | CI #56：PostgreSQL/Redis/Worker readiness 恢复；SMTP/存储 doctor 归因；后台积压告警 |
| 邀请用户安装和核心旅程 | 待人工验收 | 安装、注册、发帖、举报、升级、恢复记录 |

## 8. 当前已知限制

- 在线成员跟踪和最终账号注销执行器尚未实现。
- OAuth-only 管理员不能完成密码二次验证；应至少保留一个受保护的邮箱密码管理员。
- S3 备份依赖对象存储版本/快照，`nextbufctl backup` 不复制远端对象。
- 非 Docker 发布包只提供 Linux x64；arm64 使用容器镜像。
- 最低 2 vCPU/4 GiB 只保证低流量 Beta 安装与核心旅程，不承诺固定并发或数据规模。
- 自动性能样本用于严重回归门槛，不是固定并发、百万主题或横向扩展承诺。
- 项目不内置 WAF、反病毒、集中日志、远程备份或 DDoS 防护，这些属于部署边界。

## 9. 当前安全验证命令

```bash
pnpm audit:prod
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

正式 Beta 还必须使用最终 amd64/arm64 镜像执行 Compose、首次管理员、升级、备份和空卷恢复，不能以本地单元测试代替。

## 10. 性能与容量验证

仓库提供不依赖第三方压测包的 HTTP 基准入口：

```bash
pnpm benchmark:beta -- \
  --base-url https://community.example.com \
  --path / \
  --path '/search?q=NextBuf' \
  --path /topics/1000 \
  --requests 100 \
  --concurrency 10 \
  --p95-ms 2000 \
  --max-error-rate 0 \
  --output beta-benchmark.json
```

- 每条路径分别输出样本数、并发、错误率、吞吐和 min/p50/p95/p99/max。
- 需要登录的后台路径从 `NEXTBUF_BENCHMARK_COOKIE` 读取临时 Cookie；命令参数和报告都不记录 Cookie。
- 正式记录必须说明服务器 CPU/内存、数据库规模、主题/回复/用户数量、网络位置和是否预热。
- GitHub Actions 浏览器测试对首页、搜索和真实主题页各采样十次，阻断单次运行中 p95 超过 3000ms；该宽松门槛用于发现严重回归，不代表生产容量承诺。
- CI 同时把每条路径的样本数、p50、p95 和 max 写入 Actions Summary，成功运行也保留可审计结果。
- Worker 集成基准在真实 PostgreSQL/Redis 中一次发布并消费 25 个 Outbox 事件，十秒为阻断上限。

`nextbuf doctor` 额外报告：

- PostgreSQL 数据库字节数、当前连接数、服务器最大连接数、每进程池上限和 statement timeout。
- Redis 当前/峰值内存、maxmemory、淘汰策略和使用比例。
- Worker 并发、Outbox 批量/轮询配置，以及 Queue、Outbox、邮件和持久失败积压。

后台首页将无就绪 Worker 或队列不可用标为严重，将 Queue/Outbox 积压和持久失败标为警告。默认警戒值是等待 Queue 或待发布 Outbox 达到 500；这是早期运营告警，不等于硬容量上限。

## 11. 迁移历史与升级证据

`prisma/migration-baselines/v0.12.0.json` 保存首个受支持 Beta 基线的迁移顺序与 SHA-256。执行：

```bash
pnpm migration:verify
```

校验会拒绝删除、重排或修改任何 `v0.12.0` 已发布迁移，但允许在基线之后只追加新迁移。该静态门槛不能替代真实升级；`v0.13.0` 发布候选仍需从精确 `v0.12.0` 镜像创建数据、备份、升级到候选镜像并执行恢复演练。

真实 PostgreSQL 集成测试还会拒绝：

- 未处于 valid/ready 状态的关键索引。
- 没有以前导列索引支持的单列外键。
- 与仓库迁移全集不一致的已应用、失败或意外迁移。

## 12. 无障碍与响应式验证

Playwright 在 Chromium 中固定执行以下公开页面矩阵：

- 视口：390×844、1024×900、1440×1000。
- 页面：首页、域名节点、搜索结果、真实数据库主题详情。
- 自动门槛：页面成功响应、主要内容可见、无水平溢出，axe 不允许 serious 或 critical 违规。
- 键盘门槛：首次 Tab 聚焦可见的“跳到主要内容”链接，激活后焦点进入 `#main-content`。
- 动效门槛：`prefers-reduced-motion: reduce` 关闭平滑滚动，并把动画和过渡降到近零时长。

axe 是自动回归门槛，不替代读屏器、缩放至 200%、高对比度和真实键盘旅程的人工验收。邀请测试记录仍需覆盖登录、编辑器、对话框和后台高风险操作。

## 13. 故障注入与恢复

定时、手动和正式标签流水线在 amd64 候选镜像上执行真实 Compose 故障演练：

- 停止 PostgreSQL 和 Redis 后，`/health/ready` 必须失败；依赖恢复后 Web readiness 必须重新成功。
- 停止 Worker 后，`/health/worker` 必须失败；重新启动 Worker 后心跳必须恢复。
- 停止测试 SMTP 后，`nextbuf doctor` 必须失败并把问题归因到 `mail`；Mailpit 恢复后诊断必须通过。
- 在本地附件卷中创建普通文件并临时把它作为存储根目录后，`nextbuf doctor` 必须快速失败并把问题归因到 `storage`；删除阻断文件并恢复正常配置后诊断必须通过。
- 全部注入结束后再次执行完整 doctor，防止“单项恢复但整体仍降级”的假阳性。

普通主分支提交不执行这组慢速故障演练，仍执行 Web/Worker/数据库/Redis/首次管理员基础镜像冒烟。生产环境的托管 PostgreSQL、Redis、SMTP 和 S3 仍需部署者按运行手册完成实例级告警和恢复演练。

提交 `68c4a9b` 的 CI #56 已在 amd64 候选镜像上完成上述全部故障注入、恢复后完整 doctor 和 `nextbuf-backup-v1` 空卷恢复。正式标签 CI #58 已重跑相同 amd64 门槛，并通过 arm64 首次安装冒烟后发布多架构 manifest。

## 14. 跨版本升级门槛

版本为 `0.13.0` 的主分支候选和正式 `v0.13.0` 标签都会在 amd64 流水线执行首个受支持 Beta 升级：

1. 拉取公开的精确 `ghcr.io/xwordsman/nextbuf:0.12.0` 基线镜像。
2. 把基线和本次已构建的候选镜像发布到 Runner 内的临时 Registry，确保 `nextbufctl upgrade` 走真实 pull 流程。
3. 在 `v0.12.0` 创建首位管理员和本地附件持久化证明。
4. 由 `nextbufctl` 自动创建升级前备份，停止 Web/Worker，并运行目标镜像的幂等 `setup`。
5. 验证目标版本接口、管理员、安装完成状态、附件、新迁移和 `runtime.initialized` 目标版本。
6. 再执行完整 doctor；流水线结束后销毁临时 Registry、Compose 卷和备份。

候选镜像的空卷恢复继续由同一标签流水线的 `nextbuf-backup-v1` 恢复测试覆盖。迁移成功后仍不承诺旧代码直接读取新 Schema；失败恢复遵循 ADR-0015。

CI #56 已真实完成以上六步并验证升级后的完整 doctor；正式标签 CI #58 已再次通过同一升级门槛，并完成标签镜像、manifest、SBOM、provenance、归档和 GitHub Release 验证。
