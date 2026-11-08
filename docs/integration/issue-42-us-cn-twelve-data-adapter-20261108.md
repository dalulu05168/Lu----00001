# Issue #42 行情窗口｜US/CN Twelve Data 隔离接入合同（2026-11-08）

## 交付物及准确状态

- `src/twelve-data-equities.mjs`：`createTwelveDataEquities({ apiKey, rights, fetchImpl, now })`。模块只发往 Twelve Data REST API 的 `/quote` 和 `/time_series`，不连接共享 `src/http-api.mjs`、订单/账本、前台/后台 UI 或生产数据库。
- `test/twelve-data-equities.test.mjs`：隔离固定响应夹具，13 个 Node 用例通过；**没有提供有效供应商测试密钥、许可合约或真实供应商响应，故线上报价与 A 股可用性尚未验收**。
- US `AAPL`、CN `600519`（上交所 XSHG）、`000001`（深交所 XSHE）都是**测试用标识及虚构测试夹具数值**；不得作为真实市场报价发布。
- 不修改 UI 清理中的 `CN_Capital_新版三端_清除假数据_待对接.zip`；与 #42 总控顺序一致：先真实行情/内部交易后验收，最后 UI 替换绑定。

## 供应商授权要求

调用前由服务端按市场传入 `rights.US`、`rights.CN`，两者独立，结构：

```js
{
  provider: 'Twelve Data',
  clientDisplay: true, // 仅在真实合同审阅及授权后才设 true
  internalSimulationPricing: false, // 必须另核准报价用于内部成交定价
  reviewReference: '已审阅合同引用（内部 ID）'
}
```

**上述字段不是许可证明**：必须由服务端经授权的配置/后台存储注入，禁止信任客户端、环境变量里的任意 true、返回 200、供应商 API key 或标识字符串。Twelve Data 官方个人计划明确禁止第三方商业展示与再分发；商业 US/CN 尤其 CN 价格需交易所/供应商具体许可和单独审批。无许可、无 Key 默认 503。

## 接口及数据

| 调用 | 输出 | 拒绝条件 |
| --- | --- | --- |
| `getQuote({market,symbol},{purpose:'clientDisplay'})` | market/symbol/name/exchange/mic/currency/price、priceCents（仅精确到分时）、previousClose/change/percentChange、timestampMs、ageMs、source、entitlement、status/stale | 无独立客户展示权、非 US/CN 标的、交易所/币种/代码不符、缺 last_quote_at、过期/未来、无效数值/HTTP/超时 |
| `getQuote(...,{purpose:'internalSimulationPricing'})` | 同上；内部账本**候选价格**，不是券商执行价 | 无单独内部定价权；含分以下小数时拒绝本旧账本 cents 格式，不自行四舍五入 |
| `getHistory({market,symbol,interval,outputsize})` | 开高低收、成交量、交易所本地时间，排序为由旧到新 | 无客户展示权、异常 OHLCV、重复时间、精度过大、数量上限、非法周期 |

行情时间：使用 Twelve Data `last_quote_at`（最新分钟线时间，不保证交易所最新逐笔成交时间），**不得**把 `/quote.timestamp` 当最后交易时间。默认只接受 60 秒以内的最新分钟行情；周末、停市、延迟牌照数据会安全失败，不允许拿上一交易日价格充作可成交报价。历史时间为交易所本地时间；当前端不应将其当成 UTC 时间戳。传入数字价格可含最多 6 位小数，精确保留；无法无损表达为整数美分时 `priceCents = null`。

## 安全与部署门禁

- Twelve Data REST 身份验证使用 `Authorization: apikey <server secret>`，绝不写入 URL query、前端包、错误日志或仓库代码。仅服务端通过环境/密钥管理取得密钥。
- 此隔离适配尚未实现跨实例共享限流、跨实例缓存、数据授权审计存证、正式异常监控或汇率定价。需接入既有服务端统一层进行限流、过期缓存判断/去重，确保数据窗口与内部交易窗口采用同一报价语义。
- `getQuote` 是**候选行情**而非现成下单执行注入；禁止用展示权代替成交定价权。现有 `src/market-data.mjs` US-only、旧 `src/us-stock-quotes.mjs` 六天报价、`TRADING_ENABLED=false` 均未被本窗口改动。
- QA 与 Neon main 数据库迁移路线不同；此变更没有修改/运行迁移。未批准集成前，不修改 `src/http-api.mjs`、`src/order-service.mjs`、任何新三端 UI、生产域名、Neon 生产数据。
- 需要业务端共同验收：授权供应商响应（US 和 CN）、真实标的/完整分钟时间、实际商用展示/内部结算许可、周末拒单、配额 429、订单内部成交和余额/持仓/盈亏隔离 PostgreSQL 回读、API 同源、CI/浏览器。

