# 基金持仓关联、报价校验及镜像遮挡修复

## 根因与修改

1. 持仓接口漏出产品 ID：`/api/product-settlement` 的持仓列表只有名称、代码和数量，手机详情按 `product_id` 关联，导致已有基金份额显示为零。`src/worker.template.mjs.in` 在持仓查询中增加 `product_id`，不改变账务或持仓本身。
2. 查看报价缺少校验：目录和交易已检查标的、市场、价格和时间，查看报价及后台识别直接透传供应商结果。`src/products/service.js` 新增统一校验函数，覆盖发布识别、产品保存、目录、查看报价和下单。沿用原有最长五天延迟、未来最多五秒容差；不宣称改为实时行情。
3. App 镜像关闭按钮原来覆盖客户铃铛：`web/admin.html` 将关闭按钮移到独立的 36px 控制行，手机内容不增加模型边框；按可用高度保持比例。

没有数据库迁移，没有修改生产客户数据、产品价格或资金权限。

## 实际验收

- 先在旧实现复现两项失败：基金持仓缺少 `product_id`；过期报价查看接口返回 200。修复后同一场景通过。
- 手机基金详情：初始 7.5 份，赎回后 7 份，申购后 8 份，再赎回后 7 份。刷新重新登录后仍显示 7；记录页、桌面持仓与后台子账户镜像一致。
- 隔离产品交易最终 7 笔订单、2 项持仓、现金 85250 分；属于本机验收数据，未注入生产。
- 后台页面实际创建期限基金和大宗产品，电脑和当前手机界面均可读取发布内容、认购基金和买入大宗股票；锁定期卖出拒绝。
- 注入六类无效报价：过期、未来时间、错误代码、错误市场、缺少时间戳、无效价格。客户报价、管理员识别、目录与下单一致拒绝；无订单、无扣款。手机不显示可提交表单。
- 产品修改后旧版本下单拒绝；下架后目录移除且不能新下单。有效交易只生成一笔，现金 68438 分。
- 镜像 1440×900 与 390×844 浏览器尺寸实测：关闭按钮在 iframe 上方，不覆盖铃铛，内容不超出视口。

证据：`fund-position-quote-acceptance.json`、`fund-position-quote-ledger.json`、`product-quote-guards-results.json`，以及本机 artifacts 中的浏览器截图。七套隔离回归及 19 项手机单元测试通过。

## 重跑

配置已有验收依赖 NODE_PATH，在源码仓库执行：

```powershell
node --test mobile-client/adapter.test.mjs mobile-client/experience.test.mjs
node cloudflare-release/scripts/acceptance.cjs quote-guards products product-browser contracts product-recovery mirror stocks
```

## 范围限制

报价异常验收使用隔离注入，未证明生产供应商当前价格有效或实时授权已开通。浏览器尺寸验收不等于物理 iPhone/Android 验收；生产多连接容量和灾备仍未验收。m 子域名保持暂缓迁移决定。

## 发布验收

Worker `lu----00001`：版本 `208240f2-4522-4102-acb4-b4ef08cf13b0`，100% 流量。

SHA256 `ae7a95d21de3d8fdbe7996e2905b28153409d478a146b606ddf0119cc45d7e09`。原绑定、静态资源和主站/后台域名保留；18项线上检查及三端浏览器登录入口通过。见 `fund-position-quote-online-verification.json`、`fund-position-quote-online-entry.json`。
