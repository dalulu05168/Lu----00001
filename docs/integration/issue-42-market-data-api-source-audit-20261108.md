# Issue #42｜免费/开源行情 API 缺口与授权核验（2026-11-08）

**工作范围**：只读供应商研究、接口契约核查与安全展示校验。关联分支 `work/market-data-api-research-20261108`，取自 QA 代码基线 `dev/restore-four-role-platform-20261103` @ `0368652392781a2959d0bbab83eb619bb8026e11`。严禁把本说明等同于供应商开户、数据展示授权、实盘执行授权、部署或线上验收。

## 1. 代码实际状况（与旧默认分支不同）

| 任务 | QA 分支实际路径 | 代码已有 | 尚未证明/缺口 |
| --- | --- | --- | --- |
| 美股最新报价 | `src/us-stock-quotes.mjs`，`/api/stock-quote` | Finnhub `/api/v1/quote` 代码和基本格式校验 | 实时 key 有效、数据产品及展示/再分发许可、IEX/SIP 盘口覆盖、在线返回及运营 SLA |
| 美股日历史价 | `src/us-stock-quotes.mjs` / `getUsStockHistory` | Twelve Data `/time_series`，90 根日收盘点 | 历史 OHLCV 完整性、复权、交易日、商用展示许可、配额及线上 key |
| 汇率信息 | `src/reference-fx.mjs`，`/api/reference-fx` | ECB XML、失败退避、缓存，标记 `INFORMATION_ONLY` | 线上实际访问、数据日期、版权遵循；不可做实际交易汇率 |
| 美股代码查找 | `src/stock-lookup.mjs` | Twelve Data 股票搜索路径 | 客户展示使用权及准确标的映射、额度和脱敏日志 |
| A 股行情和 K 线 | `src/market-data.mjs` 目前仅支持 `US` | 无可证实的合规 A 股报价源 | 官方交易所/有权分发商许可、CN 股票识别、币种、真实交易所时钟 |
| 真实券商报价与订单 | 内部 `src/order-service.mjs` | 仅内部账本；无外部经纪商报单 | 真实开户、券商资质、交易场所路由、成交确认/撤单/对账等。不能启用真实交易 |
| 公告/财报 | 未发现已接 SEC 数据适配模块 | 可考虑官方 SEC EDGAR API | 代码未接、CIK 映射、更新频率、合法访问频率与来源标注 |

> 市场变动：其他窗口正在进行 US/CN 市场清理，历史 QA 分支 `src/market-data.mjs` 仅 `US`。不要以此文件覆盖其他分支已完成的 US/CN 约束或 DB 006 迁移。

## 2. P0 代码级隐患（仅报告、不碰交易模块）

1. `getUsStockQuote` 当前默认可接受最多 **6 天**前的供应商成交时间戳（`DEFAULT_MAX_AGE_MS=6*86400000`）。这可减少周末空报价，但**绝不能将该价格标成实时，也不应按此价格作为真实交易执行价**。
2. 代码在 `validateQuote` 输入中直接写死 `entitled:true`。这只是内部布尔标志，**不是 Finnhub、交易所或其他版权方允许客户展示/再分发的法律证据**。
3. `resolveOrderExecutionPrice` 从上述报价映射为账本价。虽然目前无券商路由，启用任何真实交易前需单独的受许可交易定价、盘中时钟、全市场覆盖、报价来源核验及订单执行服务。
4. `getUsStockHistory` 仅返回时间和收盘价，不是完整 OHLCV K 线；不能为不存在的开高低、成交量生成合成数据。
5. `stockQuotesConfigured()` 只检查 `FINNHUB_API_KEY` 是否有值，不能证明上游运行、许可、正确市场、报价质量或真实券商已连接。

## 3. 官方候选与免费使用限制

