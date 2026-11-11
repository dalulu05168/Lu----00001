# 交易弹窗与手机导航修复

已发布：1d496fff-980b-4564-97a2-6cd3255458fc，100% 流量。构建 SHA256：9cfb2f150d5785aa58b96d90ae0f26504dcc6d85ae045ab40e8bd3750464612a。

- desktop.html：订单预估读取目录有效报价，数量变更同步计算；无有效报价禁用预览；数量验证安全整数。服务端成交校验及幂等未改。
- ui-refinements.css：订单弹窗浅色数量控件、清晰字段文字、居中标题、右上关闭、卖出红色按钮、响应式尺寸；修复旧 !important 高度覆盖。
- mobile-client/app.mjs：请求或刷新期间主导航显示禁用状态，避免点击被业务 busy 拦截而无响应。
- qa/stocks.cjs：新增样式实测、有效报价预估、无报价预览拦截；保留9笔交易和余额持仓对账。
- verify-published.cjs：移除未经当次浏览器操作即写 true 的登录/退出标记；HTTP检查与浏览器检查明确区分。

隔离验收 artifacts/acceptance-0AhLbj：stocks / forms 均0。两端身份银行卡锁定、充值无PIN、错误提现PIN、余额不足、重复审批对账通过。截图 sell-modal.png 为隔离账号，不是生产客户截图。

原资源、9项绑定及域名保留，无新迁移，无生产客户业务写入。线上18项 HTTP/内容校验通过，见 trade-modal-online-verification.json。

尚未完成：experience 专项在新版手机入口公告显示等待失败，该脚本仍使用旧移动会话与导航选择器，必须适配后重测，不能计为通过；物理真机和认证后生产业务操作未验证。m.nuvexapro.com 仍是旧 Vercel，不声称已迁移。三端品牌/字体/页面切换及公告新闻整体回归仍需继续。
