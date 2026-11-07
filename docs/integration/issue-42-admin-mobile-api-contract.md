# Issue #42 — 后台端给独立手机端的安全 API 对接契约

> 负责人：管理后台执行窗口。适用代码基线：`dev/restore-four-role-platform-20261103`。此文档是已核查代码的接口契约和验收步骤，不是手机端已经接通的声明。不要放入账户密码、Session Token、Render 环境变量或数据库连接串。

## 1. 实际部署边界与阻塞

- `global-stock-qa-preview`：Render **Node Web Service**，具有 `src/http-api.mjs` 路由、PostgreSQL 会话验证与 `/api/*` 处理能力。请按 Render 的 **实际部署 SHA** 单独核对，不因同名静态站返回 200 就认定登录功能可用。
- `nuvexa-mobile-ui-preview-20261107`：Render **Static Site**，只有页面文件；没有 Node API 服务，**不可能**凭静态站自身处理 `/api/auth/login` 或 `/api/account`。在 API 接入前只允许验证 UI、CSS、JS 与设备布局，不得用模拟余额或伪造会话宣称“已登录”。
- `admin.nuvexapro.com` 是管理后台登录入口，**不要**用它作为手机端的 API 跨域源。现有客户电脑/手机代码都以 `fetch("/api"+path)` 的**同源相对路径**调用服务端。

## 2. 已由后端源码确认的 HTTP 合约

| 方法 | 路径 | 权限 | 成功响应或用途 | 失败情况 |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | 公共，只读 | `status:"alive"`，包含 `brokerConnected`/`pricingConnected`，**不等于业务可用** | 服务不可达 |
| GET | `/ready` 或 `/api/ready` | 公共，只读 | HTTP 200：`status:"ready",database:"connected"` | HTTP 503：未就绪或数据库不可达 |
| POST | `/api/auth/login` | 有效客户账户的邮箱/密码 | HTTP 200：`{token,expiresAt}`，Token 是客户端会话 | HTTP 401：无效登录；请求格式错误 HTTP 400；可能触发限流 |
| GET | `/api/account` | `Authorization: Bearer <客户会话token>` | `{account:{id,cashCents,currency},positions,orders,disclosure}` | HTTP 401：无会话或失效；管理员会话访问客户接口 HTTP 403 |
| GET | `/api/watchlist` | 客户会话 | `{items:[...]}` | HTTP 401：未认证 |
| GET | `/api/internal-products` | 客户会话 | 后台真实公开产品目录，不是行情实时报价 | HTTP 401：未认证 |
| GET | `/api/stock-quote` | 客户会话 | 仅可用真实已配置且校验过的报价 | 缺失有效报价时返回 503，不可自行生成成交价 |
| POST | `/api/orders` | 客户会话；另需有效 `idempotency-key` | **平台内部**订单记账，非券商真实成交 | 无有效交易价格源时 HTTP 503、不得代填价格 |

注意：管理端另有 `/api/admin/login` + `/api/admin/totp/verify`，**不适用于客户手机登录**，不能混用管理员 Token 和客户 Token。客户端登录路径在 `src/http-api.mjs`，会话形态在 `src/account-service.mjs` / `src/auth.mjs`，管理员鉴权在 `src/admin-http.mjs`。

## 3. 给手机窗口的可执行接入方案（无需任何生产凭证）

1. 总指挥指定**隔离 QA 环境**并核实服务 SHA；使用与正式账户数据隔离的 PostgreSQL。当前仓库 `.github/workflows/test.yml` 通过 PostgreSQL 16 CI Service 做集成测试，可作为授权样板。**不要把生产 DATABASE_URL/ADMIN_TOTP_KEY/密码写入静态站环境变量或 Issue。**
2. 让手机预览的 `/api/*` 实际到达受控的 Node Backend：优先把手机页面部署到有同源 `/api/*` 的 Node 服务并保留 `/mobile.html` 路由；若必须独立静态域名，先经总指挥批准一个 HTTPS 同源反向代理（包含方法、请求体、Authorization、状态码透传，禁用缓存），并配置明确的访问控制。**静态站本身没有服务器路由；不应靠前端暴露数据库地址或跨域拼接生产 Token。**
3. 在隔离 QA 数据库中创建专用测试客户（邀请流程如适用），把凭证安全地交给实际验收者；**不得在 GitHub/Issue/聊天中粘贴密码、Token 或 TOTP Secret**。不要复用真实客户/管理员账户。
4. 手机负责人在**同一源**按顺序验证：
   - `GET /api/health` → HTTP 200 且 `status=alive`；
   - `GET /ready` → HTTP 200 且 `status=ready`；
   - `GET /api/account`（无 Token）→ HTTP 401；
   - `POST /api/auth/login`（授权的测试客户）→ HTTP 200，得到真实会话；
   - `GET /api/account`（Bearer 测试 Token）→ HTTP 200，取到真实测试数据；
   - 手机上的 `web/mobile-entry.mjs` 仅在登录成功且工作台显示后跳转 `/mobile.html`；`web/mobile.mjs` 不通过验证即清除 Token 返回入口；
   - 不具备合规可靠报价时验证交易按钮的**禁用/拒绝**，不可写入假价格或账户余额。
5. GitHub PR 中仅保存**脱敏**的截图、HTTP 状态码、测试用例、实际部署 SHA、失败日志及复现步骤。**不需要真实银行付款、真实券商下单或客户身份资料。**

## 4. 管理后台现有权限/审批隔离验收依据

现有 `test/postgres-integration.test.mjs` 在 GitHub Actions 独立 PostgreSQL 中执行真实 HTTP 路由和数据库，覆盖：
- MASTER 密码及 TOTP 两步认证、SUBADMIN 两步认证、错误凭据/未授权身份拒绝；
- 子账户邀请码、客户归属、跨子账户查询 404 与审计；
- SUBADMIN 不可批准入账/修改仅 MASTER 可修改的证券与客户策略；
- 资金申请状态转移、MASTER 确认后才记入**平台内部**余额、并发防重记账、出金绑定银行卡条件；
- 禁止用管理员 Token 访问客户账户，以及禁止客户 Token 访问管理员模块。

`test/admin-ui-action-wiring.test.mjs` 通过隔离 JS DOM 模拟核实资金记录→审批中心、15 个表单及按钮事件；`scripts/admin-browser-shell-smoke.mjs` 在隔离 Chromium 中验证 10 个后台模块与主账户界面。它们**不是生产 MASTER/SUBADMIN 真实账号登录验收**。

## 5. 交接状态

- 后端端点及安全边界：已从实际仓库源码核对。
- 隔离 PostgreSQL + 2FA/权限/资金回归：已有自动化，单次结果必须引用当前 SHA 的 GitHub Actions 日志。
- 独立手机静态预览的真实 API：**未验收，需总指挥指定部署/代理方案**。
- 真实生产管理员/客户登录：**未执行**；须经总指挥批准隔离测试账户和业务范围。
