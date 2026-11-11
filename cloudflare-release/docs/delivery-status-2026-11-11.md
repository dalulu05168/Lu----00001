# 当前交付验收状态（2026-11-11）

生产版本：8b702a26-f7dd-43b3-b9b4-4c73529e8060，100%流量。有效源码在delivery/unified-platform-audit分支。

|范围|实际状态及证据|
|---|---|
|业务入口、目录和控件|已发布；layout-controls-fix.md记录此前业务回归|
|黑色Logo、头像N及消息排版|已发布；mobile-brand-black-fix.md、mobile-notification-layout-fix.md|
|账户、资料、资金权限|原版本本轮forms/registration/sessions/permissions通过；account-funding-regression-20261111.json同时保留旧图表测试失败，不把整批称为通过|
|产品通知|本轮修复手机IPO通知直达配售记录，基金到期、失败返还重试通过；product-notification-routing-fix.md|
|行情图及新闻|两端外部SPY画布和价格数字实际显示；chart-visible-data-results.json。仅证明渲染，不证明报价时效或内部成交价正确。新闻组件渲染及公告同步已回归|
|角色、代客操作|隔离镜像、归属限制、资金权限、审计回滚和丢响应重试通过；本轮mirror回归|
|并发与本地恢复|同键12请求单次创建，余额/持仓不足不超额；39表本地恢复一致；concurrency-recovery-fix.md|
|生产入口|18项线上检查通过，三端浏览器登录入口通过；不冒充生产客户业务写入验收|
|m子域名|按用户决定暂缓迁移，保留Vercel旧指向，仅分发nuvexapro.com|
|未完成交付项目|物理iPhone/Android、生产多连接容量及恢复演练、全部报价供应商有效性/授权、正式运营与App审核未验收|

没有把隔离测试通过等同整个平台可正式运营。生产数据、静态资源、绑定保持原状。

本轮追加：共用手机列表修复（资料审核、IPO、净值基金、期限基金档位、产品入口、账户菜单），18个页面尺寸组合及四套业务回归通过；见shared-mobile-lists-fix.md。
