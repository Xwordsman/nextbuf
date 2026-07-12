# 许可证与署名政策

本文记录 NextBuf 的许可证、页面署名、商标和外部贡献政策。它是开发、主题、插件、部署和再分发时必须遵守的产品合同。

> 当前状态：许可证方案、官方仓库 URL 和 DCO 已确定。官方仓库为 `https://github.com/Xwordsman/nextbuf`，版权声明使用 NextBuf contributors。第 7(b) 条英文文本在首个稳定版前仍应完成法律复核。

## 1. 许可证决定

NextBuf 核心采用：

```text
GNU Affero General Public License v3.0 only
SPDX base identifier: AGPL-3.0-only
Additional attribution terms under AGPLv3 Section 7(b)
```

不增加“禁止商业使用”“仅供学习”“未经许可不得收费运营”等非开源限制。

允许：

- 个人和组织自托管。
- 修改、复制和再分发。
- 收费部署、技术支持和托管服务。
- 在遵守许可证与署名要求的前提下商业运营。

要求：

- 修改后的受覆盖程序通过网络向用户提供服务时，按照 AGPLv3 向网络用户提供对应源码。
- 保留本政策规定的 NextBuf 页面署名和官方链接。
- 保留许可证、版权和变更来源说明。

AGPL 约束软件代码，不要求部署者公开社区文章、用户数据库、域名、SMTP 密码、运营配置或其他不属于对应源码的私有数据。

## 2. 页脚署名

### 2.1 固定文本

Web 界面必须显示：

```text
Powered by NextBuf
```

其中 `NextBuf` 必须是指向官方项目仓库的可点击链接。

官方项目 URL 固定为：

```text
https://github.com/Xwordsman/nextbuf
```

该 URL 是构建时写入的官方法律元数据，不是运行时环境变量，不允许部署者覆盖。

### 2.2 显示位置

- 标准前台、账号中心和管理后台页面显示在全局页脚。
- 登录、注册、错误、安装向导等特殊布局没有标准页脚时，也必须在页面底部区域显示同等清晰的署名。
- API、CLI、Worker 和无 Web UI 的纯后台进程不需要制造视觉页脚，但仍受源码和许可证要求约束。
- 嵌入式或极简页面若技术上无法使用完整页脚，必须在同一可见界面提供等效署名，不能仅藏在源代码或响应头中。

### 2.3 可见性

署名不得：

- 被删除、替换或指向其他项目。
- 使用 `display: none`、透明色、零尺寸、屏幕外定位等方式隐藏。
- 被遮挡、折叠到默认不可见区域或仅在悬停后出现。
- 明显小于、弱于同一区域的其他普通页脚文字。
- 通过后台设置、环境变量、主题、插件或自定义 CSS 合法关闭。

部署者可以在旁边添加自己的内容，例如：

```text
© 2026 示例社区 · Powered by NextBuf
```

部署者的社区版权不能替换 NextBuf 项目署名。NextBuf 署名也不表示项目作者拥有部署者的社区内容。

## 3. 第 7(b) 条附加署名文本

最终 NOTICE 建议采用经过法律复核的英文主文本，中文只作为说明。拟定合同如下：

```text
Additional Terms under GNU AGPL v3 Section 7(b)

Any original or modified version of the Program that provides a web user
interface must preserve a clearly visible attribution notice in the global
footer of normal user-facing pages:

    Powered by NextBuf

The name "NextBuf" must be a hyperlink to the canonical official project
repository identified in this NOTICE file.

The attribution notice must not be removed, hidden, obscured, or rendered
substantially less visible than other ordinary text in the same footer area.
Deployers may add their own copyright notices, branding, and links, but may
not remove, replace, or disable the attribution required above.
```

发布前必须由熟悉开源许可证的律师检查该附加条款是否属于 AGPLv3 第 7(b) 条允许的合理法律通知或作者署名要求。法律复核可以调整措辞，但不能改变“保留可见页脚官方链接”的产品决定。

## 4. 源码提供与原项目链接是两件事

`Powered by NextBuf` 链接指向原始官方项目，用于来源署名。

修改版运营者还必须按照 AGPL 提供其实际运行版本的对应源码。只链接原始 NextBuf 仓库，不能替代修改版源码提供义务。修改版可以另外提供：

```text
Powered by NextBuf · Source Code
```

其中 `Source Code` 指向该部署实际修改版本的源码或有效源码提供方式。

## 5. 代码实现要求

### 核心布局

- 署名组件位于核心 `src/components/layout`。
- 前台、账号中心、后台和特殊布局复用同一法律署名原语。
- 官方 URL 由构建时常量生成，不读取可由站长修改的数据库设置。
- 单元测试验证文本和 URL，E2E 验证主要布局可见。

### 主题与插件

- 主题可以改变页脚布局和视觉，但必须保留署名文本、链接和合理可见性。
- 插件不能注册“移除版权”能力，也不能覆盖法律署名组件。
- 插件市场拒绝以隐藏、替换署名为主要用途的插件。
- 管理后台不得提供“关闭 Powered by NextBuf”设置。

### 测试

至少覆盖：

- 桌面与移动首页。
- 主题页和用户页。
- 登录、注册和错误页。
- 管理后台。
- 自定义主题。
- 无 JavaScript 或脚本加载失败时的服务端 HTML。

