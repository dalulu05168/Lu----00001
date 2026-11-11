# 手机品牌标识修复验收

- 发布版本：dde4cf4d-d312-4f28-9b22-3c95ed2f7ce9，100% 流量。
- 手机共用 Logo 规则强制黑色、全不透明，保持原 CN 图案；登录页及后台手机镜像使用相同模块。
- 我的账户头像 N 居中；底部“我的”圆形入口加入 N。
- 修改：mobile-client/app.mjs、mobile-client/integration.css；对应浏览器回归位于 qa/layout-controls.cjs、qa/online-entry.cjs。
- 隔离浏览器 layout-controls 和 mirror 两套通过；手机单元测试 16/16。头像尺寸与中心偏移均有断言，保留截图 mobile-profile-brand.png。
- 线上发布检查 18/18；原静态资源、9 项绑定和两个原域名保留。桌面、手机、后台新会话入口检查通过，手机 Logo 加载成功且计算样式 brightness(0)。
- 未操作生产客户数据；已登录账户头像检查使用隔离数据。未进行物理 iPhone/Android 真机验收；m.nuvexapro.com 的迁移仍未完成。
