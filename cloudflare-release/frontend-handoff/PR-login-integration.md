# 前端 PR：统一登录页集成（候选，未发布）

分支 `frontend/claude-login-integration-20261112`，基于：
- `frontend/claude-login-candidate-20261112`（a10f490，交接稿）
- `claude/reproducible-860bea19`（a7b1578，可从源码逐字节重建生产 860bea19）

**禁止自动合并。未部署，未改动 Neon，未改后端 Worker 代码。**

## 改了什么

| 文件 | 改动 |
|---|---|
| `web/login.html` | 由交接候选稿生成，生成脚本是 `frontend-handoff/integrate-login.cjs`。每处修改都必须唯一匹配，否则脚本直接失败。 |
| `scripts/build.cjs` | 新增 `--candidate` 模式：跳过生产摘要校验，不写 `release-manifest.json`，产物输出到 `artifacts/candidate-build/`，不进入 `dist/`。默认构建仍只认生产 860bea19。 |
| `qa/login-page.cjs` | 新增登录页验收，共 16 项，覆盖电脑和 iPhone 13。 |
| `scripts/acceptance-release.cjs` | 新增 `login-page` 套件。 |
| `frontend-handoff/screenshots/` | 电脑登录、注册，手机登录、找回密码，管理员登录，共 5 张截图。 |

构建产物与生产包对比：后端代码、电脑页、手机页、后台页、新运营工作台**全部与 860bea19 逐字节一致**，只有登录页不同。

## 相对候选稿的修正（全部恢复生产已有行为）

- 保留现有测试和功能依赖的元素编号：`#email`、`#password`、`#loginBtn`、`#otp`、`#regEmail`、`#regPassword`、`#regBtn`、`#inviteCode`、`[data-tab=register]`。
- 找回密码恢复为生产流程：申请 → 管理员发放 6 位重置码 → `/api/auth/password-reset/confirm` 设置新密码。候选稿只发申请，还提示“重置说明将发送到邮箱”，与后端实际行为不符。
- 恢复 `?next=` 安全跳转，并额外拒绝 `/\evil.example`。**现行生产登录页会把这种地址解析为 `https://evil.example`，属于登录后的开放跳转。**本分支已修复，并有测试覆盖。
- 恢复以下生产行为：已有会话直接进入工作区；记录手机和管理员入口标记；在 nuvexapro.com 清理地址栏；注册后自动登录；显示服务器返回的错误信息（例如账户受限）；保留 Cloudflare 统计脚本。
- 注册规则读取失败时，与生产一致：允许继续注册，邀请码作为可选项，由服务器判定。候选稿会直接拦截注册。
- 删除装饰 K 线上的“最新价”数字标签，避免被当作真实报价。
- 管理员模式：副标题改为“管理员账号 · 需要 2FA 动态码”，中英切换后仍保持管理员文案；隐藏“记住我”、注册和找回密码。
- 修正候选稿 CSS：`font:16px/1 inherit` 是无效写法，输入框因此退回约 13px，iOS 聚焦时还会自动放大页面。现统一为 16px。
- 注册时邮箱格式错误，提示改为“邮箱格式不正确”。候选稿此处显示的是账号格式文案。

会话机制未改：`session-transport.js` 仍由构建注入，登录走 HttpOnly Cookie，`localStorage` 只保存 `cn-cookie-session` 标记。

## 待你决定

- **品牌**：页面文字仍是 CN Capital，与生产一致；候选稿标题写的是 NUVEXA，已恢复为 CN Capital。是否统一切换为 NUVEXA 需要你确认。
- 开场动画为 3.5 秒，可点击跳过；系统设置“减少动态效果”时为 0.3 秒。这是候选稿的设计，未改动。
- 手机 App 内的登录表单（`mobile-client` 的 `#auth-form`）本次没有改。手机访问 `nuvexapro.com/` 进入的是 App 内的表单；这个独立登录页面向电脑和管理员域名。

## 测试结果

见下方“验收记录”。