| 来源 | 可验证的免费/官方能力 | 推荐用途 | 客户生产展示/交易定价许可状态 |
| --- | --- | --- | --- |
| Twelve Data Basic | 官方 2026 定价 8 API credits/分钟、800/天；基本试验数据 | **本地开发/隔离研究**；已有日收盘适配代码可保留 | **不得凭 Basic 给客户商业展示**；官方商业/个人使用说明及 Terms 限制免费商业用途与再分发。需商业协议、交易所附加权益 |
| Finnhub | 代码已有 `/quote`；源代码注释描述免费价格 | **待验证 key 和契约后的测试行情** | 本次没有取得正式外部展示/定价的合同证明；不准因返回 200 或 `entitled:true` 当已授权 |
| Alpaca Market Data Basic | 免费 IEX 美股数据；不能代表全市场 SIP | 可作为美股技术验证的替代供应商（先核实产品与商用合同） | 是否可在本站具体产品再分发/商业展示需要签约核对；未接、未请求 token |
| AKShare/AKTools | 开源 Python/HTTP A 股研究数据接口 | **内部研究/离线核对** | 项目声明“仅用于学术研究，不可做任何商业用途”，不可直接发布到客户终端 |
| BaoStock | 历史 A 股、ETF 日 K 线说明 | 内部历史研究/与授权源交叉校验 | 未取得商用展示授权；非实时成交源 |
| ECB 日参考汇率 | 免费官方外汇参考汇率，按日更新 | 只读辅助换算/标注日期和来源 | 不是可下单/结算的汇率，仍须遵守 ECB 版权条款 |
| SEC EDGAR | 官方 `data.sec.gov` 提交文件与财务 XBRL JSON | 证券公司公告、基础财报后端只读服务候选 | 不是股票价格；服务端抓取遵守 SEC Fair Access，`data.sec.gov` 不支持 CORS |

官方文档（逐项查看而非模拟接口请求）：

- Twelve Data 个人价格/Basic 额度：https://twelvedata.com/pricing
- Twelve Data 个人/商业使用：https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage
- Twelve Data 服务条款：https://twelvedata.com/terms
- Twelve Data 商业价格：https://twelvedata.com/pricing-business
- Alpaca Basic 数据覆盖：https://docs.alpaca.markets/us/v1.1/docs/about-market-data-api
- Alpaca IEX vs SIP：https://docs.alpaca.markets/us/docs/market-data-faq
- AKShare 官网仓库/学术声明：https://github.com/akfamily/akshare
- AKShare 商用限制：https://github.com/akfamily/akshare/blob/main/docs/special.md
- BaoStock 官网：https://baostock.com/
- SEC 官方 API：https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- ECB 官方汇率：https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml

供应商**许可证、交易所数据费和本平台所在地区监管要求不能由 GitHub 开源许可证替代**。

## 4. 本窗口新增隔离代码契约

- `src/market-data-use-policy.mjs`: **未接入现有 HTTP/前台/订单路径**的纯函数 `assessClientQuoteDisplay`；US/CN 市场白名单、报价结构、<=60s 的展示新鲜度门禁、服务端审阅引用和外部展示许可标记。缺字段时一律拒绝。`assessQuoteForOrderExecution` 永远拒绝；接口的 `allowed:true` 仅是通过这些本地技术检查，**不是市场数据许可证真实性证明**。
- `test/market-data-use-policy.test.mjs`: 四项测试，覆盖权限缺失、6天旧报价、市场范围及“显示不等于实盘下单”。
- 本模块不读取密钥、不触网、不读取客户数据、不修改数据库、不触发部署。接入前需跨窗口合同、真实供应商许可、集成分支及 QA 门禁审查。

本地单独复测：

```bash
node --check src/market-data-use-policy.mjs
node --test test/market-data-use-policy.test.mjs
```

## 5. 待总控决定（当前不能宣称完成）

1. 确定 US/CN 哪类展示是**公共网页、仅登录客户、内部研究、模拟交易、真实交易执行**，每类许可证可能不同。
2. 以供应商书面许可确认：数据市场/交易所范围、是否可客户外部展示、缓存与再分发、延迟等级、按用户计费、报价用于估值/结算/模拟交易是否允许。
3. 在共享 QA 环境使用**合法且隔离的测试 key**验证 HTTP 响应、来源时间戳、异常/限流/节假日、AAPL/MSFT/600519 等明确标的；不复制生产 key。
4. 真正业务整合前另行审批公共 `src/http-api.mjs`、`src/us-stock-quotes.mjs`、市场约束或 DB 迁移。不可直接把本分支合入生产。

**真实验证边界**：本轮官方文档阅读 + GitHub 文件核对 + 新纯函数 Node 测试；未执行合法供应商账号下的实时数据请求，未做商业协议法律审查，未做线上登录、订单或真实资金测试。