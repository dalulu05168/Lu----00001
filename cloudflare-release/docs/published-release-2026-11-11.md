# 已发布批次：资金与客服恢复、手机净值基金

本批已发布到现有 Cloudflare Worker `lu----00001`，不是仅候选文件。

- 实现提交：`9fea07e`。
- 新生产版本：`ce415187-1efa-4eaa-bb41-1dc35ae0d59a`，100% 流量。
- 上一版本：`bea31227-64c7-4cbe-8141-01862b6b7edf`。
- Worker SHA256：`b0894289ce933e19b6ace762d3ff5a81f5aa3cc83fabbc2f850e5bf6b6a3172d`。

## 数据库迁移

通过内部浏览器 Neon SQL Editor，在项目 bitter-heart-61838251 的 main 分支 br-crimson-morning-b3rhjeoi / neondb 中执行新增回执表和索引。事务设置 5 秒锁等待、20 秒语句超时；未更新或删除既有业务行。

单独 SELECT 复核：cn_write_receipts 已存在，6 列、2 个索引、0 条回执；既有用户和账户迁移前后均为 9 条。截图保存在 artifacts/publication-9fea07e/neon-schema-verified.png。

## 发布和上线检查

上传时保留原 assets、所有 binding 类型以及运行时设置，核对新旧完整绑定相同、域名未变，再启用新版本。启用后再次确认版本 100%、9 项绑定和两个域名保持。

线上 18 项检查通过：数据库 ready、Logo 字节一致、未登录业务接口拒绝、电脑/手机主域名/后台页面与已验收构建逐字节一致。内部浏览器实际检查后台显示邮箱、密码、2FA 登录表单；客户前台退出后返回主域名登录页。未创建正式资金申请或交易。

结果摘要见 published-release-2026-11-11.json。完整本机证据位于 artifacts/publication-9fea07e/，不提交凭证或生产用户资料到 Git。

## 尚未完成

- m.nuvexapro.com 仍为独立 Vercel 站点；本批手机新功能在 nuvexapro.com 手机访问入口生效，没有变更 m 的 DNS。
- 手机生产页面已验证返回内容与验收构建一致；物理 iPhone/Android 的在线交互未验收。
- Logo/字体/切页视觉全量统一、报价源覆盖与生产全量业务验收继续按计划进行。
- 本批发布不代表整个项目已经达到正式运营交付标准。

## 下一阶段已检查的差异

手机客户端仍使用 NUVEXA 字标及偏橙色设计 token，电脑前后台使用黑色 CN Logo 和蓝色按钮；需要统一品牌资源及基础色。手机和电脑的字号体系、导航层次不同，要在保留各设备布局的基础上统一字体、按钮、加载/错误状态。不得以更换 UI 覆盖已验证的表单、订单恢复与权限实现。
