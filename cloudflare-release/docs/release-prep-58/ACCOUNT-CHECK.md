# 2026-11-13 账户侧增量核查

使用用户已登录的内置浏览器。未重跑已完成的功能测试，未修改生产数据、代码、secret、域名或流量。只在 Neon SQL Editor 执行系统目录/迁移元数据的只读事务，最终 ROLLBACK。没有读取客户行、密码或 Token。

## Cloudflare：已见的控制平面事实

账户 `8c0339e3cace4c6ecad7052224bd6ac5`，Worker `lu----00001`。

| 项目 | 本轮观察 | 证据页/限制 |
|---|---|---|
| 生效版本 | `860bea19`，100%，就绪；编辑器显示“活动/最新” | Deployments 与只读打开的 Quick Edit；UI 只显示短 ID。完整 UUID 仍以账户/API 后续导出确认，不能把仓库 UUID 当作本轮独立读取 |
| 自定义域 | `nuvexapro.com`、`admin.maacropierce.com` | Domains 列表，两项 |
| workers.dev | `lu----00001.dalulu05168.workers.dev` 已开启；Preview URL 也显示开启 | Domains；没有改开关 |
| Worker routes | Overview 显示 `—`，Domains 只有两项自定义域 | 未导出两个 zone 的完整全局 routes，因此不能排除其他 Worker/规则的覆盖 |
| Assets | Overview 显示 1 个资产绑定 `ASSETS` | Settings 通用连接绑定表显示“无连接的绑定”，这不等于 ASSETS 被删除；资产图明确存在。Quick Edit Explorer 只有 worker.mjs，不提供逐文件资产清单 |
| Secret 类型/名称 | 六项见下表，均“值已加密” | Settings；未编辑、未尝试揭示或复制 |
| 普通变量 | `PGSSL=require`，`COMMODITY_REFERENCE_EXECUTION_ENABLED=true` | Settings |
| Runtime | compatibility date `2026-11-08`；`nodejs_compat` | Settings |
| Observability | Workers Logs 开启、包括调用日志、保留到仪表板；采样 100%；Traces 关闭 | Settings，未改设置 |
| Cron 配置 | 一个触发器，可视界面 `Every 5 minutes` | 与仓库 `*/5 * * * *` 的含义一致；未取得原始 cron 字符串导出 |
| Cron 执行记录 | Cron Events 显示“过去一周没有发生任何事件”，并提示新/重命名 Worker 可能延迟 | 这是显示状态，不足以断言从未执行；尚不能证明基金到期结算执行成功 |

Secret 名称：`ADMIN_BOOTSTRAP_SECRET`、`ADMIN_MASTER_EMAIL`、`ADMIN_TOTP_ENCRYPTION_KEY`、`CN_PROFILE_ENCRYPTION_KEY`、`DATABASE_URL`、`EULERPOOL_API_KEY`。

当前只读浏览器检查**没有**核实 Assets 的配置细节/每文件哈希、完整版本 UUID、逐类型绑定原始对象或真实数据库指向。没有用旧 bundle 哈希冒充本轮云端 hash。

