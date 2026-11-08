# 第二阶段三端 UI 控件 → 业务 API 接口交接（2026-11-08）

> 适用：本 ZIP 的 `前台.html`、`手机端.html`、`后台.html`。本表是**待对接合同**，不是已接通证明。
> 权限边界：窗口 3 接客户数据桥接，窗口 4 接后台原有 API/权限，窗口 6 在七项业务完成后做三端接入。本窗口只负责 UI 结构/未知态安全、图表保真。

## 共同状态规则
- HTTP 401：清空客户私有快照，显示 `—`/“数据未同步”；不可显示上一个账户的资金与持仓。后台必须重新执行管理员两阶段 2FA，不能将客户 cookie 当管理员身份。
- HTTP 403：不可假设成功/静默放行；保留所有页面入口与权限错误，未获授权不得执行。
- HTTP 503 / 网络中断：不把请求失败或缺字段视为真实 0，不展示历史缓存作为当前行情；禁止买入卖出。
- HTTP 200 空对象：**不代表零余额**；仅满足已校验的 `/api/account.account.cashCents===0`（或已明确适配的合法金额字段）才可展示 `0.00`。
- 合法空列表与未知列表必须区分：已验收 200 且 `orders:[]` 是“暂无订单”，缺字段/失败是“数据未同步”。
- 数值币种必须独立确认 USD/CNY，不可把 CN 的价格或股票数目当美元余额。前端禁止自行构造成交价、汇率或盈亏。
- `TRADING_ENABLED=false` 保持。只有服务端真实合法行情、内部成交和数据库回读经总控 QA 验收后才能讨论解锁。

## 电脑版 `前台.html`

| UI 元素 / 脚本字段 | 需要的后端结果或动作 | 当前状态 / 交接边界 |
|---|---|---|
| `[data-b=cash]` / `DATA.cashOverride` | GET `/api/account` → 认证账户 `account.cashCents`（美分）→ 经过安全整数及币种校验除以 100 | 空/401/503=`—`；合法 0=`0.00`。此 ZIP **未直接接此实际 API** |
| `[data-b=total]` / `DATA.totalAssets` | 后端授权行情估值与现金快照，币种一致后端返回总资产 | 不用缓存价格或本地猜测 |
| `[data-b=cost]` / `DATA.holds[].c` | GET `/api/account/analytics` 的 FIFO `positionCostCents`；如无完整持仓成本字段，保持未知 | 不从订单猜成本 |
| `[data-b=realized]` / `DATA.realizedPnl` | `/api/account/analytics` → FIFO `realizedPnlCents`，须 `historyAvailable===true` | 未取得历史数据时不能填 0 |
| `[data-b=traded]` / `DATA.orders[].a` | 服务端完整已提交交易历史及 `volumeCents`，需要明确列表是否完整 | 最近订单不能冒充全量成交额 |
| `[data-b=nord]`、`#tb-ord` | GET `/api/account` 的订单快照或经审核的新全量订单历史路由 | 仅真实返回订单可渲染；订单编号/状态/时间需回读 |
| `[data-b=nhold]`、`#tb-hold` | `/api/account.positions` + 有效 FIFO 成本/可售数量/锁定期 | 不根据 UI 列表模拟真实可售 |
| `#tb-watch` | GET/POST/DELETE `/api/watchlist` | 真实 200 回读后才可切换收藏星标 |
| `[data-b=nreq]`、`#tb-req` | GET `/api/requests`；POST `/api/requests` | 不从点击按钮生成待审批记录 |
| `[data-b=acct]`、`[data-b=sync]` | 授权会话、账户 ID 和最终 GET 回读时间 | 认证失败必须清空 |
| `#f-dep`、`#f-id`、`#f-bank`、`#f-chat` | 既有 `/api/requests`、`/api/private-data`、`/api/support` 及相应后端数据保存、权限、回读 | 本版保留表单，不假报资金到账、身份审核、银行保存或客服发送 |
| `#m-trade`、`#tr-go`、`placeOrder` | 统一 `POST /api/orders`；服务端必须用真实授权行情确定价格，后续 `/api/account`、账本、订单凭证回读 | 目前提交禁用；HTTP 200 不能单独作为成功凭据，由窗口 3/6 改造 |
| `#cw`、`#cv`、`ser()`、`DL` | US/CN 真正 OHLCV 历史接口（时间、OHLC、数量、来源/许可由后端确认） | 阶段二移除随机捏造的 1D/5D 子 K；本版没有实际行情注入，图表为空 |

## 手机端 `手机端.html`（动态 Shadow DOM）

