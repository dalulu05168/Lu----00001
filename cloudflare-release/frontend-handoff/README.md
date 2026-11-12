# NUVEXA 客户前台 / 手机端 · Claude 交接

## 责任分工

- **Claude：** 客户电脑前台、手机端、统一登录页的前端页面与交互；与既有认证 API 的适配、前端测试。
- **Codex：** 管理后台、Worker 后端/API、Neon 数据库、权限与交易资金逻辑。若前端必须改动后台契约，先提出接口需求并交给 Codex，避免双边同时编辑同一后端文件。
- 部署：Cloudflare Workers `lu----00001`；客户共用域名 `https://nuvexapro.com/`，后台 `https://admin.maacropierce.com/`。
- 唯一代码仓库：`dalulu05168/Lu----00001`。不要建立重复仓库/项目。

## 本次已推送的交接产物

`cloudflare-release/frontend-handoff/web/login.html` 为用户提供的 `login (1).html` 改造的 **前端登录候选稿**。它使用 API 请求而不是定时器伪造登录成功，包含登录、注册、忘记密码及管理员 TOTP 的候选 UI。

**尚未集成、尚未部署。** 它放在 `frontend-handoff/` 隔离目录，不会被当前 `npm run build` 自动打包。正式页面仍是 `cloudflare-release/web/login.html`。不要仅复制候选页面并发布。

原始候选页面包括部分 **CN CAPITAL** 视觉文字，需与 NUVEXA 品牌要求核对再处理。不要误把这一候选视为已经完成的正式品牌切换。

## 必须与真实项目核对的接口

- 客户登录：`POST /api/auth/login`
- 注册：`GET /api/registration-policy`, `POST /api/auth/register`
- 找回密码：`POST /api/auth/password-reset/request`
- 管理员认证：`POST /api/admin/login`，包含六位 TOTP（由 Codex 负责后端维护）
- 客户认证验证：`GET /api/account`
- 管理员认证验证：`GET /api/admin/me`

生产项目的 `scripts/build.cjs` 会把 `web/session-transport.js` 注入页面，登录后使用 HttpOnly Cookie 和 `cn-cookie-session` 标识；不要删除、绕开或手动读取 Cookie。已有 `session-transport.js`、`browser-sessions.js`、CSRF 和管理员权限机制必须保留。对于现有浏览器 token 兼容逻辑，避免新增明文 token 日志。

## Claude 下一步可直接执行的前端任务

1. 在 **新的独立开发工作区** checkout 本分支。优先确认它与 `backup/prod-860bea19-20261112` 备份分支之间的差异。
2. 将候选 UI 与 `cloudflare-release/web/login.html` 进行差异合并，保留会话注入、客户与手机端分流、管理员登录域名识别和原有功能。必要时将管理员 UI 与客户 UI 分离；后端契约由 Codex 管理。
3. 以真实 Worker 源码与**本地隔离 PGlite** 执行认证、注册、管理员 TOTP、密码重置、401/429、网络故障、Cookie/CSRF、手机与电脑视口测试，不访问生产数据。
4. 若另一个分支已达到可复现构建标准，在合适的协作分支中整合；绝不能从旧 `build.cjs` 意外回滚当前生产功能。
5. 形成明确的前端 Pull Request（禁止自动合并），附提交 SHA、截图、真实测试结果及已知问题。
6. 在人工审批之前，不允许直接部署 Cloudflare、合并正式分支、改写 Neon 生产数据库。

## 当前验证边界

- 已在独立浏览器模拟 API 的测试中运行 6 项，均通过：邮箱校验、拒绝错误密码、登录响应处理、管理员 TOTP 字段、注册邀请码、密码重置请求。
- **上述 6 项不等于与真实 Worker/Neon 联调通过。**
- 已执行基本敏感信息扫描；不是全面安全审计。
- 当前线上生产构建版本与 GitHub 默认开发版本可能不同，按保存的生产备份基线检查，禁止盲目部署。

## Codex 接手后台时

后台和交易功能单独创建 `backend/codex-*` 分支；避免与 Claude 同时更改 `cloudflare-release/web/login.html`、`cloudflare-release/scripts/build.cjs`。后端 API 变更先同步契约与测试，并通过 PR 交付。
