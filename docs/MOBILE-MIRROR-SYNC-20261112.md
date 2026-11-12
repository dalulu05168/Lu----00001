# 手机前台镜像恢复验证

2026-11-12。本地修正版，待审核。

用户所指为后台手机前台镜像与实际手机前台使用同一账户和业务数据。本次已恢复此入口。此前关于远程控制手机硬件服务缺失的判断不适用于这项需求。

## 实际修改

- App 镜像页提供授权客户选择、重新加载和关闭。
- 直接复用原 openClient / mountMirror 与 client-action 授权接口。镜像中隐藏旧后台页面与顶栏，只显示原手机前台。
- 为原后台添加同源初始化适配，保留 iframe 的 allow-scripts allow-forms 沙箱，不增加 allow-same-origin。
- 修复重新加载镜像时遗漏旧版会话入口标记的问题。
- 保留本地修正版的单标题、平直导航、卡片对齐和趋势悬浮提示。

## 实际验证

在隔离数据库中，同一虚构客户的直接账户接口和代理镜像接口返回的余额、持仓及订单一致。

通过新后台镜像界面加入 AAPL 自选；独立浏览器中的手机前台登录同一虚构客户后实际显示“移出自选”。再从手机前台移除，重新加载后台镜像后实际显示“加入自选”。关闭入口清空镜像。

最终候选的 admin-next、mirror 两套测试均通过，0 失败。原镜像交易测试覆盖重试去重、买卖记账、客户范围及审计失败回滚。

前一候选另有 browser-sessions、permissions、security、contracts 四套通过记录。最终候选相对该候选只调整了镜像容器定位。

首次新入口测试因缺少会话入口标记失败，之后重载缺少该标记也失败，均已修复。测试登录种子在沙箱子页访问 localStorage 导致的报错通过限定测试注入范围修复，保留页面错误检查。

测试使用本机 API 和虚构数据，外部行情及新闻在离线测试内受阻，本轮不据此声称外部图表或生产同步已经验收。

## 交付与证据

- 候选 artifacts/admin-design-4JWM5I/worker.mjs
- SHA-256 cbfacf89079eda19386b1b4ee8ccd104ce3b7525fc17aff96765430b81c421a1
- 最终测试 artifacts/acceptance-EuVjxq/results.json
- 安全回归 artifacts/acceptance-54p1HT/results.json
- 后台镜像截图 artifacts/acceptance-EuVjxq/admin-next/direct-mobile-mirror.png
- 独立手机前台截图 artifacts/acceptance-EuVjxq/admin-next/customer-mobile-same-watchlist.png

内容比对确认后端业务代码、电脑客户页、手机客户页及登录页与基准包一致，原 MIRROR_TEMPLATE 内容一致。修改仅涉及新后台及镜像初始化适配。

源码改动涉及 web/admin-next.js、web/admin-next.css、web/admin.html、scripts/build-admin-design.cjs 和 qa/admin-next.cjs。发布清单、原始历史目录及生产数据库均未在本轮修改。本地修改尚未提交、尚未部署。

## 手机视口尺寸修正

默认参考视口为 390×844 CSS 像素，用户未指定具体手机型号。恢复固定手机比例，覆盖旧版的480像素加宽规则；新旧后台镜像均使用同一尺寸样式 web/mirror-viewport.css。较窄容器按比例缩小。

最终候选 artifacts/admin-design-D2f2Bk/worker.mjs，SHA-256 2602f2802519670a3eb761b27932c5fe8df4abc0e1f5f906e289d935a0bfeee8。

实际浏览器验证镜像 innerWidth/innerHeight 和独立手机前台均为390×844。新后台与原镜像两套测试通过，0失败，资金/权限/重试相关原镜像回归通过。候选仍为本地待审。

截图 artifacts/acceptance-7ebwv9/admin-next/direct-mobile-mirror.png。