| `data-a` 操作 | 对应既有 API / 缺口 | 当前安全状态 |
|---|---|---|
| `login` / `logout` | POST `/api/auth/login`、`/api/auth/logout`；会话回读 `/api/account` | 本版拒绝仅本地登录；`logout` 目前仅清本地态，后续必须由桥接端补服务端登出 |
| `tab`、`open`、`hgo`、`gotrade`、`sym`、`mk` | `/api/catalog`、真实股票目录及合规行情 | 页面/交互保留，无有效价格不得交易 |
| `buy`、`place`、`cancelo` | POST `/api/orders`；撤销仅在 QA 服务确有合法可用端点时接线 | 全部失败关闭；取消订单不能虚构 API |
| `fav` | GET/POST/DELETE `/api/watchlist` | 未回读前不本地假收藏 |
| `ord`、`filt`、`drg`、`exp` | `/api/account`/全量订单历史及账本回读 | 未知不能导出虚构记录 |
| `sheet`、`submit` | GET/POST `/api/requests`（资金申请），需要权限与状态回读 | 不虚构申请成功/资金到账 |
| `ksub`、`bsub` | GET/POST `/api/private-data`（KYC/银行卡），服务端加密与权限 | 不本地存造成功工单 |
| `chat`、`send`、`qa` | GET/POST `/api/support` | 不本地假送达或自动客服回话 |
| `rg`、`mode`、图表 `ser()` | 有效报价与真实 OHLCV 源 | 1D/5D 不从每日数据随机造盘中记录，数据缺失显示空态 |
| `reset`、`pdk`、`rk`、`qm`、`qp`、`harr`、`hdot` | 本地展示/输入交互 | 保留交互/按钮，不视为后端业务完成 |

> `手机端.html` 存在与后台客户 App 镜像重复的图表/客户逻辑。后端窗口不要将这两份看作两个独立交易账本；均必须指向同一用户真实账户快照。

## 管理后台 `后台.html`

| 入口 / DOM | 待绑定后端 | 不允许删除的功能 |
|---|---|---|
| `#p-over` | `/api/admin/me`、审核后的概览/状态接口 | 账户级别与权限、总体摘要必须从后台返回 |
| `#p-cli`、`#t-cli`、`#t-sub`、`#m-det`、`#m-mir`、`#m-ed` | 现有 `/api/admin/clients`、客户详情/权限、镜像审计和只读/写入许可接口 | MASTER/SUBADMIN 客户归属、只读与越权阻断 |
| `#p-appr`、`#m-ap`、`#m-cf` | 现有后台资金/审批流程接口 | 申请/拒绝/通过双向回读及审计 |
| `#p-fund` | 现有后台资金账本/客户资金审批记录 | 不伪造资金到账、修改余额 |
| `#p-cat`、`#m-sec`、`#m-com` | 已发布证券和商品目录及管理员发布接口 | 原有 listing 审批、US/CN 约束与旧记录兼容 |
| `#m-sub`、`#m-subpass`、`#m-sublock` | 子账号/邀请、重置密码、登录限制及角色权限 | 原有两阶段 TOTP、MASTER/SUBADMIN/邀请码审计 |
| `#m-chat` | 原有后台客服、聊天记录和授权发送接口 | 不伪造消息成功送达 |
| `data-action=refresh-clients/save-bank` | 对应已核实的后台读/写接口及权限 | 无完整回读绝不能显示“保存成功” |
| 后台内客户镜像 `data-a=...` | 与手机端相同的客户数据契约；只用获准镜像 API | 不得绕过后台权限直接模拟客户登录/成交 |

后台新设计是 **5 页 + 11 弹窗**；QA 原后台包含更多十模块及 30+ 路由，不能用新版可见导航数推断应删除旧能力。缺失的旧功能入口/迁移方式由窗口 4/6 逐项补映射并做权限回归。

## 可执行交接步骤
1. 先核实 7 项服务端业务，确定唯一安全 QA 基线/数据库/行情许可，禁止直接部署本 ZIP。
2. 窗口 3 将实际 `/api/account`（`account.cashCents` 等）及 `/api/account/analytics`（`realizedPnlCents`、`historyAvailable` 等）转换为 UI 所需字段，严守合法零与未知。
3. 窗口 6 按完整文件 SHA 锁定此 UI，再分别对电脑、手机 390/428px、后台做 `DOM→API→DB 回读→截图`，失败状态应确保无假成功。
4. 涉及共享 `src/http-api.mjs`、白名单、业务 DB、后台路由只能由指定所有人/总控修改，此 ZIP 不覆盖。
