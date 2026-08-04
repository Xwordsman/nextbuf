# ADR-0020：稳定版镜像通道与发布生命周期

- 状态：Accepted
- 日期：2026-07-30
- 适用版本：`v1.0.0` 稳定化及之后
- 替代范围：替代 ADR-0017 第 2 节和 ADR-0018 中由 `main` 更新 `latest` 的规则；ADR-0018 的双架构验证、过期构建保护和不可变 `sha-*` 规则继续有效

## 背景

公开 Beta 阶段需要让宝塔部署者快速拉取每个已验证的 `main` 提交，因此 ADR-0018 曾把 `latest` 定义为滚动 Beta。进入首个稳定版后，默认部署标签必须表达稳定支持承诺；如果 `main` 继续覆盖 `latest`，一次尚未形成 Release 的迁移或修复就会进入默认生产通道，也无法区分“通过主线门槛”和“完成正式发布”。

同时，项目仍需要可供内测的连续主线通道、按提交回滚的不可变身份，以及不重复构建的双架构正式发布。通道名称必须各自只表达一种语义。

## 决策

### 1. 公开镜像通道

GHCR `ghcr.io/xwordsman/nextbuf` 使用以下合同：

| 标签 | 可变性 | 来源 | 支持语义 |
| --- | --- | --- | --- |
| `latest` | 可移动 | 最新且完整发布的稳定 `vMAJOR.MINOR.PATCH`，其中 `MAJOR >= 1` | 面板默认稳定通道 |
| `edge` | 可移动 | 最近一个仍是远程 HEAD、并通过完整主线检查和 amd64/arm64 镜像冒烟的 `main` 提交 | 预发布验证，不作为生产支持版本 |
| `sha-<完整提交>` | 不可变 | 与同一次 `edge` 候选完全相同的多架构 manifest | 精确主线身份、复现和受控测试 |
| `<MAJOR.MINOR.PATCH>` 或合法预发布版本 | 不可变 | 与 `package.json` 完全匹配的 `v<版本>` 标签 | 精确 Release 身份；是否受支持由 `SUPPORT.md` 决定 |
| `sha-<完整提交>-<架构>` | 不可变 | 主线首次构建并完成该架构冒烟的带证明源索引；演练和标签复用 | 工作流内部来源，非部署 API |
| `ci-<运行>-<次数>-<提交>-release-index` | 可回收 | 演练/标签发布前对已验收 `sha-*` 的临时只读副本 | 非部署 API |

`latest` 不是“最新提交”，而是最新稳定补丁。`v0.x`、`v1.0.0-rc.N` 等预发布标签可以生成不可变 SemVer 镜像和标记为 prerelease 的 GitHub Release，但不得更新 `latest`。

### 2. 主分支发布顺序

每次 `main` push 必须先通过格式、Lint、类型、单元测试、真实服务集成、生产构建、E2E、归档启动及两个原生架构的镜像冒烟。amd64 还必须从当前公开升级基线运行真实 `nextbufctl upgrade --verify-objects`，在候选 Web/Worker 启动前完成停写比较和附件对象校验。空卷恢复与依赖故障注入仍留在定时、手动和标签深度运行，这些通道及正式标签重跑同一升级。主线为每个架构只创建一次不可变 `sha-<完整提交>-<架构>` 源索引，包含运行时 manifest、一个 SPDX SBOM layer 和一个 SLSA provenance layer；在冒烟前固定实际拉取的运行时 Digest，成功后上传同时绑定源索引 Digest、commit、版本和平台的短期 Actions artifact。随后工作流确认该提交仍是远程 `main` HEAD，才从这两个内容地址创建并完整验证：

1. 不可变 `sha-<完整提交>`；
2. 指向同一 manifest 的可移动 `edge`。

完整验证包括精确的 amd64/arm64 运行时成员、两个 attestation 描述符、layer predicate annotation 以及 OCI 运行时引用关系。过期、失败或取消的运行不得移动 `edge`，`main` 在任何情况下都不得写入 `latest`。部署者使用 `edge` 时必须记录完整 commit 与 Digest；普通容器重启不会主动拉取新内容。

### 3. 标签发布与稳定提升

