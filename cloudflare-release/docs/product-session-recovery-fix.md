# 订单响应丢失与登录过期恢复修复

## 实际问题与改动

手机端已提交订单但响应丢失时，会保存原请求的去重凭据。此前随后收到 401 会清除凭据，重新登录后重试可能生成新订单。`mobile-client/api.mjs` 现在在 401 时保留未决凭据，成功确认原订单后才清除。适用于 IPO、基金、大宗交易、资金申请和客服；后台 App 镜像使用同一 API 客户端。

未改生产客户数据、数据库结构、成交定价规则或权限边界。

## 隔离验收证据

- `product-recovery-acceptance.json`：同一构建的 product-recovery、products、sessions、write-receipts、mirror 五套回归全部通过。
- `product-recovery-ledger-results.json`：浏览器实际提交 IPO 申购、普通基金申购/赎回、期限基金认购；提交成功后人为丢失响应，再撤销登录会话，重新登录重试。每项三个请求均沿用同一去重键，返回原订单 ID。最终仅三笔净值/IPO订单、一份期限基金合同；现金 90125 分、普通基金 15 份、总资产 1000 USD。电脑和手机余额一致。
- `account-history-current-results.json`：本机隔离库 515 笔订单、14 个持仓，成交总额 542 USD、已实现盈亏 1 USD；完整估值与部分报价不可用时的成本估算对账通过。当前电脑账户页、手机持仓和 515 笔交易记录实际显示通过。
- 手机单元测试 18/18 通过，包括五类写请求遇到 401 后的凭据恢复。
- 故障注入只发生在本机，测试记录与数据库保留于 artifacts，未写入生产。

## 发布结果

Worker `lu----00001`：版本 `5d336180-7df4-4411-99d8-6c7c74ead0ec`，100% 流量。

构建 SHA256：`c64b43a984a2c899908678f8ff75152f8ce52460a16e7102d0149f3548203228`。

发布前后确认静态资源、原绑定及 nuvexapro.com、admin.maacropierce.com 域名保留。线上 18 项检查通过，三端实际浏览器登录入口及后台 2FA 字段通过。线上只检查入口和受保护接口，没有以客户资金执行验收交易。

## 重跑

在源码仓库设置 NODE_PATH 指向已有验收依赖后：

```powershell
node --test mobile-client/adapter.test.mjs mobile-client/experience.test.mjs
node cloudflare-release/scripts/acceptance.cjs product-recovery products sessions write-receipts mirror
Set-Location cloudflare-release
node qa/account-history.cjs
```

## 验收边界

本次是订单恢复与账务回归，并非全部交付完成。物理 iPhone/Android、生产多连接容量与灾备恢复、行情供应商授权和有效性仍待专项验收。m.nuvexapro.com 按用户决定暂缓迁移，仍为旧 Vercel 页面；使用主域名。
