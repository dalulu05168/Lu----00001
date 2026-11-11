# 产品通知及图表实际渲染回归

发布：93c03f86-0861-4cda-9249-afffbfb39aae，100%流量；SHA256 019c7c3a29e59d3fd2af034c6c47358e6de1530d2262057b1042d8e58fe4e249。

## 实际修改
- mobile-client/experience.mjs：IPO配售通知直接打开申购与配售记录，不再停留产品目录。
- qa/chart-render.cjs：改用当前手机版真实登录、市场、股票详情入口。真实外部图表必须同时含画布、SPY名称和可见行情数字，空白框不算通过；修复隔离测试Logo路由。
- qa/product-notifications.cjs：改为当前手机版通知入口，验证基金到期、IPO结算通知打开对应记录；保留总账户失败返还任务提醒及重试验收。
- experience.test.mjs：配售通知目标路径断言。

## 证据和边界
- acceptance-Swv1o0：原线上构建的forms、registration、sessions、permissions通过。charts旧选择器失败；product-notifications暴露当前手机IPO路径仅打开目录。原始结果保留account-funding-regression-20261111.json，未抹掉失败项。
- acceptance-JADer6：修复构建charts、product-notifications、experience、mirror四套通过；通知、公告焦点刷新、镜像审计和权限回归。
- 复查图表截图后发现旧断言仅证明画布存在，因此加强可见数字校验。acceptance-Dh0xN3最终图表测试通过，保存两端实际图形截图及外部页面文字；SPY图表显示749.92、-2.77、-0.37%。仅证明当前浏览器外部图表渲染，不证明行情当前交易日最新，也不代表目录报价或成交定价核验通过。隔离目录价格使用350.69固定报价，不能当真实SPY报价。
- 手机单元测试17项通过。
- 线上18项保护/资源/内容哈希检查通过；三端新会话真实浏览器入口检查通过。未写生产正式客户业务。
- 原两个域名、9项绑定及静态资源保留，无数据库迁移。
- m子域名按用户决定暂缓，现有Vercel记录未变。物理设备、生产多连接负载及生产恢复演练仍未验收，不能称全平台交付完成。