## 测试证据（仅隔离夹具）

```sh
node --check src/twelve-data-equities.mjs
node --test test/twelve-data-equities.test.mjs
# tests 13, pass 13, fail 0, skipped 0, cancelled 0
```

此轮未调用真实 Twelve Data 账户，不声称上游 HTTP 200、生产许可、发布或登录/订单验收。

官方资料：
- https://twelvedata.com/docs
- https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage


## 2026-11-08 追加实证｜报价网关与独立远端 CI

- 新增 `src/market-data-quote-gateway.mjs`：服务端独立读取网关、按 `market:symbol:purpose` 请求去重、最长 5 秒内的可配置短缓存；缓存命中不会延长上游时间戳，每次展示/内部定价读取均重新执行`authorizeAccess` 服务端许可检验（provider/market/currency/purpose/expiry/reviewReference）。未获许可、报价过旧/异种市场、不准确的分精度、网络失败均以 503 拒绝，不返回假数据。仅进程内缓存，**尚未跨实例限流或接入现有交易路由**。
- 新增 `test/market-data-quote-gateway.test.mjs`：8 项测试覆盖缓存授权撤销、到期报价、并发去重（12 个同标的调用一次上游）、展示权不能等同内部成交定价权、错误/失效/跨市场安全拒绝。
- 增强 `src/twelve-data-equities.mjs` 与 `test/twelve-data-equities.test.mjs`：历史返回 `meta.interval` 和 `meta.exchange_timezone` 与请求及交易所一致性校验，拒绝非真实日期、越界时间、错误时间语义；历史专属测试从 13 增至 15。
- 实际在隔离的 Node 22 本地执行 `node --test test/twelve-data-equities.test.mjs test/market-data-quote-gateway.test.mjs`，**23 tests / 23 pass / 0 failed**；这些测试使用仅在测试代码内存在的固定夹具，绝不作为平台行情价格。
- 新增仅针对本行情分支的 `.github/workflows/market-api-issue42.yml`，GitHub Actions [run 42435621116](https://github.com/dalulu05168/Lu----00001/actions/runs/42435621116)：`completed / success`，日志 `23 tests / 23 pass / 0 fail`。
- 同一 run 的**真实外网**只读诊断请求 Twelve Data 官方公开 `AAPL` 演示接口（`apikey=demo`）：HTTP **200**，`has_symbol=true`，`has_timestamp=true`，`error_code=null`。没有输出价格，没有持有或检查平台实际 API key/合同；**demo 成功只证明上游官方接口可达和基础结构，不等于可用的实时 US/CN 商用数据、订单定价许可或中国 A 股订阅成功**。
- 执行容器直连官方域名时也实际尝试过 HTTP，网络环境 DNS `EAI_AGAIN`；这与 GitHub-hosted runner 成功演示诊断不是同一联网环境，不能把其中任一结果泛化为 QA/生产接通。
- 经官方许可页面核对：Business Venture/Enterprise 才可在具体合同/交易所条件下商业显示和内部使用；中国等美国之外地区商业用途还需要额外批准，向客户再分发须单独协议；US 默认数据虽覆盖上市证券范围，但非合并全市场盘口，具体客户再分发仍需授权。见：https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage 及 https://support.twelvedata.com/en/articles/9935903-us-equities-market-data 。

**仍未验收**：客户可展示的 US 和 CN 实际最新上游数据、正式供应商 key 和合同许可证据、真实可用换汇价、跨实例缓存/限流、共享 `src/http-api.mjs` 与订单事务闭环、任何 QA/生产/Neon DB 修改和真实用户浏览器。保持 `TRADING_ENABLED=false`。上述检测或 CI 不得替代七项业务端到端验收。