## 6. 仓库文件

公开仓库至少包含：

```text
LICENSE        标准、未经修改的 AGPLv3 完整文本，并指向 NOTICE
NOTICE         第 7(b) 条署名、官方 URL、版权主体和第三方通知
README.md      简明许可证和页脚署名说明
CONTRIBUTING.md
```

标准 AGPL 正文不能被随意删改。项目自定义条款单独放入 NOTICE，并在 LICENSE/README 中明确提示。

由于存在自定义附加条款，不能只展示一个让用户误以为“没有附加条款”的许可证徽章。package metadata 的最终写法应在发布前通过许可证扫描工具验证；必要时使用 `SEE LICENSE IN LICENSE` 并确保 LICENSE 明确引用 NOTICE。

## 7. 版权与贡献

建议版权声明：

```text
Copyright (c) 2026 NextBuf contributors.
```

项目采用 DCO 1.1。贡献者通过 `Signed-off-by` 声明有权提交代码，不转让版权，也不签署 CLA。

该方式适合长期保持 AGPL 开源的社区项目，但项目所有者以后不能当然地把所有贡献改为闭源许可证。若未来考虑整体再许可，需要取得相关贡献者同意。

## 8. 商标与品牌

软件许可证不等于商标授权。后续应建立简短商标政策：

- 允许为满足署名要求使用文字名称 NextBuf。
- 未经许可不得让修改版冒充官方版本。
- Fork 可以使用不同社区品牌，但仍保留 `Powered by NextBuf` 来源署名。
- Logo 的修改、商品化和官方认证规则另行规定。

第 7(b) 条应同时要求修改版不得错误陈述软件来源。

## 9. 第三方依赖

- 引入依赖前检查许可证是否与 AGPLv3 组合兼容。
- 直接依赖的版权和 NOTICE 要求进入第三方许可证清单。
- 不引入禁止商业使用、禁止托管或来源不清的软件包。
- 前端字体、图标、图片和示例内容同样需要许可证记录。
- 自动许可证扫描只能辅助发现问题，不能替代人工处理不明确条款。

## 10. 插件 SDK 的未来许可

V1 整个仓库先采用统一许可证，避免过早拆分。

V3 插件系统开发前评估：

- 核心继续 AGPL-3.0-only + 第 7(b) 条署名。
- 独立 SDK、类型包和纯 API 客户端可以采用 Apache-2.0，降低第三方集成门槛。
- 进程内插件是否构成核心衍生作品需要结合插件 API 和法律意见判断。
- 通过公开 HTTP/Webhook API 的外部程序通常具有更清晰的独立边界。

插件许可不能允许插件删除核心页脚署名。

## 11. 发布前许可证检查

- 官方项目名称和仓库 URL 已确定。
- LICENSE 包含完整标准 AGPLv3 文本，并引用附加 NOTICE。
- NOTICE 的英文条款完成法律复核。
- README、package metadata 和徽章没有遗漏附加条款。
- 全局页脚在所有主要布局可见并链接正确。
- 没有后台设置、主题或插件能够关闭署名。
- DCO 校验已经启用并写入贡献流程。
- 第三方依赖许可证清单已生成并人工检查。
- 商标政策至少说明官方版本和 Fork 的名称使用方式。

## 12. 参考项目选择

| 项目 | 许可证 | 对 NextBuf 的启示 |
| --- | --- | --- |
| [new-api](https://github.com/QuantumNous/new-api/blob/main/LICENSE) | AGPLv3 + 第 7 条署名/原项目链接 | 与 NextBuf 保护网络修改和来源署名的目标最接近，但 NextBuf 不照搬其具体文案 |
| [sub2api](https://github.com/Wei-Shaw/sub2api/blob/main/LICENSE) | LGPLv3-or-later | 弱 Copyleft 更适合库；README 的“无商业授权”表述容易与 LGPL 允许商业使用产生冲突，NextBuf 不采用这种写法 |
| [Rhex](https://github.com/lovedevpanda/Rhex/blob/main/LICENSE) | MIT | 采用门槛低，但允许修改后闭源托管，不符合 NextBuf 的回馈目标 |
| [Discourse](https://github.com/discourse/discourse/blob/main/LICENSE.txt) | GPLv2 | 分发修改版时保护源码，但纯网络托管通常不触发源码提供 |
| [Flarum](https://github.com/flarum/framework/blob/main/framework/core/composer.json) | MIT | 有利于宽松扩展生态，但不能要求托管修改回馈 |
| [NodeBB](https://github.com/NodeBB/NodeBB/blob/master/LICENSE) | GPLv3 | 强 Copyleft，但缺少 AGPL 的网络交互条款 |
| [Forem](https://github.com/forem/forem/blob/main/LICENSE.md) | AGPLv3 | 社区网络程序采用 AGPL 的直接参考 |
| [Mastodon](https://github.com/mastodon/mastodon/blob/main/LICENSE) | AGPLv3 | 联邦网络服务采用 AGPL，防止托管修改完全闭源 |

结论：NextBuf 是长期运行在网络上的社区程序，AGPL 比 MIT、LGPL 或普通 GPL 更符合“允许商业使用，但修改后的服务端代码继续开放”的目标。第 7(b) 条附加署名用于保留原项目链接，不能扩张成禁止商业使用。
