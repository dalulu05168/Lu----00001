# Issue #42 — SEC EDGAR 免费官方公司公告适配器（2026-11-08）

## 范围 / 解决的真实缺口

本窗口只负责行情与外部证券信息接口寻找、只读数据适配与验证。当前 QA 分支已有 Finnhub 美股最新成交价、Twelve Data 历史收盘、ECB 参考汇率，但尚没有 SEC 官方公司公告/财报元数据适配器。这里独立新增 `src/sec-edgar-submissions.mjs` 和 `test/sec-edgar-submissions.test.mjs`，**没有修改现有服务器、外部路由、前台、后台、手机、交易、DB**。

SEC 官方 `data.sec.gov/submissions/CIK##########.json` 免费且无需 Key。它按公司 CIK 提供官方披露文件记录，**不是行情、订单价格、已持仓、可交易资格或投资建议**。SEC 页面明确 JSON API 不支持直接浏览器跨域 CORS，故若总控审批接入，只能在服务端通过单独只读 API 安全代理读取；不能直接从浏览器读取上游。

## 代码契约

```js
import {createSecEdgarClient} from './src/sec-edgar-submissions.mjs';

// 部署服务管理员须先提供 SEC 可辨识的真实应用身份和联系邮箱；不可用示例邮箱上线。
const readCompanyFilings = createSecEdgarClient({
  userAgent: process.env.SEC_EDGAR_USER_AGENT
});
const data = await readCompanyFilings('320193', {forms:['10-K','10-Q','8-K'],limit:12});
// data.dataKind === 'FILING_METADATA'; data.priceAvailable===false;
// data.orderExecutionAllowed===false;
// data.filings[x].url 指向官方 www.sec.gov/Archives/edgar/data/...
```

- 仅允许数字 1–10 位 CIK，补零至 10 位；不猜测或捏造股票代码到 CIK 的映射。
- 强制有联系邮箱的、可辨识的 `User-Agent`；默认无身份无法发起调用。`fetch` 只能访问固定 `https://data.sec.gov`；禁止重定向、可自定义 URL、任意上游 host。
- 仅返回 10-K、10-Q、8-K、20-F、6-K、40-F 的文件元数据，默认 12 条、最多 50 条；严格检查 JSON 字段、CIK、列长度、日期、accession、文件名，过滤危险文件路径，不重发原始全文。
- 每客户端实例默认 350ms 请求间隔（约 2.85次/秒）、15 分钟缓存，单 CIK 并发合并，超时 7 秒；响应非 JSON、超过 2 MB 的流式响应（边读取边限制）、429/错误/无网络一律返回 503，不返回陈旧数据充当最新。
- **每进程节流不等于 SEC 全局限速**：多进程/多地区运行时必须在服务端部署统一的限额器，确保整体不超过 SEC 的 *10 requests per second*，合理处理 429 和后台批量下载限制。此限制来自 SEC 官方 Fair Access 政策，且可能变化。
- `User-Agent` 联系邮箱只是 SEC 的服务访问身份要求，不是行情数据授权。日志或上层接口不得泄露账户凭证/密钥。
- 本模块不配置券商、不决定客户是否能交易、不提供资产收益/价格，不能作为下单启用条件。

## 已执行的验证（离线合成 fixture，未访问 SEC）

运行命令：

```bash
node --check src/sec-edgar-submissions.mjs
node --test test/sec-edgar-submissions.test.mjs
node --test test/market-data-use-policy.test.mjs test/sec-edgar-submissions.test.mjs
```

第一次测试：SEC 适配器 10/10；补充边流式读取边限制 2 MB 的安全回归后，SEC 适配器 12/12 passed, 0 failed；合并两模块最新测试 16/16 passed, 0 failed。此为本地 Node 22 环境的 isolated mock-network 单元测试；不证明 SEC 线上通达、公司数据实时、客户业务端到端、CI 全绿。上线前必须由总控使用正式且可辨识的 SEC 请求身份，在隔离 QA 环境完成真实联网请求和错误率/限流测试，并检查服务对外展示的元数据、安全响应头和缓存策略。

## 官网与当前约束（2026-11-08 查询）

- SEC 官方接口：https://www.sec.gov/search-filings/edgar-application-programming-interfaces（CIK 格式、免费无需 Key、实时更新、CORS 限制）
- SEC Fair Access：https://www.sec.gov/about/privacy-information（10 req/s 公平访问）
- SEC filing archive path：https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data（无横线 accession 目录）
- SEC 程序化访问 FAQ：https://www.sec.gov/about/webmaster-frequently-asked-questions

## 提交与集成门禁

- 新增的源文件及测试必须只提交到 `work/market-data-api-research-20261108`；不直接操作共享 `src/http-api.mjs`、券商订单/资金、数据库迁移、前台/后台/手机 UI 或生产服务。
- 将共享 API 端点接入前必须在 Issue #42 由总控确认统一 QA 分支、静态路由/认证边界和 SEC 全局限额器，之后另行验证。
- 不用网页图表、免费个人套餐、模拟价格或 SEC 公告替代可商用真实交易行情。