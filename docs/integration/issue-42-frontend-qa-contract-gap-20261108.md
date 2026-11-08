# Issue #42｜交易前台与共享 QA 的接口差异、只读核查和验收门禁（2026-11-08）

> **范围**：本文件仅审计前台 API；依据 GitHub 实际读取的仓库分支文件及 Issue #42 评论。没有修改其它窗口源文件、Neon/Render/Vercel 生产资源，也没有取得授权测试账户完成在线状态写入。不得将静态源码/CI 当业务验收。

## 1. 本轮审计基线

- 前台独立分支：`dev/frontend-api-readback-contract-20261108`，从 `dev/frontend-phase2-session-catalog-20261108` 派生；本轮先修复 `web/client-data-api.mjs` 的回读确认，并补充 `test/client-data-api.test.mjs` 的服务端未持久化与回读失败两种场景。
- 原前台父分支：`dev/frontend-phase2-session-catalog-20261108` @ `3d6b1c88c641695f5bea8e9782632b284da3fd7c`，隔离 CI [42430474905](https://github.com/dalulu05168/Lu----00001/actions/runs/42430474905) = success（108 total / 88 passed / 20 skipped / 0 failed，独立 PostgreSQL 通过）。
- 共享 QA 源码的只读对照分支：`dev/restore-four-role-platform-20261103`，此前审计基线 `0368652392781a2959d0bbab83eb619bb8026e11`。**此分支不是已核实的生产部署版本**。
- Issue #42 最新审计强调 Neon main 只迁移至 005，另一 QA 镜像库已有**不同的一套 001–022**；目标数据库和 QA 部署来源待总控指定。

## 2. 各路径的实际接口兼容性

| 功能 | 本前台的调用与字段 | 共享 QA 源码核查 | 结论 |
|---|---|---|---|
| 注册 | `POST /api/auth/register`，`email/password/inviteCode?` | QA `src/http-api.mjs` 使用同一路由；受 `registration_policy` 影响 | 代码级基本兼容；QA 数据库的政策值和邀请码归属需实测 |
| 登录 | `POST /api/auth/login`，返回 `token/expiresAt` | QA `src/account-service.mjs` 返回相同结构，且排除管理员、检查客户登录权限 | 代码级兼容；未经真实 QA 登录验收 |
| 账户 | Bearer `GET /api/account` | QA 返回 `account/positions/orders/disclosure`，其中 `orders` 最多 100 笔 | 主要字段兼容；不能以内部订单冒充券商成交 |
| 客户登出 | Bearer `POST /api/auth/logout` | QA 认证层提供撤销；需检验历史令牌 401 | 代码级兼容；缺在线 E2E |
| 目录 | Bearer `GET /api/catalog`，`items[{itemType,market,symbol,name}]` | QA `src/admin-http.mjs` 将公开目录路由设为 GET，按登录会话查询已发布产品；返回同名字段 | 字段兼容，但市场范围冲突（见下） |
| 自选 | Bearer `GET/POST/DELETE /api/watchlist`，`{market,symbol}` | QA `src/watchlist-service.mjs` `MARKETS` 为 **US/RO**；本前台客户端 `MARKETS` 为 **US/CN** | **P0：不能把 CN 自选持久化在未经升级的 QA 后端** |
| 资金、KYC、客户支持 | 本分支新前台未开放完整业务提交 | QA `src/http-api.mjs` 已有 `/api/requests`、`/api/private-data`、`/api/support`、`/api/internal-purchases` 等接口 | **不可用旧前台基线覆盖 QA**，也不能把这些已有接口一概描述为“整个项目不存在” |
| 管理员 2FA | 不在本前台职责内 | QA 后台为两阶段 `/api/admin/login` → `/api/admin/totp/verify` | 不改变、不混淆管理员/客户会话契约 |

## 3. 仅属于本窗口的修正

`web/client-data-api.mjs` 在 POST/DELETE 自选后发出 **GET 回读**，对比目标 `market:symbol` 是否达到期望状态。写入响应 200 但回读未确认时抛 `WATCHLIST_NOT_CONFIRMED`；回读失败时抛 `WATCHLIST_READBACK_FAILED` 并提示需要刷新核查，不向页面返回“保存成功”。这仍只是客户端防误报：**没有证明远端数据库真正持久化**。

`test/client-data-api.test.mjs` 新增：服务端返回成功但未新增、成功但未删除、回读 503 时不得声明保存成功。运行命令：`node --test test/client-data-api.test.mjs`；全量 CI 从 `npm test` 触发，最终运行号和输出在本 Issue 后续回报中填写（不能提前声称成功）。

## 4. 真实 QA 验收路径（当前仍缺授权环境）

最小独立、非生产测试链路：
1. 总控**明确单一 QA Node 部署 SHA、QA URL、专用数据库分支及当前迁移集**；确认对 US/CN 的市场约束和授权账号，不向静态网页注入数据库连接串。
2. 在仅供测试的 QA 数据库注册两个随机客户（根据已获批准的邀请码/客户政策），错误密码/未知用户必须返回 401；两人互不访问数据。
3. A、B 分别登录，Bearer GET /account、GET /catalog、GET /watchlist；A POST/GET/DELETE/GET 其 US/CN 自选，B 看不到 A 的证券，刷新与重新登录不丢失。
4. A 登出后旧 token 返回 401；历史过期会话不能读取账户、目录、自选。不给任何真实客户账户写入资金或订单。
5. 在真实浏览器桌面/手机 UI 验证空态、两市场代码、跨刷新同步；有授权展示许可前行情无假价格，订单下单继续禁用。
6. 收集 HTTP 状态码、时间、QA URL、服务 SHA、数据库分支和迁移版本、无密钥日志；由总控决定后续整合。

**实际阻断**：目前 Vercel 预览虽然显示 READY，但当前连接访问其受保护页面、`/api/health`、`/api/ready` 返回 403，未取得可验证的真实 QA 浏览器会话；Render MCP 要求用户指定工作空间，不能自行从多工作空间中选择；Neon 迁移冲突尚未解除。因而在线联调明确标为 **未验收**。

## 5. 跨窗口变更范围及需要的确认

- 本轮新增修正**只发生在** `web/client-data-api.mjs`、`test/client-data-api.test.mjs` 和本文件，未触碰 `src/http-api.mjs`、`web/desktop.html`、`web/mobile.*`、`web/index.html`、后台、数据库或交易执行。
- 请总控给出：整合目标源码分支和 SHA、可授权的 QA 服务 URL、数据库分支/迁移、US/CN 产品目录与旧 QA 的 RO 迁移路径；确认最小前台 API 补丁的 cherry-pick 范围，避免覆盖 QA 旧有业务能力。
- 需要后台负责人：确认 QA `MARKETS=US/RO` → US/CN 的合法迁移及数据兼容策略、邀请码要求和可用于隔离测试的客户注册政策，不在本前台分支作数据库写入。
