# 公告同步与手机新闻专项验收

发布版本：5a210001-825b-4744-bd7f-ee9a626acf65，100%流量。构建SHA256：81b1320a245ef94f98f4564f61dc27ae3bef46ea8e6cc6d12fffdef8bfe42cca。

修改：build.cjs 将与桌面相同的news-ui.js注入当前手机及后台镜像包；mobile-client/app.mjs增加市场新闻、个股相关新闻入口，复用统一全屏新闻弹窗。未另建新闻数据库或行情定价服务。

根因：旧experience脚本直接向本地存储放token并查旧data-a手机导航，当前手机使用内存会话和data-go导航，必须走真实登录；新手机包原本也没有共享新闻入口。本次同时修复实现和脚本，未仅调整断言掩盖缺失。

同构建experience、mirror、layout-controls、sessions四组通过：
- 总账户公告发布、旧版本并发更新拒绝、子账户不能发布；审计保留。
- 桌面和手机读取新公告，撤回后触发焦点刷新，两端移除原公告。
- 桌面TradingView新闻内部frame出现文章链接；当前手机新闻内部frame出现文章链接，390px全屏弹窗，关闭后恢复首页。仅验证组件实际渲染及导航，不将新闻文章事实或供应商最新性称为逐条核实。
- 子账户代所属客户买入、总账户卖出、响应丢失重试恢复、归属隔离、资金限制及审计回滚通过。
- 业务入口、客服发送、IPO入口与会话登录退出刷新回归通过。

移动端16项单元测试通过。隔离证据：artifacts/acceptance-N5LSPd/。截图来自假账户；无生产客户业务写入。正式HTTP/内容18项检查及三端干净浏览器登录入口复检通过，见news-sync-online.json、news-sync-browser-entry.json。原绑定和静态资源保留，无新数据库迁移。

## 子域名与剩余范围

nuvexapro.com与admin.maacropierce.com仍是Cloudflare Worker lu----00001的现有域名。m.nuvexapro.com仍返回Vercel；不声称已统一。当前Cloudflare OAuth的zone查询成功，但DNS记录读取403 Authentication error，无法先备份和检查现有DNS。用户表示浏览器已开启后，重新初始化工具仍明确返回Local browser use is disabled in Work settings；因此未覆盖未知DNS记录，也未操作其他浏览器绕过权限限制。

物理iPhone/Android、App商店、备份恢复与压力测试仍未验收。不能把本次专项通过等同整个平台完成交付。
