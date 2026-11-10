# CN Capital 四项缺口修复验收（2026-11-10）

本文件更新同日 delivery-audit-2026-11-10.md 中列出的四项未完成状态。此前报告保留作为历史记录。

## 当前状态

- 生产 Worker：lu----00001。
- 生产版本：ee68a1cf-d1b9-4590-beaf-7a6f2d8c236a，100% 流量。
- 源码 SHA256：1d2136d55c96b6934ef68a59d7c1b3e3253142627c8d533d84be042209a029ce。
- 用户新增授权：总账户和子账户均可代所属客户交易；出入金审批仍仅总账户。
- 下述四项已完成代码修复、隔离浏览器/API 验证和上线。未向生产客户写入假交易或修改真实资金。

## 四项关闭结果

| 原缺口 | 实现与实际验证 |
| --- | --- |
| App 镜像只是快照且禁止写入 | 构建直接嵌入当前手机端和当前产品 UI。镜像通过受控消息通道和 /api/admin/client-action 操作，服务端每次校验管理员 2FA 会话与客户归属，不传递客户登录令牌。子账户在镜像实际买入，总账户代卖出，现金和持仓对账通过。跨子账户客户返回 404；子账户发起资金操作、调用客服或审批返回 403。写业务和写代客审计在同一事务内，审计失败整笔回滚。客户文本脚本转义、Esc、重复订单回执均测试。 |
| 客户/产品/认购/客服等历史被固定上限截断 | 改为数据库每批 200 条读取全部结果，保留现有接口结构和筛选权限；产品列表不批量读取原始图片。覆盖客户、产品、基金认购、客服历史/会话列表、资料待审及 IPO/净值基金相关历史。551 个客户、131 个产品、205 个认购和 250 条客服消息全部读取验证通过。 |
| 基金到期和 IPO 配售缺少铃铛通知与跳转 | 通知从已提交完成的认购和配售记录生成稳定事件，不随重复请求制造重复事件。桌面与手机点击基金到期提醒进入基金认购记录；点击 IPO 配售进入申购配售窗口。两端浏览器实际点击验证通过。 |
| 到期任务只处理前 100 条，失败可能阻塞其他任务，没有可处理告警 | 使用按到期时间和 ID 的游标分批处理。205 条集中到期中前 105 条故意失败，其余 100 条仍返还成功。失败写入原审计表；总账户铃铛、返还待处理列表和重新返还按钮落地。解除故障后补齐全部 205 条，重复重试不会重复入账。子账户无失败队列处理权限。 |

镜像中的客服回复仍以总账户身份记载，不把管理员回复伪装成客户消息。镜像的资料/权限管理沿用“管理客户”已有接口；代客交易仍受客户只读限制、产品密码、持有期、可用余额和价格规则约束。

## 验收证据

- 全部 14 组：artifacts/acceptance-ew5tKu，全部通过，源码哈希一致且运行期间未变更。
- 使用线上实际 CSP 响应头再验镜像：artifacts/acceptance-lHQqfs，买入、代卖、隔离、资金限制与审计回滚通过。
- 515 笔订单/14 个持仓及统计：artifacts/account-history-aQPqwf。
- 基金原档位/返还/故障回滚：artifacts/configurable-XqDXhq。
- 提现预留/重复请求/121 条资金记录：artifacts/delivery-boundaries-TYAl0k。
- 批量故障及超原列表上限：artifacts/fund-queue-ExYD2J。
- 上线后入口/Logo/统一图标/匿名拒绝：artifacts/delivery-online-nIaj0a。
- 本版证据另存 records/delivery-2026-11-10/ee68a1cf-d1b9-4590-beaf-7a6f2d8c236a，保留上一版记录。
- 原有静态资源、密钥绑定、运行设置、两个域名和数据库连接发布核验通过。没有增加数据库表或修改生产客户资料。

## 本轮修改文件与复测

业务：src/worker.template.mjs.in、src/products/service.js。
界面：web/admin.html、web/desktop.html、web/mobile.html、web/products-ui.js。
构建：scripts/build.cjs。
测试：qa/mirror-operations.cjs、qa/product-notifications.cjs、qa/fund-queue.cjs、qa/permissions.cjs、qa/isolated-server.cjs。
验收保存：scripts/acceptance.cjs、scripts/delivery-online.cjs、scripts/save-delivery-records.cjs。

在 cloudflare-release 目录运行：
- node scripts/build.cjs
- node scripts/acceptance.cjs
- node qa/account-history.cjs
- node qa/configurable-products.cjs
- node qa/delivery-boundaries.cjs
- node qa/fund-queue.cjs
- node scripts/delivery-online.cjs

## 必须保留的验收边界

- 订单、审核、余额和持仓业务测试使用隔离库；线上验证为实际发布状态、三端入口、资源、安全策略和接口访问保护，没有在生产客户账户做资金写入验收。
- 浏览器手机模式不是安卓/iPhone 物理真机。本次不能声称实际 Safari、Telegram 内置浏览器、振动硬件全部验收通过。
- 批量 205 条故障测试和 551 客户读取测试，不等于生产多连接压力、长期稳定性或备份恢复演练。
- 列表接口目前保持完整数组兼容，分批读取后合并返回；大用户量的前端渲染和响应体开销仍需压力测试，不宣称无限容量。
- 仍使用已经同意的延迟参考价。实时买卖盘、券商通道不在当前范围；不能把参考源和 TradingView 的展示价说成同一个实时价格。
