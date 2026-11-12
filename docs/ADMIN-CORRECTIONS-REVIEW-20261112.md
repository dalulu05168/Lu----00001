# 后台修正版验收记录

2026-11-12。本地候选供审核，尚未发布。分支 feat/admin-next，HEAD 7362714。现有未提交改动保留。

## 实际修复

- 客户账户、订单、持仓、资金审批、证券、客服、结算、权限和审计等列表移除正文重复页面标题。页面名称保留于顶栏 h1。
- IPO 与基金页移除重复标题和用户标出的底部说明。结算影响仍由实际提交前的确认流程展示。
- 导航取消胶囊及彩色底，选中使用文字和中性细线。普通操作按钮保留胶囊及浅绿反馈，数据卡恢复矩形圆角。
- 工作台两卡片等高，与趋势区保留独立间距。
- 出入金趋势新增按日期的显式提示卡，显示入金、出金、净流入。支持鼠标、触屏、方向键、Home、End 和 Escape。空日期显示零额。
- 兼容配置页隐藏旧版顶栏，保留原来的开通和配置流程。可返回列表或在独立窗口打开。
- App 镜像页改为明确的实机接入状态，原客户网页预览保留独立入口。

## 实机功能的实际缺口

现有代码通过旧 mountMirror 在 iframe 中渲染客户网页，并转发授权业务请求。本次检查 src、web、mobile-client 与 ops，未发现手机设备注册、屏幕视频传输、ADB/scrcpy 或 WebRTC 实机连接服务。
手机实机投屏和远程操作尚未完成。当前页面展示未连接与服务待接入状态，不能据此声称实机功能可用。

## 本次修改文件

- cloudflare-release/web/admin-next.js
- cloudflare-release/web/admin-next.css
- cloudflare-release/web/admin-next.html
- cloudflare-release/qa/admin-next.cjs

修改前备份位于 cloudflare-release/artifacts/admin-corrections-before-pEDR41。已有开发说明保留。

## 构建与验证

独立构建使用 scripts/build-admin-design.cjs，基于最后留存的发布包 admin-acceptance-W72kAi。源代码通过 node --check。

候选包 cloudflare-release/artifacts/admin-design-FqWpBT/worker.mjs

SHA-256 3fe044fa7327d9bcf878a0131aeb35f1baab2e409734c71f181fd52d86815040

内容比对确认后端代码、电脑与手机客户页、登录页和原后台页与基准包完全一致。本次更改位于嵌入的新后台页面。

7 套隔离回归通过，0 套失败。覆盖 admin-next、browser-sessions、security、permissions、mirror、contracts、admin-funding。

最终专项复测 admin-next 和 admin-funding 共 2 套通过，0 套失败。它们与前 7 套有重复，不累计为 9 套不同测试。

专项增加十个页面的重复标题检查与截图、卡片几何对齐、图表鼠标/键盘提示、触屏提示、Logo 加载和手机横向溢出检查。资金审批专项注入审计失败，确认余额和审批状态回滚，重试入账与审计一次。

隔离测试仅访问本机回环接口与虚构数据库。测试不证明所有业务场景或生产环境都没有问题。

## 核验材料

- cloudflare-release/artifacts/acceptance-SPZZYH/results.json
- cloudflare-release/artifacts/acceptance-CLmHqL/results.json
- cloudflare-release/artifacts/acceptance-CLmHqL/admin-next/results.json
- cloudflare-release/artifacts/acceptance-CLmHqL/admin-funding/qa.log
- 最终截图位于 cloudflare-release/artifacts/acceptance-CLmHqL/admin-next，包含 funding-hover.png、page-settlement.png、page-mirror.png、mobile.png 和其余列表截图。

## 待处理

- 手机实机连接需实际设备接入和传输服务。
- 动态 RBAC 与完整原生化等早前规划未在本轮实现。
- 生产部署待用户审核本地修正版。
