# 跨窗口协作监控（GitHub Issue #42）

## 目的与边界

本机制用于**自动收集代码级协作证据**，不负责唤醒独立 ChatGPT 会话、不自动领取开发任务、不自动执行代码、不进行生产部署、数据库迁移或资金业务写入。各执行窗口必须主动阅读 Issue #42，按职责完成工作并提交 ACK/结果。

## 组成

- `.github/workflows/cross-window-monitor.yml`：每 6 小时及手动触发；计划任务只有进入 GitHub 仓库**默认分支**时才真正定时运行。
- `scripts/cross-window-monitor.mjs`：读取 Issue #42、历史 ACK、负责窗口分支当前 SHA、对应 SHA 的 GitHub Actions 运行结果。每次最多**创建或更新一条** `github-actions[bot]` 评论；相同证据不重复写入。
- `test/cross-window-monitor.test.mjs`：验证 ACK 识别、旧 SHA 的 CI 不误算作新 SHA、Closed 状态保持与评论去重。
- `GITHUB_TOKEN`：GitHub Actions 内建令牌；无需数据库连接、生产密钥、用户私有 PAT 或外部云凭证。

工作流拥有 `contents:read`、`actions:read`、`issues:write`。其中 `issues:write` 仅用于更新 Issue #42 的一条证据评论。Issue 当前 Closed，工作流不得自动更改 state。仓库 Actions 权限策略如限制 issue 写权限，工作流会失败并保留清晰日志，不能宣称发布成功。

## 上线验收门禁

1. 审核独立 PR，仅包含这四个新增文件；不修改现有前后台源码、资金业务或公共认证接口。
2. CI 必须运行 `node --test test/cross-window-monitor.test.mjs` 并通过；审查工作流权限。
3. 获得明确批准后合并到仓库默认分支 `dev/platform-v1`。GitHub Actions 定时计划仅在默认分支生效，合并前需重新读取 Issue #42 最新评论。
4. 使用 GitHub Actions 的 `workflow_dispatch` 手工运行 `Cross-window coordination evidence monitor`，确认真实成功，并在 Issue #42 检查有且只有一条包含标记 `gsp-cross-window-monitor:v1` 的机器人评论。
5. 在没有新证据时再次手工运行，日志应显示 `Dashboard unchanged`，不得增加新评论。
6. 再观察真实定时运行历史，确认计划任务已触发；Actions 可能延迟或被停用，并非持续在线代理。

## 已知限制

- 默认只监控六组已知工作窗口分支和 GitHub ACK 文字；新窗口或分支需更新配置。
- CI 成功不代表授权真实 API、数据库权限、资金、行情及交易验收；P0 阻断不会被机器人自动解除。
- Issue #42 虽然 Closed，若未锁定仍可评论；若 GitHub 拒绝写入须报告实际错误。
- 此工作流**无法向其他独立 GPT 聊天窗口发送唤醒消息**。执行窗口需用户启动，或另配独立已授权的持续执行代理。