账户入口：[Cloudflare Worker](https://dash.cloudflare.com/8c0339e3cace4c6ecad7052224bd6ac5/workers/services/view/lu----00001/production)。只读打开 Quick Edit 后已退出；没有编辑源码或点击部署。Quick Edit 的内嵌预览显示 nuvexapro.com 拒绝框架连接，这不是账户登录失败，也不是部署故障证明。

## Neon：身份未与生产 Worker 建立证据链

组织 `org-calm-frog-98007214` 的项目列表实际有三项：

| 项目 ID | 显示名 | 分支数 |
|---|---|---:|
| `wispy-credit-51569987` | cn-capital-three-panel-preview | 1 |
| `bitter-heart-61838251` | global-stock-platform-free | 5 |
| `nameless-term-37081451` | nuvexa-p004-trading65-free | 1 |

**不能按名称确定生产数据库。** Worker 只暴露 `DATABASE_URL` 为加密 secret；控制台不能回读它的 hostname、database 或 role。本轮没有完整 URL，也没有读取/复制任何密码。Neon Integrations 的 Workers 卡片只是文档 `Read`，并没有当前 Worker 连接的关联元数据。

以下事实仅适用于已经查看的 `bitter-heart-61838251`，是待关联分支的事实，**不标为生产库已验证**：

- `main`（Default），ID `br-crimson-morning-b3rhjeoi`；PostgreSQL 17，AWS Singapore，Free plan。
- 主计算端点 ID `ep-summer-sun-b312js22`，0.25 CU；没有打开含连接串的 Connect 窗口。
- 数据库 `neondb`、owner `neondb_owner`；只读事务结果 `transaction_read_only=on`。
- 五个现有分支：main；qa-app-mirror-20261103（父 main）；qa-before-internal-products-20261104、qa-full-release-backup-20261104、qa-predeploy-backup-20261103（三者父 qa-app-mirror-20261103）。没有确认这些 QA 分支不含真实数据，不将其直接指定为新预发库，也不把 backup 命名当作恢复验证。
- Backup & Restore：6 小时历史窗口；页面提示 `No snapshots, no schedule set`。恢复能力的 UI 入口存在，但未点 Create/Restore/Preview data，也没有恢复演练证据。

### 实际只读结构核验

SQL Editor 在该分支运行 `BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; ...; ROLLBACK;`，两个事务均成功。查询限定系统目录、information_schema 和迁移历史，没有业务记录。共看到：

- 9 张指定表：accounts、admin_audit_log、app_users、cash_ledger、cn_fund_contracts、cn_write_receipts、orders、positions、schema_migrations。
- cash_cents、delta_cents、balance_after_cents、quantity、price_cents、amount_usd_cents 等字段为 bigint；资金合同 principal/profit 也为 bigint。
- 43 条关键约束，包括 accounts/cash_ledger 非负、orders `(account_id,idempotency_key)` 唯一、cn_write_receipts `(user_id,route,request_key)` 主键、positions 数量非负、资金合同借还款流水唯一及外键。
- orders 的 execution_type 约束是 `INTERNAL_ONLY`。本事实不改变客户披露门禁。
- 13 个相关索引，包括订单及资金合同幂等唯一索引、回执主键/created_at 索引和到期资金合同索引。
- schema_migrations 仅六条：001_init.sql、002_sessions.sql、003_private_account_data.sql、003_watchlist.sql、004_watchlist_security.sql、005_admin_roles_and_catalog.sql。新表实际存在但后续手工迁移未全部登记于该表，**不能据缺记录重放迁移，也不能据该表判断生产已经迁移完成**。

恢复窗口和 schema 结果只属于上面的具体项目/分支，不能外推到另外两个项目或真正生产连接。

## 工具错误与 Issue 更新状态

本轮未出现审批拒绝。初始浏览器列出用户原有标签但绑定报错：`Tab 1 is not part of browser session 6af6ae0f-2434-8191-ab1e-06b6d099109c`、`Tab not found in browser 2`；随后同一内置浏览器的原标签成功连接，Cloudflare/Neon 均已登录。这是会话绑定问题，不归类为未登录或账户权限拒绝。读取状态时一次出现 detached accessibility element，改用可见界面定位后继续完成。

[Issue #58](https://github.com/dalulu05168/Lu----00001/issues/58) 已读取最新评论。GitHub 页面明确显示 `Sign in to comment`，属于 **GitHub 站点未登录**；不影响 Cloudflare/Neon 登录结论。现有 GitHub 插件搜索结果为未安装；没有可调用的 Issue 写入工具。待发布评论已经准备在 `ISSUE-COMMENT.md`，尚未远程提交，不能宣称 Issue 已更新。

## 尚缺上线条件

1. 受控的非敏感连接身份，建立生产 Worker → Neon 项目/端点/分支/数据库/角色关联，然后在正确目标上核对结构和迁移。
2. 云端完整版本/Assets 配置及逐文件清单、zone routes 导出、可用回滚版本和资源证据。
3. Cron 执行证据与当前真实调度核对。
4. 独立云预发，合成测试数据库，以及真实备份与恢复演练证据。
5. Issue #58 已存在的客户披露门禁和最终生产写入批准。
6. GitHub 登录或既有授权连接，以实际发布本轮增量结果及代码提交。
