# 子账户邮箱按钮可读性修复

原因：旧规则 `#t-sub .sub-open-email` 使用深橄榄背景，ID 选择器优先级高于统一浅色控件规则，导致深底深字残留。

修改 admin.html 中的该规则及 hover/focus 状态：浅底 #f5f8fc、蓝字 #1255a5、胶囊边框。未修改子账户功能、归属或数据。

permissions 隔离浏览器实际计算对比度 6.87:1；截图人工检查清晰，点击进入客户列表及权限回归通过。构建 SHA256：333f49b242ab01c9823abc17f4b7030f49505f96ec1775e0399dc304595641cd。验收摘要见 subaccount-control-acceptance.json。

已发布版本 4be57bc9-d4a9-4601-b62f-69258211246e，100% 流量。原绑定、静态资源、域名保留，不涉及新数据库迁移。线上 18 项检查通过，并单独核对 /admin 返回 HTML 与修复构建完全一致。

本机证据：artifacts/acceptance-kuOVaM/permissions/subaccount-controls.png、subaccount-contrast.json；artifacts/publication-subaccount-ui-20261111/。线上登录保护有效；本次认证后样式截图来自隔离账号，未冒充生产账号截图。
