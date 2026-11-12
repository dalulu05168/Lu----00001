# 后台复测记录 — 2026-11-12

结论：本地已实现功能的主要回归通过，但整体验收未完成，禁止据此宣布全部功能合格或进入前台开发。

## 测试对象与隔离

- 分支 feat/admin-next；HEAD 7362714a37f10dc2807b6d33674bccecd0231044，工作区有此前开发产生的未提交修改。
- 候选包 cloudflare-release/artifacts/admin-design-D2f2Bk/worker.mjs；SHA256 2602f2802519670a3eb761b27932c5fe8df4abc0e1f5f906e289d935a0bfeee8。
- 这是未发布的 ADMIN_ONLY 候选包。candidate.json 记录的线上来源版本为 247ae441-584b-4720-8d6b-0852567ca706。
- 原 acceptance runner 中 baselineVersion 来自旧 release-manifest，不能作为实际部署版本证据；以 candidate.json 的来源字段为准。
- PGlite 隔离数据库、假客户、回环 API 和浏览器；预加载器拦截非本机网络。未连接生产 Neon、未生产部署、未执行真实资金操作。

## 实际结果

| 项目 | 结果 |
|---|---|
| 候选包回归套件 | 26 套，24 通过，2 未通过 |
| 三类账户 API 权限断言 | 38 项通过 |
| 页面布局矩阵 | 72 项通过 |
| 当前源码新闻/结算单测（另计） | 6 项通过，0 失败 |
| 隔离数据库备份恢复（另计） | 40 张表、434 项约束、1 个序列一致，资金流水与余额及持仓一致 |
| 候选包及新增测试语法检查 | 通过 |
| 候选包摘要 | 测试前后未改变，未修改发布摘要 |

三类身份是现有服务端模型 MASTER（总管理员）、SUBADMIN（子管理员）、CLIENT（普通客户），不是三种后台管理员角色。客户管理 API 返回 403；子管理员创建子管理员的提权请求被拒绝；所属客户隔离、会话撤销、资金审批限制均已通过现有权限回归。

布局矩阵覆盖两种管理员身份 × 12 个工作区 × 1440×1000、1280×720、390×844 三种尺寸。普通客户另验证管理界面拒绝访问。检查内容：可见文字字重不超过 400、一个顶栏主标题、内容区无重复同名标题、平直无背景导航、页面无横向溢出。保存并抽查了截图；这些断言不等于所有视觉细节均获得业务方审美确认。表格仍允许在内部横向操作，滚动条隐藏，不通过裁断数据阻止滚动。App 镜像为移动网页，不是硬件远控，390×844 CSS 视口与独立手机登录页一致。

通过的核心流程包括：登录/Cookie/CSRF/后台二次验证、子管理员越权及所属客户边界、资料审核与版本冲突、资金双重审批与入账核对、并发买入及余额保护、重复请求回执、报价异常拒绝、产品发布及恢复、客服与公告、IPO/基金复核、审计失败回滚、手机镜像双向自选同步、资金趋势鼠标及键盘检查、列配置/筛选/导出。

## 两项未通过

1. news：真实新闻源浏览器测试预期成功响应带 public,max-age=60，实际外网被 OFFLINE_VALIDATION 拦截，服务返回失败响应 no-store。未绕过网络策略或改为伪造成功。
2. experience：同样依赖真实新闻卡片，离线环境无新闻卡片导致等待超时。

4 项本地新闻服务单测覆盖并发请求去重/ETag、原文日期、安全链接和去重、失败恢复与重定向拒绝，但不能替代上述真实源端到端验收。这两套必须保留为未通过。

## 本轮修正

- 新增 qa/admin-account-layout.cjs：账户权限与 72 项布局检查。初跑通过 hash 切换并不会重新加载应用，造成测试超时；改为带独立查询参数的真实页面加载后通过，不改产品导航。
- qa/permissions.cjs：把旧 470–480px 镜像断言更新为已确认 390×844px，保留原有权限/客户隔离/会话测试，复跑通过。
- 未因测试失败修改业务权限、发布摘要或生产系统。

## 仍需说明的功能缺口

动态自定义 RBAC 仍未整合；不能用当前固定角色测试代替该功能验收。BVB 服务、跨账户资产/风险汇总及部分市场数据仍是待接入项。普通股票订单类型、手续费、休市和结算规则尚未正式确认，不能伪造成完整订单生命周期。真实外部图表/行情服务、生产 Neon 表结构与生产部署运行状态未在本次离线检查中认证。

## 证据

- 机器汇总：cloudflare-release/artifacts/admin-design-D2f2Bk/comprehensive-acceptance.json。
- 主要 16 套初跑：cloudflare-release/artifacts/acceptance-laS64T/results.json（其中两个初始失败保留）。
- 布局复跑：cloudflare-release/artifacts/acceptance-1wFY2B/results.json。
- 权限尺寸复跑：cloudflare-release/artifacts/acceptance-BgAqdW/results.json。
- 补充 10 套：cloudflare-release/artifacts/acceptance-Ikm6ze/results.json。
- 备份恢复：cloudflare-release/artifacts/recovery-EAaz8E/report.json。

当前停点：后台验收未全部合格，不进入前台、不发布。
