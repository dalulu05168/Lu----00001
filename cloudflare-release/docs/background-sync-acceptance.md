# 手机后台刷新修复验收

## 修改

- mobile-client/app.mjs：静默读取账户、目录、自选、公告、资料；只在安全页面重新绘制；读取过程中切页或退出不回写旧页面。
- mobile-client/experience.mjs：复用15秒通知调度，focus/online立即取数；隐藏时暂停、请求串行，表单编辑和交易确认不自动重绘。
- mobile-client/experience.test.mjs：新增编辑保护与调度测试。

## 实际验收

15项适配及体验单元测试通过。Pixel 7浏览器profile实际验证：

1. 隔离总账户审批充值后，客户余额自动刷新，显示金额与账户接口一致。
2. 客服填写但未发送的草稿在online刷新事件后保留。
3. 隔离总账户发布新公告后，客户首页自动显示，不手动刷新。

证据：桌面手机端/integration-tools/evidence/run-fXlrah/background-sync-results.json。测试只写隔离库，非生产业务操作，非物理真机验收。

## 边界

本次未发布。未解决资金申请和客服发送的服务器幂等协议；未完成全平台同步和所有页面验收。轮询不等于实时WebSocket，后台变化一般在下一次可见页轮询读取。