`v*` 标签必须与源码版本完全匹配，并且对应 commit 已存在通过主线门槛的不可变 `sha-<完整提交>`。标签和显式发布演练都复用 `sha-<完整提交>-<架构>`，拉取同一运行时执行镜像、升级和深度冒烟，不重新构建；发布任务先完整验证已验收 `sha-*`，再按其 Digest 创建 run-scoped staging 引用并证明 Digest 完全相同。演练到此停止，不写 SemVer、GitHub Release、完成回执或 `latest`；正式 tag push 才从同一 staging Digest 创建不可变 SemVer，因此 SemVer、人工验收候选和 `sha-*` 的 OCI index Digest 必须相同。若 SemVer 已存在，完全一致时按同一发布的幂等重跑复用，不一致时失败，任何情况都不覆盖不可变身份。Registry 查询只有明确返回 `manifest unknown`、`name unknown` 或 `not found` 时才允许创建候选、`sha-*`、staging 或 SemVer 标签；超时、5xx、限流、认证及其他不明确失败必须终止发布。运行时平台等价判断与 Release 回执记录 amd64/arm64 Digest，顶层 index Digest 同时覆盖证明描述符；既有 SemVer 上的证明清单保持不可变。同名 Actions artifact 只允许覆盖本次工作流自己的临时上传。

GitHub Release 的归档、旁路 SHA-256、SBOM 和其他要求资产全部成功发布后，每个标签自己的完成任务重新解析轻量/注释标签的最终 commit，基于已验证资产和 OCI 身份重新生成并同步预期 Release 正文，再上传包含版本、commit、OCI index/amd64/arm64 Digest、Release 正文 SHA-256 和资产哈希的完成回执。标签完成不进入跨标签并发锁，因此另一个标签的调和任务不能替换尚未写完的回执。首次上传后以及后续复用完成状态或提升 `latest` 前，都必须从 GitHub Release 下载完成回执与三项必需资产、通过 GitHub API 重新读取实际正文，并严格核对版本、commit、OCI 身份、正文 SHA-256、全部资产 SHA-256 和旁路归档校验和；首次远端验证失败时立即删除完成回执，使部分或混合资产不能保留“已完成”标记。旧格式、伪造正文哈希或只有文件名而内容不匹配的 Release 不构成完成证据。只有当前标签的完成回执成功且再次验证通过后，才启动后续稳定通道调和：

- 版本必须是无预发布后缀、无构建元数据且 `MAJOR >= 1` 的精确 `MAJOR.MINOR.PATCH`；
- 版本必须是仓库全部非草稿、非预发布且同时具备约定归档、旁路 SHA-256、SBOM 和完成回执的 GitHub Release 中最高稳定 SemVer；只有裸标签、Release 仍失败或资产未完成的高版本不参与选择，较旧 Release 补推或重跑不能使 `latest` 倒退；
- 工作流还必须读取当前 `latest` 镜像内唯一的 `NEXTBUF_VERSION`，并证明其 amd64/arm64 平台成员与同版本不可变 SemVer manifest 完全一致；候选低于当前通道时拒绝回写，即使更高版本的 Release 元数据后来被删除、改为草稿或丢失资产也不得倒退；
- `latest` 直接使用回执记录的 `image@sha256:<index>` 内容地址，不重新构建；提升前证明当前 SemVer 仍指向该 index/平台成员，提升后再证明 `latest` 与回执完全一致。

因此 SemVer 镜像、GitHub Release 完成和 `latest` 调和依次形成；任一前置步骤失败都不移动默认稳定通道。带完成回执但校验失败的 Release 会阻断自身提升，且不能通过较旧标签的重跑绕过。只有独立的稳定调和任务使用跨标签工作流共享的并发锁：它在取得锁后重新计算最高完整 Release，并在写入前后重新核对 Registry 当前状态。GitHub 可以用较新的等待任务替换同一并发组中尚未开始的等待任务；这里被替换的只会是冗余调和，不会丢失已经在锁外完成并验证的标签回执，任一存活调和任务都从全局清单选择最高完整版本。Release 列表和现有 `latest` 两条证据共同阻止倒退。正式标签前必须启用覆盖 `refs/tags/v*` 的 GitHub Repository Ruleset，限制创建、更新和删除，仅允许发布负责人 bypass；未配置时发布结论保持 `NO-GO`。

