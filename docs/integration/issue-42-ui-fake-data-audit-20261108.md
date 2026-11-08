# Issue #42 — 三端 UI 假数据清理：当前前台分支的只读审计与交接（2026-11-08）

## 范围、基线和证据边界
- 责任窗口：UI 假数据清理；不接管前台 API、后台 2FA、行情供应商、手机独立入口或部署。
- 本审计基线：`dev/frontend-phase2-session-catalog-20261108` @ `3d6b1c88c641695f5bea8e9782632b284da3fd7c`；该 SHA 是前台 API 窗口的提交，不是本窗口产物。
- 读取了 Issue #42 的全链路审计 #6715119816、跨窗口协议 #6715133415、前台冲突报告 #6715162965、后台迁移冲突 #6715215773 及总控后续复核 #6715278186。
- 本轮从 GitHub 实际读取 `web/desktop.html`、`web/cn-terminal.html`、`web/desktop-bridge.mjs`、`web/cn-terminal-bridge.mjs`、`web/client-data-api.mjs`；只做静态源码核对，没有授权 QA 登录、线上 API 或生产数据库验收。
- GPT 资料库另有此前清理的三份独立 HTML（前台/后台/手机端），仅是本地清理交接包；**不能当作 GitHub 已合并、已部署或已对接真实 API 的证据**。

## 已证实的 UI 数据语义问题（本轮源码行号）
1. `web/desktop.html:399`：`DATA.cashOverride:0` 是未同步时的初始数值。 `404-405` 中 `cash()` 会优先返回这个零；`412` 的 `bind()` 将 `cash`、`traded`、`total` 格式化为 `0.00`，且订单/持仓/申请数量取空数组长度 0。只有 `413` 的 `?preview=1` 分支显式改成破折号。**非预览、账户尚未同步时可能显示“真实零余额/零交易”的误导状态。**
2. `web/cn-terminal.html:391-406`：初始 `cashOverride:null`；`398-399` 的 `cash()` 从空申请/订单计算为 0；`406` 的 `bind()` 把现金、交易额、总资产、订单数等写为零，缺少类似 desktop 的未认证/未同步保护。需在未收到可信 `CN_SYNC_ACCOUNT` 之前统一空态。
3. `web/cn-terminal.html:387`：注释“为 null 时使用下方预置页面数据”与当前空数据初始化不一致，容易使后续维护者重新引入假数据；应修订注释，禁止恢复 fixtures。
4. `web/desktop.html:393` 与 `web/cn-terminal.html:386`：`TRADING_ENABLED=false`，交易提交按钮在 `520/513` 被禁用；`placeOrder` 亦检查该开关（`532/525`）。**这属于已观察到的防误下单保护，必须保留；不能把打开开关当成真实交易接入。**
5. `web/desktop.html:381-385`：客服明确标示“消息仅在当前页面显示”，输入框也标注仅当前页面；不应把本地显示当成客服工单已送达。需对所有发送/刷新提示进行“未连接”语义验收。
6. `web/desktop-bridge.mjs`、`web/cn-terminal-bridge.mjs` 引用 `web/client-data-api.mjs` 的 catalog/watchlist 接口，账户/目录/自选同步路径存在，但**本轮未证明 QA/生产环境 API 可访问或持久化**。不得用 bridge 文件存在替代登录后的 E2E。

## 跨窗口冲突与最小修复建议（尚未实施）
- `web/desktop.html`、`web/desktop-bridge.mjs` 属前台 API/电脑 UI 交叉维护范围；`web/cn-terminal.html`、`web/cn-terminal-bridge.mjs` 与手机/客户终端适配有重叠。本窗口**不直接改写这些共享文件**，请求总控指定修改所有权及单一 QA 集成基线。
- 建议页面数据状态采用 `unknown / loading / authenticated-loaded / unavailable`，仅在真实 `GET /api/account` 返回成功、结构校验通过后展示服务器确认的零值；无会话/401/403/503/超时均显示 `—` 与明确提示。空订单列表只有在服务器确认成功后才可写“暂无订单”，否则写“订单尚未同步”。
- 客服、充值提现、KYC、银行、资金审批无真实接口或写入确认时，只保留原 UI 布局并禁用提交或明确“未接通”；不得产生成功状态、伪消息或本地资金增减。
- 行情图/K 线/涨跌幅只有在来源、时间戳、客户展示授权和有效性核验通过时才展示为报价；缺失则空态。保留 `TRADING_ENABLED=false`；US/CN 与 HK/MY 删除必须跨 UI/API/DB 同步。
- 原设计 CSS、弹窗、响应式、账户/订单/自选 DOM 和现有认证/业务入口必须保留；不要把参考资料库静态 HTML 整页覆盖现行有 API 的 GitHub 页面。
- Neon main 迁移 006–008、QA 另一套 001–022、双阶段后台 TOTP、生产 SHA/DB 映射均交后台/总控；本窗口不执行迁移、不碰生产凭据或数据库。

## 下一轮可复核验收清单
1. 由前台窗口在其负责分支最小修改上述未同步数字状态，并给出 commit/diff；本窗口复核 CSS/布局未改。
2. Node 语法 + 1440px 桌面/390px 移动 Chromium：无会话、401、503、延迟响应、真实零余额、非零余额分别验证；无会话不能出现 `0.00`、虚构收益或假成交。
3. 真实同源 QA 授权账号：注册/登录→account→catalog→watchlist 写入/回读/删除→退出；浏览器网络证据和 API 状态码需脱敏；生产业务验收另行批准。
4. 逐个检查三端客服/资金/KYC/银行/订单按钮是否误报成功，保留缺接口时的禁用状态。
5. 每轮回报：分支+SHA、修改文件、测试命令/输出、QA URL、数据库迁移状态、阻断。CI/预览不等于真实业务验收。

## 本轮实际验证
- 已读取上述五个 GitHub 文件及 Issue 最新协作记录，核对具体源码行与保护条件。
- 本提交仅增加审计 Markdown；**未运行浏览器/Node 测试、未改运行代码、未部署、未操作数据库**。
