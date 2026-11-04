# 外部数据源筛选记录

核查日期：2026-11-04。范围：美股、港股、内地及马来西亚市场，客户页面展示，免费或延迟数据优先。本次只研究与记录，未接入新供应商、注册账号、订阅、付款、推送或部署。

## 结论

已核实的候选中，尚未确认一个免费股票接口同时满足四市场覆盖和客户展示许可。不能将“可申请免费 key”“支持全球交易所资料”视为本站报价展示授权。

ECB 日参考汇率是可优先实施的免费补充源，覆盖 USD、HKD、CNY、MYR；它不提供股票价格。现有 TradingView 图表及标识继续保留，图表不能用作后台估值报价接口。

## 候选比较

| 来源 | 官方页面当前信息 | 本站判断 |
|---|---|---|
| Twelve Data | Basic 8 credits/分钟、800/日，内部非展示用途；Venture 客户展示方案起价 $149/月，实际额度和市场另核 | 免费档不满足客户展示；EOD 支持说明将 HK XHKG、MY XKLS 列入需许可或不支持清单，四市场不能直接承诺 |
| Marketstack | Free 100 requests/月、1年 EOD、非商业；Basic $9.99/月、10,000 requests/月，注明商业用途，超额另计 | 可作为低价候选；仍需核实具体股票报价覆盖、客户展示/再分发权限及交易所费用。“2700+ exchanges info”是资料数量，不证明报价覆盖 |
| EODHD | 免费个人 Sandbox 20 calls/日、1年历史；历史接口说明 EOD 多数收盘后2–3小时更新，美国主要交易所约15分钟；新闻一次消耗5 calls | 免费个人方案不能直接用于本站。商业 Internal use $399/月、Enterprise $2499/月、Custom 起价 $399/月；不能把内部用途价格当作客户展示报价，需确认具体许可及四市场标的 |
| ECB | 工作日约16:00 CET更新，以EUR为基准的参考汇率，无需供应商账号 | 可作信息展示与参考换算，须标明来源、数据日期、派生计算；不可称实时或作为交易结算价 |

价格为核查时公开页面的美元月付标价，不代表最终报价、税费、交易所授权费用或本站已购买。配额计数规则各异，不能简单等同用户页面访问量。

## 建议实施顺序

1. 接入 ECB 只读日参考汇率：服务器缓存，保留日期、来源、过期/失败状态；交叉汇率明确标注计算而来。EUR基准下 A→B = rate(B) / rate(A)。缺失值不补零，不用旧数据伪装当日数据。
2. 股票报价供应商确认之前，继续明确显示未接入状态，不用内部成交价或图表 iframe 代替当前市价。已有 FIFO 已实现毛盈亏保持内部账本口径。
3. 若后续允许申请试用，先用现有证券目录逐一验证四市场 symbol、交易所、币种、原始/复权价格、收盘日期、实际延迟、限额、错误行为；目前没有账号，因此这些实测尚未进行。
4. 供应商须明确允许本站向已登录客户展示、服务器缓存及计算持仓市值/盈亏，并说明交易所附加授权、署名、可保留历史期限和停止服务后的数据处理要求。未确认前不订阅。
5. 新闻独立核实标题、摘要、全文的展示权限；默认只规划来源、发布时间、标题与原文链接，不将API返回全文当作转载授权。股息宣告不能自动记为客户入账，风险分数及日/月收益率也不能只靠当前报价补齐。

ECB版权条款允许准确引用并注明来源；派生修改须明确。若信息纳入收费内容，还须按其条款向付费用户说明可从ECB免费获取。页面只展示必要来源说明，不冒用ECB品牌。

## 官方来源

- Twelve Data业务方案：https://twelvedata.com/pricing-business
- Twelve Data EOD覆盖及限制：https://support.twelvedata.com/en/articles/12682324-end-of-day-eod-pricing-market-data
- Marketstack方案：https://marketstack.com/pricing
- EODHD个人方案：https://eodhd.com/pricing
- EODHD商业方案：https://eodhd.com/commercial-pricing
- EODHD历史接口：https://eodhd.com/financial-apis/api-for-historical-data-and-volumes
- EODHD新闻接口：https://eodhd.com/financial-apis/stock-market-financial-news-api
- ECB参考汇率及更新规则：https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html
- ECB版权及使用条件：https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html
- ECB XML数据：https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml

验证边界：本记录依据公开官方文档，不是供应商合同审查或实际账号的覆盖验收；未改变产品代码，因此本轮未重复运行产品测试。