### 4. 身份、升级与支持请求

生产记录至少保存精确 SemVer 和镜像 Digest；只记录 `latest`、`edge` 或源码版本字符串不足以定位产物。`/api/version`、doctor、备份清单和 Worker 身份继续记录 commit。

受控 `compose.yml + .env + nextbufctl` 始终使用精确 SemVer。宝塔单文件模板可以继续写 `latest`，但升级仍是显式的“备份、拉取、重建、验证”操作，不是无人值守自动更新。需要候选验证时，部署者显式把镜像临时固定为 `edge` 或 `sha-*`，不得把测试实例的通道选择解释为稳定支持。

### 5. 首个稳定版前的过渡

合并本决策后，`main` 开始更新 `edge` 而不再移动历史 `latest`。在 `v1.0.0` 完整发布前，GHCR 中既有 `latest` 仍指向最后一个经验证的 `v0.13.10` 滚动 Beta；它只用于保持既有面板安装可升级，不代表 `v1.0.0` 已发布。不可变 `0.13.10` 来自发布提交 `40a9e34db2cec0faa554d7c07f13ae4e58c8fe54`，历史滚动 `latest` 后来更新到仍声明版本 `0.13.10` 的主线提交 `fce33e7a3c997a332bc60d2a33f41817b69f0218`，因此两个 OCI index 与平台镜像 Digest 均不同。

稳定提升器只对精确的 `latest=0.13.10`、候选 `1.0.0` 允许这一次历史过渡，并把 2026-08-01 审计到的两个顶层 OCI index Digest 与四个平台成员 Digest 固定在检查器中；这些 Digest 已经以内容寻址方式覆盖两架构 config 中的版本和提交。Registry 中任一身份、架构或版本不符即终止；`v1.0.0` 建立稳定通道后，所有后续提升继续要求 `latest` 与其同版本不可变 SemVer 的平台成员完全相同。首个完整稳定标签成功后，`latest` 才首次获得本 ADR 的稳定含义。

## 备选方案

### 继续让 `main` 更新 `latest`

面板内测最快，但稳定版后会把未发布提交送入默认生产通道，破坏支持与回滚语义。

### 正式标签同时移动 SemVer、Release 和 `latest`

这些对象无法真正原子创建；先移动 `latest` 会在 Release 资产失败时暴露半发布。采用有依赖顺序的独立提升任务更可审计。

### 为每个主次版本维护 `1`、`1.0` 浮动标签

当前维护能力不足以同时保证多条浮动通道不倒退。V1 只承诺 `latest`、`edge`、`sha-*` 和精确 SemVer；增加其他标签需要新决策和测试。

## 后果

- 宝塔默认通道在首个稳定版后只接收完整稳定 Release，主线验证改用 `edge`。
- 稳定发布在每标签完成任务之后增加独立的共享锁调和任务，但不会重复构建镜像；等待中的冗余调和可被替换，标签完成证据不受影响。
- `v0.x` 与 RC 仍可完整验证和发布资产，不会污染稳定默认通道。
- 文档、支持请求和事故记录必须区分可移动通道与不可变产物身份。

## 迁移与回退

工作流变更不删除、不改写既有 SemVer 或 `sha-*`。现有 `compose.baota.yml` 无需修改；在 `v1.0.0` 前继续获得冻结的最后 Beta，正式版发布后下一次显式拉取才进入稳定通道。

若 `edge` 提升逻辑故障，停止该任务不会影响精确 SemVer 或现有 `latest`。若稳定 `latest` 指向错误产物，不通过重写 SemVer 修复；先停止推广并发布更高补丁版本，数据已迁移的实例按对应发布说明恢复。

## 关联文档

- [ADR-0015：生产打包、首次安装门禁与恢复边界](./0015-production-packaging-setup-and-recovery.md)
- [ADR-0017：单文件面板 Compose 与镜像版本通道](./0017-single-file-panel-compose.md)
- [ADR-0018：主分支验证镜像通道](./0018-validated-main-image-channel.md)
- [支持政策](../../SUPPORT.md)
- [部署与运维](../05-deployment-operations.md)
- [v1.0.0 发布就绪](../19-v1.0.0-release-readiness.md)
