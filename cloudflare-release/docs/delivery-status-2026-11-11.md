# 当前交付验收状态（2026-11-11）

生产：5a210001-825b-4744-bd7f-ee9a626acf65；有效源码在当前delivery/unified-platform-audit分支。旧审计报告是历史快照，不能当成当前上线状态。

| 范围 | 当前验收事实 | 证据 |
| --- | --- | --- |
| 业务入口、控件与品牌 | 已发布，前一业务修复十组隔离回归通过；追加登录品牌三组通过 | layout-controls-fix.md |
| 公告和新闻 | 已发布；桌面/当前手机新闻组件内部条目实际渲染；发布撤回焦点刷新通过 | news-sync-fix.md |
| 角色、代客操作、资金和客服 | 隔离权限/事务/回执/镜像场景通过；生产不写正式客户业务 | layout-controls-acceptance.json、news-sync-acceptance.json |
| 生产入口 | 两域名资源、内容、访问保护18项；干净桌面手机后台浏览器登录入口检查通过 | news-sync-online.json、news-sync-browser-entry.json |
| 并发与本地恢复 | 相同键12请求单次创建、不同键不超买超卖；39表恢复一致 | concurrency-recovery-fix.md |
| m子域名 | 仍未迁移，浏览器工具禁用且DNS读取403；未动原记录 | news-sync-fix.md、concurrency-recovery-fix.md |
| 物理设备 | 未执行真实iPhone、Android实机验收，浏览器模拟不能替代 | 待补 |
| 生产容量、恢复、实时行情及App | 未完成，不承诺可正式交付运营；需各自演练/授权/验收 | 待补 |

运行方式、修改文件与实际结果见各专项记录。当前没有把隔离测试通过等同于整个平台交付通过。
