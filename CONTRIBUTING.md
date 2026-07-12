# Contributing to NextBuf

感谢参与 NextBuf。提交代码前请先阅读 [项目现状与交接](./docs/14-project-status-handoff.md)和当前版本的[详细开发计划](./docs/09-detailed-development-plan.md)，不要把未来版本功能提前加入当前里程碑。

## 开发流程

1. 从最新 `main` 创建短期功能分支。
2. 保持变更范围单一，并同步更新相关测试和文档。
3. 运行 `pnpm check` 和 `pnpm build`。
4. 使用 DCO sign-off 提交。
5. 创建 Pull Request，说明行为、测试和迁移影响。

## Developer Certificate of Origin

项目采用 [Developer Certificate of Origin 1.1](https://developercertificate.org/)。每个提交必须包含：

```text
Signed-off-by: Your Name <your.email@example.com>
```

推荐使用：

```bash
git commit -s -m "feat: describe the change"
```

sign-off 表示你有权按照项目许可证提交该贡献。它不是 GPG 签名，也不要求转让版权。

在 GitHub 仓库启用 DCO App 后，缺少 sign-off 的 Pull Request 将不能合并。

## 代码边界

- 不拆分顶层 `frontend/` 和 `backend/`。
- 页面与路由放在 `src/app`，界面组件放在 `src/components`。
- 领域规则放在 `src/modules`，外部技术实现放在 `src/infrastructure`。
- Worker 入口放在 `src/worker`，不得复制 Web 业务逻辑。
- Client Component 不得导入数据库、Redis、队列或密钥代码。
- 不得删除或弱化 `Powered by NextBuf` 法律署名。

## Pull Request 要求

- 权限、数据、API、配置或部署变更必须更新文档。
- 新依赖需要说明用途、维护状态和许可证。
- 数据库迁移进入公开版本后不得修改历史文件。
- 不提交 `.env`、密码、Token、用户数据和本地调研目录。
