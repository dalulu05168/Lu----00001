# 交易前台数据接口对接核查（2026-11-08）

## 范围及核查依据
仓库：dalulu05168/Lu----00001。以并行开发的 `dev/remove-hk-my-markets-20261108` 为代码基线；目标只保留 US 美股及 CN 中国内地市场。UI 预览文件只是设计参考，不能作为真实账户、交易或行情数据源。此文仅做代码审计与接口交接，不代表生产上线、浏览器端到端测试或真实券商对接通过。

## 已有接口与调用链
| 功能 | 服务端路径 | 后端文件 | 当前前台状态 |
|---|---|---|---|
| 用户注册 | POST /api/auth/register | src/http-api.mjs, src/account-service.mjs | web/app.mjs 在统一入口调用；注册资金默认 0；邀请码依赖数据库策略 |
| 用户登录 | POST /api/auth/login | src/account-service.mjs, src/auth.mjs | web/app.mjs 登录并存 sessionStorage gsp_token；密码由服务端验证 |
| 用户退出 | POST /api/auth/logout | src/http-api.mjs | 桌面和移动端桥接脚本调用并清会话 |
| 获取账户 | GET /api/account | src/account-service.mjs | desktop-bridge.mjs 和 cn-terminal-bridge.mjs 调用；需 Bearer token |
| 证券目录 | GET /api/catalog | src/admin-http.mjs | 旧版 web/app.mjs 已调用；新版桌面、移动桥接尚未完整接入 |
| 自选股 | GET/POST/DELETE /api/watchlist | src/watchlist-service.mjs | 旧版 web/app.mjs 已调用；新版桌面、移动桥接尚未完整接入 |
| 订单创建（内部账本） | POST /api/orders | src/http-api.mjs, src/order-service.mjs | 目前可信定价网关未配置，服务器拒绝订单 |
| 健康/就绪 | GET /api/health, /api/ready | src/http-api.mjs, src/readiness.mjs | 健康状态不等于 PostgreSQL 或真实业务就绪 |

注册请求 `{email,password,inviteCode?}`；登录返回 `{token,expiresAt}`。账户返回 `{account:{id,cashCents,currency},positions,orders,disclosure}`；余额是美分整数，订单包含 `price_cents`、`amount_usd_cents`、`created_at`，查询只覆盖最近 100 笔。持仓当前不提供经核实的成本价和实时市值，前台应显示“—”，不能编造盈亏和资产总值。

## 新版前台的实际缺口
1. 桌面端 `web/desktop.html` + `web/desktop-bridge.mjs` 与移动端 `web/cn-terminal.html` + `web/cn-terminal-bridge.mjs` 当前主要通过 Bearer GET /api/account 同步账户；目录、自选股的同步和提交还要连接。
2. 新版页面的旧式 `placeOrder` 逻辑与后端合同不一致：页面用中文方向、`qty`，却缺少 `market`、`quantity`、Bearer 和 `Idempotency-Key`。不可通过简单设置 `TRADING_ENABLED=true` 解锁。
3. 服务器 `src/server.mjs` 及 `api/[...path].mjs` 的 `resolveExecutionPrice` 尚为 undefined，且没有券商路由。前台必须继续禁用下单，不应显示已真实成交。
4. 充值、提现、KYC 图片上传、银行卡绑定、客服消息尚无正式可信客户接口；新版分支主要保持不可用，不能在浏览器伪造提交成功、申请历史或客服回复。
5. TradingView 小组件仅用于第三方图表展示，不能作为下单执行价格来源；没有授权行情和汇率时不生成随机 OHLC、成交量、盈亏。
6. 会话过期应清除 token 并回到登录；每次刷新需以服务器响应为准。应共用 /api 客户端，并统一 401、503、204 与异步竞态处理。
7. `/desktop.html?preview=1` 为只读 UI 预览，不访问真实账户 API；不能当作真实交易前台验收。
8. `db/006_supported_markets_us_cn.sql` 已加入迁移代码，发现旧 HK/MY 数据会拒绝迁移，避免破坏历史；尚未验证数据库上已执行。

## 分工建议与接口补齐次序
P0：保持服务端价格权威与下单关闭；确认账号隔离和真实数据库，不得用前台状态充当认证。
P1：前台统一请求客户端（Authorization Bearer、缓存禁用、401 退出、504/503 等失败提示），将 `GET /api/catalog` 和 `GET/POST/DELETE /api/watchlist` 接入桌面和移动端；查询成功回读，不凭本地状态声明保存成功。
P1：账户页面严守服务端字段，不要混淆市场代码；订单列表标示“最近 100 条”而不是“全部历史”。
P2：需要后端定义分页订单历史、持仓成本/币种/估值时间、申请/KYC/银行卡/客服 API 的正式合同。
P3：只有在具备合规的授权行情及券商订单路由、权限控制、审计、对账和测试之后，才讨论真实交易启用。

## 需另一个窗口的后端 GPT 核实
- PostgreSQL 是否实际完成 001–006 迁移？只报迁移状态，不共享密码。
- 是否有 `GET /api/orders` 分页接口和统一订单状态定义？若无请确认待开发。
- 是否准备提供经核实的成本价、市值、盈亏和报价时间戳？若无前台保持空值。
- 充值、提现、身份审核、银行账户、客服消息是否有已实现接口？请给出路径与真实返回结构，不能只写 UI 设计字段。
- 是否配置真实授权 US/CN 行情、FX 与券商路由？若无保持交易关闭。

## 验收项（目前未执行）
1. 新用户注册后余额为零；错误账号/密码不得登录。
2. 会话过期/退出后接口返回 401，账号 A 无法访问账号 B。
3. 前台桌面/移动都显示真实账户、持仓、最近 100 笔订单；无预设虚假数据。
4. 新版目录和自选的保存、刷新、退出重进均使用真实 API。
5. 不具备授权定价时订单 503，资金、订单、持仓均不变。
6. HK/MY 在服务器端拒绝且迁移不删除旧数据。
7. 在受控部署上运行浏览器测试、PostgreSQL 集成测试，记录具体结果。

**当前验证边界：** 已读取仓库源码与 Vercel 预览部署元数据；尚未运行单元/集成/浏览器测试，不声称生产域名或全部接口已接通。
