# 三端公共样式修复验收 — 2026-11-12

## 已发布

- Worker: lu----00001
- Version: 08bbfd25-0773-4af5-8600-81367ea90ca7，100% 流量。
- Source SHA256: 22e75fd3d25c06364062dc95fd0b30477c75b14e22f1a8aa9e35c18379473423
- 正式入口: https://nuvexapro.com/ 、 https://admin.maacropierce.com/ 。

## 修改范围

- web/design-system.css: 三端、登录页及后台手机镜像共用字体顺序、字号、控件及动效变量。
- scripts/build.cjs: 所有正式页面和嵌入镜像统一注入公共样式。
- 修正新闻按钮旧圆角覆盖、IPO 关闭按钮不足 40px、客服发送区被旧规则压至 12px 的问题。桌面操作目标至少 40px，手机新闻按钮至少 44px。
- 手机行情公司名、价格、时间及指标说明提高到 12–15px；保持资产大数字的层级。
- 页面、普通弹窗及新闻卡片统一 180ms 从上向下淡入；尊重减少动态效果设置。
- 没有改动生产数据库、业务规则、账户权限、密钥或客户数据。

## 验证

1. node cloudflare-release/scripts/build.cjs --record
2. NODE_PATH 指向已安装测试依赖后运行 node cloudflare-release/scripts/acceptance.cjs news layout-controls mirror browser-sessions experience
3. 五组均通过: artifacts/acceptance-d3Iexc/results.json；同一 source SHA256，sourceUnchanged=true。布局截图补充: artifacts/acceptance-j2oCBs/layout-controls/。
4. 实际浏览器验证字体、按钮高度/圆角、客服输入与发送对齐、基金发布/认购、大宗下单、IPO 入口、消息跳转；320/390/412px 列表无重叠，新闻 360/390/412/768px 无横向溢出；减少动态效果时禁用切页动画。
5. 隔离库镜像代客买卖、响应丢失后重试去重、归属隔离、出入金限制及三端 Cookie 登录通过。
6. 正式发布后 18 项 HTTP 检查通过，三端页面内容与验收构建一致，数据库连接及权限保护正常。
7. 匿名真实浏览器打开两个正式域名的电脑/手机/后台登录页面，等待入场结束后截图；三端公共字体加载，无横向溢出及 JavaScript 异常。详情见 design-system-online.json。
8. 发布工具核对原绑定、域名和静态资源保留；没有数据库迁移，复用以前的 schema 验证记录，不代表本次重新执行迁移。

## 验证边界与遗留

- 这批是公共视觉修复，不代表整个平台所有业务已完成交付验收。
- 生产浏览器仅匿名只读检查；登录后买卖等写操作仅使用隔离库。未用真实客户数据进行生产下单或审批。
- 手机为 Chromium 设备模拟，未连接 iPhone/Android 物理设备。
- m.nuvexapro.com 仍为旧 Vercel，按用户要求暂不迁移。
- Cloudflare 版本预览域名受现有主机名路由约束，返回旧页面，未将其误报为新 UI 预览验收。最终已在正式绑定域名核对新构建。
- 财经阅读来自 FinVibe，按实际发布日期展示，不能称作当日实时财经新闻；第三方图表/报价授权状态未在本次改变。

## 回退

上一版本 8048aea1-de5f-4e53-9a04-8e4395a23abb。发布基线、配置比对和验证保存在 artifacts/publication-design-system-20261112/；如需回退须按照既有发布程序确认当前活动版本后操作，本次未执行回退。
