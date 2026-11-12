# 前后台接口联动 — 2026-11-12

本轮完成电脑客户前台、手机客户前台与既有 Workers API 的联动补齐，未部署。没有更换认证、交易引擎或数据库结构。

## 实际改动

- cloudflare-release/web/desktop.html：账户数据每15秒及页面重新激活/恢复网络时重读；隐藏页面、编辑输入和弹窗期间暂停后台刷新。默认市场选择器不再错误阻止同步。后台撤销登录后停止自选读取，处理失效请求错误。较早账户响应不覆盖更新请求的结果。
- mobile-client/app.mjs：产品中心、产品详情和 IPO/普通基金目录加入安全后台刷新；保留已有编辑及交易确认页保护。显示已确认的中文内部记账权益说明，避免旧API英文字段覆盖。
- cloudflare-release/scripts/build-frontend-sync.cjs：创建独立候选，强制后端和新版后台工作区与已发布版本完全一致。手机与后台代理镜像使用同一份移动页面源码。未改 dist 或 release-manifest.json。
- cloudflare-release/qa/frontend-sync.cjs：真实浏览器执行后台写入与两端读取，全部使用隔离数据库和虚构账户。

## 接口对应

| 功能 | Workers API |
|---|---|
| 登录/退出/注册 | /api/auth/login、logout、register |
| 资金、持仓、历史成交 | /api/account |
| 市场目录与自选 | /api/catalog、watchlist |
| 普通交易及请求恢复 | /api/orders、order-results |
| 资金申请与状态 | /api/requests、withdrawal-pin |
| 身份/银行卡审核 | /api/profile-documents |
| 产品、期限基金及大宗 | /api/products、products/quote、fund-subscriptions、bulk-orders |
| IPO/普通基金 | /api/product-settlement |
| 公告、客服、账户通知 | /api/announcements、support、notifications |
| 后台手机镜像 | 原同源代理与授权客户范围，复用移动前台 |

## 验证

19项前台单元测试通过，0失败。功能候选9套隔离回归全部通过：frontend-sync、forms、browser-sessions、security、mirror、product-browser、permissions、admin-next、contracts。

其后仅将移动页面与镜像的权益说明从英文API优先调整为确认的中文文案。通过逐页代码比较确认最终候选只有这一差异，电脑页、后台工作区、后端保持完全一致。最终候选再跑 frontend-sync、mirror 两套均通过，19项单测重新通过。

新增联动8项检查通过：资金两阶段审批后两端余额更新、公告发布同步、撤下同步、手机产品目录自动更新、未发送客服草稿保留、后台回复同步、登录限制撤销两端会话、无未捕获浏览器错误。另断言手机显示中文权益披露。

初始失败记录保留：默认市场select错误阻止电脑同步（已修复）；后台撤销会话后继续读取自选产生未捕获401（已修复）；产品卡片精确文本定位包含类型子文字导致误匹配（改按服务端产品编号定位，未放宽断言）。

- 功能回归证据：cloudflare-release/artifacts/acceptance-Lqzojk/results.json。
- 最终联动与镜像：cloudflare-release/artifacts/acceptance-mWlgZ9/results.json。
- 汇总：cloudflare-release/artifacts/frontend-sync-1DM54G/verification.json。
- 最终未发布包：cloudflare-release/artifacts/frontend-sync-1DM54G/worker.mjs。
- SHA256：e120d4384027c6690092f8370c8dc7fd62737d6ab89e92af0572e1d81f5ec57d。

## 限制与状态纠正

目录中的 Nuvexa_Free_API_Starter (1).zip 是未接通的IBKR只读合约元信息准备包。它没有官方SDK、已登录Gateway、行情或真实交易能力。它未接入Nuvexa、Neon或Cloudflare，不能把它描述为已接通的行情API。本轮没有运行其中脚本、读取真实密钥、安装SDK或开通收费接口。此前只检查code.zip的回答遗漏了这个独立准备包，本报告明确纠正。

外部新闻/TradingView在本轮离线测试中被网络策略拦截；截图空白图表不代表已验证真实图表服务，也未填造行情。没有物理手机硬件会话验收。尚未实现的BVB、动态自定义RBAC等边界没有因前台联动而完成。

生产仍为后台版本733317be-cdfd-4057-ad6b-afc1c68fa71e；本轮没有部署、生产迁移或真实交易。

## 第二轮：资金、交易与故障恢复补测

本轮仅扩展 qa/frontend-sync.cjs 和验收记录，未修改前台业务页面、交易后端或数据库结构。候选仍为 frontend-sync-1DM54G，摘要保持不变。

本轮六套专项回归最终全部通过：frontend-sync、stocks、order-concurrency、write-receipts、quote-guards、forms。资金与交易相关写入全部发生在本机隔离数据库，浏览器内使用虚构客户。

前后台联动从8项扩充到12项：

- 提现申请只预留可用余额；初审不扣账面余额；终审后账面扣款、预留归零，两端及申请记录同步。
- 驳回提现释放预留，账面余额不变，客户看到驳回状态。
- 实际服务端内部成交后，电脑和手机显示与账户快照一致的余额、持仓。
- 账户接口503时显示错误；恢复后重新读取余额，手机错误提示消失。手机失败期间保留先前快照并显示错误，本轮未增加该快照时间标签；不能把失败期间的旧数字当成新一次成功读取。

仍保留上一轮的公告发布/撤回、产品目录更新、客服草稿保护/回复、会话撤销、无未捕获错误等检查。12项最终全部通过。

新增测试的初始失败没有删改：证券创建的约定是201而非测试误填200；电脑持仓位于“账户/持仓”而非“交易”页；恢复测试必须等失败提示清除，不能因为旧余额仍存在就认定刷新完成。修正测试路径与约定后保留全部业务断言复跑通过。

证据：
- cloudflare-release/artifacts/acceptance-1t261q/results.json（五套通过与首次联动失败原记录）。
- cloudflare-release/artifacts/acceptance-q51QZe/results.json（联动复跑通过）。
- cloudflare-release/artifacts/frontend-sync-1DM54G/verification-phase2.json（六套最终汇总、12项具体清单）。

仍未部署。真实外部新闻/图表、物理手机会话及IBKR连接不在本轮通过范围内。
