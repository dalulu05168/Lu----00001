# ECB 日参考汇率接入

日期：2026-11-04。仅本地开发改动，未推送、部署、变更域名或数据库数据。

- `src/reference-fx.mjs`：固定 ECB 官方 XML 源；8秒超时；日期、完整币种、正数校验；USD交叉换算；每进程1小时缓存、并发合并、失败退避1分钟。失败保留带日期缓存并标注 stale；首次失败返回不可用。数据超过4天亦标旧。该阈值不是交易日历判断；所有数据均显示实际日期。服务重启/新实例会重新获取，无持久缓存。
- `src/http-api.mjs`：公开只读 `GET /api/reference-fx`，无数据库写入、无账户信息。成功200，首次获取失败503，其他方法405。服务器内部缓存不等于浏览器缓存，响应仍 no-store。
- `web/index.html`、`web/app.mjs`：图表下显示参考汇率、实际日期、旧数据及失败提示、来源链接和刷新按钮。原图表保留，汇率不改变账本、执行价格、持仓估值或已实现收益。
- `test/reference-fx*.test.mjs`：覆盖换算、缓存合并、失败退避、非法/未来日期、缺币种、零汇率、旧数据、HTTP只读及DOM显示/清空行为。

运行：`npm test`；需仅测试本功能可运行 `node --test test/reference-fx.test.mjs test/reference-fx-ui.test.mjs`。开发环境按现有文档配置本地 DATABASE_URL 后 `npm run dev:api`；本轮没有改动重要配置或数据库迁移。

真实联网：本地 Node 调用官方 ECB 成功，返回数据日期2026-11-03、字段齐全。该结果只证明本机访问，未证明托管环境可达。页面仅完成自动DOM检查，本轮尚未进行真实浏览器视觉验收。

官方来源：https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml 。版权规则及免费获取说明：https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html 。仅供信息参考，不用于交易结算。
