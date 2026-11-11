# 通知会话切换及审核资料入口修复

## 已修复

- `mobile-client/experience.mjs`：通知轮询使用会话代次和请求实例隔离。旧会话请求未返回时，新登录可立即开始轮询；旧响应、旧错误及旧请求收尾不能覆盖新消息、重置新会话或中断其后续刷新。退出时使在途轮询失效。客户手机与后台 App 镜像共用该模块。
- `mobile-client/business.mjs`：身份、银行卡待审核状态明确提示正在审核；通过后提示“资料已提交并审核通过，如需更改请联系在线客服。”，客户和总账户镜像可直接进入客服。子账户镜像不开放总账户专属客服入口。
- 未修改数据库、正式客户数据、产品规则或资金权限。

## 证据

新增单元用例先在旧实现失败（新登录未发出通知请求），修复后 19/19 手机单元测试通过。

`notification-session-browser-results.json` 记录真实本机隔离浏览器场景：

1. 保留旧账户未完成的通知请求，退出后登录另一客户。
2. 新账户在旧请求返回前已获得红点；随后返回旧响应不串入新客户。
3. 铃铛直达客服，已读状态保持，后续总账户回复在窗口重新获得焦点后更新。
4. 实名姓名回显；身份和银行卡通过后没有重提表单；直接请求接口重复提交也被 409 拒绝。
5. 已通过资料页的客服入口可操作。

`notification-session-acceptance.json`：同一 SHA256 的 notification-session、product-notifications、forms、experience、mirror 五套全部通过。包含两端资料上传、充值不查提款密码、错密码/余额不足拒绝提现、重复审批、到期返还故障重试、IPO/基金消息跳转、代客归属及审计回滚。故障均在本机注入，无生产业务写入。

测试命令（已有验收依赖 NODE_PATH）：

```powershell
node --test mobile-client/adapter.test.mjs mobile-client/experience.test.mjs
node cloudflare-release/scripts/acceptance.cjs notification-session product-notifications forms experience mirror
```

## 上线

Worker `lu----00001`，版本 `22384630-6079-4c6a-86d3-c9dc649673d2`，100% 流量。

SHA256 `b462f3c0af12201c86d485fe07f5cf9d3999833b0128a66609e1a539c54bf9a8`。

发布保留原绑定、静态资源和两个域名；18 项线上检查、电脑与手机主域名登录入口、后台密码和 2FA 入口通过。结果见 `notification-session-online-verification.json` 和 `notification-session-online-entry.json`。

## 尚未验收

物理 iPhone/Android、生产多连接容量与灾备、行情授权及有效性仍需专项核验，不能把本批结果视为全平台正式交付。m 子域名按既定决定暂缓迁移。
