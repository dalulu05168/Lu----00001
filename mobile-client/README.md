# NUVEXA 隔离接口集成

此目录独立于桌面根目录的已发布原型。不要复制到 `dist/`，不要部署到生产。后端由另一个窗口维护，使用正式 Worker 代码及独立测试数据库。

## 运行

1. 由后端窗口启动 `node integration-tools/run-api.cjs`，API 为 `127.0.0.1:8931`。
2. 本目录上一级运行 `node integration/server.mjs`。
3. 打开 `http://127.0.0.1:8930`，使用后端生成的隔离测试账户。测试凭证不包含在此目录。
4. 测试：`node --test integration/adapter.test.mjs`。

可选环境变量：`MOBILE_PORT`、`MOBILE_API_ORIGIN`。后者仅允许 HTTP loopback 地址，拒绝生产地址。预览服务器只监听 `127.0.0.1`，不直接暴露到局域网。

## 文件职责

- `api.mjs`：Bearer 鉴权、204/错误处理、金额单位转换。token 仅内存保存。
- `app.mjs`：登录、首页、目录、资产、持仓、订单、自选、公告。
- `business.mjs`：产品、基金认购、大宗买卖、资金申请、资料、提款密码、客服及通知。
- `server.mjs`：本地静态文件和白名单同源 API 代理；单请求上限 6MB。
- `base.css`、`pages.css`、`polish.css`、`integration.css`：保留 NUVEXA 风格。

## API 映射

| 页面 | 接口 | 约定 |
| --- | --- | --- |
| 登录/退出 | `/api/auth/login`、`/api/auth/logout` | POST；退出204；401清会话 |
| 资产/持仓/成交 | `/api/account` | cents字段除100；totalAssets/realizedPnl已是金额 |
| 市场/详情 | `/api/catalog` | lastPriceCents/priceTimestamp；无报价显示横线；无历史曲线不造数据 |
| 自选 | `/api/watchlist` | GET/POST/DELETE；market+symbol；成功后重读 |
| 公告/消息 | `/api/announcements`、`/api/notifications` | API文本均转义显示 |
| 产品/合约 | `/api/products` | items/tiers/contracts |
| 基金认购 | `/api/fund-subscriptions` | tierId + Idempotency-Key |
| 大宗交易 | `/api/products/quote`、`/api/bulk-orders` | 最新报价、版本、整数分、bps取整、产品交易密码、幂等键 |
| 资金申请 | `/api/requests` | 金额转整数分；提现另带withdrawalPin；审批完全由后台执行 |
| 身份/银行卡 | `/api/profile-documents` | PNG/JPEG每张≤2MB；已通过/待审禁止重复提交 |
| 提款密码 | `/api/withdrawal-pin` | 登录密码及六位pin由后台核验 |
| 客服 | `/api/support` | 失败保留草稿；仅服务端返回成功才提示已发送 |

基金和大宗请求失败重试保留同一幂等键；成功后新请求使用新键。页面刷新会丢弃未决请求键，因此超时后刷新重试前应先核对记录。资金申请/客服等接口没有幂等协议，网络不确定时提示先查询记录，不能保证跨刷新去重。

## 已验证和限制

- Node适配层6项测试通过：单位、金额精度、折价取整、204退出、错误传播和幂等头；另测API文本转义及无报价禁止下单。
- 本机同源代理的10个读取端点均200；独立登录会话退出204后旧令牌401。
- 浏览器实际完成测试账户登录，首页显示API余额、目录、公告；其他浏览器业务路径由验收窗口继续自动化验证。
- 隔离runner提供测试报价，不是实时市场行情。界面明确标记隔离环境。
- 没有安卓/iPhone物理真机验收；设备仿真不等于真机通过。
- 已补注册/密码重置接口入口，待新增浏览器验收。目前不含管理员代客入口、IPO/ETF结算流、AI量化、语言切换及生产图表数据。没有接口的入口不显示执行成功。
- 尚未切换正式域名、DNS、Worker路由或生产数据库。

完整后端契约参见 `integration-tools/API-CONTRACT.md`。归档或发布不得包含 `integration-tools/evidence/`、测试数据库、fixtures、token或管理员密钥。

## 协调窗口验收记录

`integration-tools/evidence/run-njmlCc/browser-read/results.json` 记录 iPhone 13、Pixel 7 浏览器设备仿真通过，包括错误密码、取数、自选增删及退出204。

`integration-tools/evidence/run-njmlCc/business-results.json` 记录9项通过：已审核身份/银行卡锁定、客服持久化、充值待审批不入账、NVDA买卖余额对账、不足余额提现拦截、基金扣款及合约保存、子账户资金审批拒绝。该文件由后端协调窗口生成，含义为隔离环境验收，不是物理真机或生产验收。

新增登录入口：邀请码注册、管理员重置码申请及确认；通知点击按类别进入客服、资料、资金或合约。已读ID按接口scope隔离存储（不保存token）。这些后续变更需协调窗口回归后才能认定验收。

`integration-tools/evidence/run-njmlCc/auth-results.json` 由协调窗口记录注册、重置申请、管理员出码、重置确认、旧密码拒绝和新密码登录验收；最新版iPhone/Android尺寸浏览器回归通过。物理真机及生产尚未验收。

## 本轮UI增强（待协调窗口浏览器验收）

- experience.mjs：15秒账户通知轮询、隐藏暂停、失败退避、scope隔离未读红点；不自动重绘正在输入的业务表单。
- 我的姓名：仅使用profile-documents的IDENTITY/APPROVED/verifiedName；没有审核姓名则显示“我的账户”。
- 浏览器history/popstate恢复路由；镜像沙箱无法写History时使用内部返回栈。动画遵循prefers-reduced-motion，Vibration API仅在设备支持且用户交互时调用，不保证iPhone支持。
- 股票详情嵌入TradingView官方Advanced Chart，仅传股票symbol；无覆盖/无网络不生成替代曲线。第三方图表可能延迟，内部交易仍以后台确认报价为准。参考：https://www.tradingview.com/widget-docs/tutorials/iframe/build-page/widget-integration/
- ipo.mjs：读取/api/product-settlement目录/条款/记录/配售；以整数微单位展示报价，申购股数与terms_id提交服务端，使用幂等键。申购成功不是配售成功。
- 后台镜像：仅iframe CN_MIRROR_CONTEXT允许由api.adoptMirror初始化；SUBADMIN隐藏资金提交/客服入口，实际权限仍由后端决定。

内联依赖顺序：api → experience → ipo → business → app。不包含生产切换；物理手机、第三方图表实际到达、IPO完整配售与镜像权限需分别验收。

测试命令：node --test integration/adapter.test.mjs integration/experience.test.mjs
