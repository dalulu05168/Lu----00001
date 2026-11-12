# 后台资金审批与隔离验收

资金审批接口 POST /api/admin/requests 需要提交 id、decision 和 expectedStatus。驳回时还需 reason。初审提交 PENDING，终审提交 REVIEWED。请求在行锁内核对预期状态，过时或重复操作返回 HTTP 409。刷新后应让管理员重新确认当前阶段。仓库现有验收规则允许同一主管理员完成两次独立操作。

审批需要主管理员会话和五分钟内的管理员验证。缺少会话返回 401，角色不符返回 403，验证超期返回 428。管理员重新输入密码和 TOTP 后可重新提交原操作。

账户与订单响应的金额以整数分为单位。常规金额仍返回 JSON 数字，超过 JavaScript 安全整数范围的金额字段返回十进制字符串。以美元计价的账户汇总在超范围时返回保留两位小数的十进制字符串。客户端处理这些字符串时应保留精度。

在仓库根目录运行以下命令。

```powershell
npm --prefix cloudflare-release ci
npm --prefix cloudflare-release run build:dev
node --check cloudflare-release/dist-dev/worker.mjs
node --test cloudflare-release/qa/funding-review.test.cjs cloudflare-release/qa/trade-consistency.test.cjs cloudflare-release/qa/settlement-native.test.cjs
$env:CN_QA_CASH_AUDIT = '1'
npm --prefix cloudflare-release test -- --development funding-safety admin-funding order-concurrency sessions security quote-guards products admin-next permissions
```

开发构建写入 dist-dev，并打印实际产物 SHA-256。隔离测试使用本机 PGlite，输出每个套件的 qa.log 及包含候选包摘要和退出码的 results.json。发布构建仍以 release-manifest.json 的摘要校验 dist，开发构建使用独立目录和命令。
