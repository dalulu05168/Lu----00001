# NUVEXA 手机会话与资金联合验收

临时集成分支从 16f79d6c91ba3368933f75777c91b4ecfa27d4cd 建立。合并前端会话提交 6ed9903e3874efc4b5da733e9eee51ba5982b68b 及其后续测试夹具修正 c4143095cab3b43e99d5c02040ba822f2712d8ab。被测试的合并提交为 f903e6a4281ca1eee0b781010a838a8f7980d363。

Claude 的 32 套原始运行记录为 28 通过、4 失败。news 和 layout-controls 是生产基线已有字体断言，trade-database 依赖当前未启用的交易证据逻辑，mobile-session 缺审批阶段。其后 c414309 只补测试阶段，单套复跑通过。该修正已随前端分支纳入。

共享验收入口保留 funding-safety、mobile-session 和原有 frontend-sync 的隔离数据库配置，同时保留端口偏移。两个分支的共享脚本冲突在套件注册与隔离连接分组处。Worker 模板、数据库迁移、桌面和登录页面、生产清单相对后台集成起点逐字节一致。

sessions 保留子管理员 403、两级审批、重复终审只成功一次、提现限制、订单余额及持仓对账，并把刷新断言改为服务端认可原 Cookie、显式退出后旧会话返回 401。product-recovery 保留模拟 503、401、最终成功的三次提交和同一幂等键，并核对待确认记录属于实际账户、过期后不丢失、成功后清除，以及最终订单数和余额。products 只把刷新后重新登录改为会话恢复，保留原有资金、持仓和权限断言。

构建候选 SHA-256 为 13b42a3cd9cc448ece76ea59bb18b0d72db88bb5ebbca64caddc075036e561c5。各组使用相同 Worker 文件和不同本机端口，各套件使用独立 PGlite。32 套均实跑。trade-database 单列为不适用，并保留其实际退出码。证据 JSON 只保留允许列表字段和人工审核过的失败分类。

在 cloudflare-release 中运行。

```powershell
npm ci --ignore-scripts --no-audit --no-fund
node scripts/build.cjs --development
node --check dist-dev/worker.mjs
node --test qa/admin-money.test.cjs qa/funding-review.test.cjs qa/trade-consistency.test.cjs qa/settlement-native.test.cjs ../mobile-client/money.test.mjs ../mobile-client/adapter.test.mjs ../mobile-client/experience.test.mjs
$env:CN_QA_CASH_AUDIT='1'
node scripts/acceptance-release.cjs --bundle dist-dev/worker.mjs mobile-session sessions login-page browser-sessions security frontend-sync registration access funding-safety admin-funding order-concurrency product-recovery products forms write-receipts quote-guards admin-next admin-account-layout news notification-session layout-controls experience product-notifications mirror contracts charts product-browser permissions stocks interface reference trade-database
```
