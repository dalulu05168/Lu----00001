# NUVEXA 前后台临时集成

关联 GitHub #54、#55。前台起点为 91b18dc26f4f4521892adb0a6604c5c5dc18ca70。资金补丁从后台 f74e56e、b7afed1e 逐笔重放。前台登录页、桌面页面和手机端金额解析及展示文件与前台起点逐字节一致。手机共享图表模块只新增后台镜像分支。

## 生产源码与冲突处理

- 可复现基线为 a7b1578。干净检出的发布构建连续两次生成 d055098d474f651d9085b81d66787f45e542d387f97d35f60b78cc0a1e43d8d0，与归档 860bea19 Worker 一致。
- Worker 冲突有四处。保留生产基线的下单流程、报价生命周期、估值价格来源和内部记账披露。接入整数分运算、API 边界的精确字符串、买入前扣除提现冻结及阶段校验。没有重放 cnOrderIntent、cnValidateTradeQuote、request_intent 或 quote_evidence。隔离库按 Worker 是否使用交易证据字段决定是否应用历史迁移文件。
- 构建脚本的重叠声明合并为一个 --development 参数。保留前台基线的资源组装和生产哈希校验。候选只写 dist-dev，发布清单、归档 Worker、现有 dist 和数据库迁移文件均保持原样。

## 后台沙箱与金额

Playwright 的初始化脚本会进入子帧。三处会话注入均限制为本机测试源的顶层页面。加上限制后，首个剩余浏览器异常的堆栈来自 TradingView 嵌入组件读取 Cookie。后台镜像因此显示查看提示并跳过该组件，保留 allow-scripts allow-forms 沙箱。独立客户页面继续走既有图表路径。

两个后台按 BigInt 拆分元与分，再用 Intl 生成货币格式。测试覆盖超过安全整数的相邻金额、负一分和普通数字金额。大额双端联动直接在隔离 PGlite 中设置测试数据，由实际 Worker 生成响应，再由桌面与手机页面读取和验证。

## 验收命令

在 cloudflare-release 目录运行。

```powershell
node scripts/build.cjs --development
node --check dist-dev/worker.mjs
node --test qa/admin-money.test.cjs qa/funding-review.test.cjs qa/trade-consistency.test.cjs qa/settlement-native.test.cjs ../mobile-client/money.test.mjs
$env:CN_QA_CASH_AUDIT='1'
node scripts/acceptance-release.cjs --bundle dist-dev/worker.mjs admin-next funding-safety admin-funding order-concurrency permissions login-page frontend-sync
```

候选 SHA-256 为 e97a8af7fefe3f76bb3a2b269e1cf6ee75c0511945327ddb510d0fd872b741fe。此验收用于临时集成审查，生产版本仍需独立批准。
