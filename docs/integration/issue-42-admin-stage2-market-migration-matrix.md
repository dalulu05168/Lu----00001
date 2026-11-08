# Issue #42 阶段二｜管理后台 US/CN 市场与 023/024 迁移兼容矩阵

状态：**只读源码和 Neon 结构核对完成；市场新写入契约、共享数据库迁移和真实报价成交未通过。**
仓库参考代码 `dev/restore-four-role-platform-20261103` @ `0368652392781a2959d0bbab83eb619bb8026e11`；仅作参考，不是授权 QA/生产部署 SHA。
本文件不修改客户前台、新 UI、共享 `src/http-api.mjs`、报价/交易服务，也不部署迁移。

## 已从 Neon QA 只读 SQL 实核的旧约束

项目 `bitter-heart-61838251`，`qa-app-mirror-20261103` = `br-shy-poetry-b3kzsxug`，`main` = `br-crimson-morning-b3rhjeoi`。

| 表 | QA 当前 CHECK 允许 | 业务目标新写入 | 历史读回要求 | 当前缺口 |
| --- | --- | --- | --- | --- |
| `listings` | US/HK/CN/MY/RO | US/CN | RO 及已存在的旧市场不删除 | `admin-service.mjs` 的新增/更新 `MARKETS=US/RO`，会拒绝 CN、允许新 RO |
| `watchlist_items` | US/HK/CN/MY/RO | US/CN | 历史 RO 可查询、删除 | `watchlist-service.mjs` `MARKETS=US/RO`，不能 CN 增删；历史记录删除须保留兼容性 |
| `orders` | US/HK/CN/MY | US/CN | 保留所有已成交旧订单 | QA 约束允许旧市场，需共享订单服务只允许 US/CN、禁止客户端传执行价 |
| `positions` | US/HK/CN/MY | US/CN | 保留历史持仓数据 | 与订单/持仓原子事务同时约束 |
| `internal_stock_sales` | 仅 US | US/CN（若继续使用本接口） | US 历史记录可查 | 旧产品卖出表与新统一订单模型有别；不能自动把 US 内部产品卖出记录转换成 CN 订单 |

旧 `src/account-analytics.mjs` 的 FIFO `MARKETS=US/RO`（另有 PRODUCT）也是新 CN 成交后的服务端盈亏核算阻断；**不能只修改下拉菜单或 DB CHECK 就宣称 CN 盈亏已通**。需要由交易后端/公共集成负责人把新订单记录/报价证据/FIFO 与只读分析契约对齐。

## 迁移现场（2026-11-08，只读）

- Neon QA `schema_migrations` **23 行**，最后文件 `022_mobile_session_handoffs.sql`；有两个 `003_*.sql`。
- Neon main `schema_migrations` **6 行**，最后文件 `005_admin_roles_and_catalog.sql`；有两个 `003_*.sql`。
- QA 已有 `admin_totp_challenges`、`admin_mirror_access_log`；main 缺少这两项，**禁止**把 QA 023 直接应用到 main。
- 本窗口 `migration-candidates/023_admin_totp_replay.sql` **仅候选**：为 QA 现有 `admin_roles` 添加 `last_login_totp_step bigint`，须经明确目标分支、备份/回滚、排他迁移顺序及单独部署核准。对应服务端 `ADMIN_TOTP_REPLAY_GUARD_ENABLED=true` 只在此列存在后才启用；该环境变量当前不应在共享/生产打开。
- 交易窗口 `migration-candidates/024_internal_order_quote_evidence.sql` **独立候选**：创建订单报价凭证表，依赖现有 `accounts` 和 `orders`；与 023 无直接表级依赖，但编号和环境必须按唯一 QA 迁移顺序审查，若目标分支 023/024 已占用则重编号；严禁直接在 `db/` 自动迁移目录合并。
- 需要跨模块统一 US/CN 新写入约束；安全方案要同时具备**应用服务白名单**和**数据库写入门禁**（若历史 RO 仍留表内，不能简单通过丢弃旧行实现 CHECK）。新入库禁 RO/HK/MY，但历史 RO 可继续读与按身份删除；迁移先统计旧市场及外键引用再审核。

## 后台仍需保留且须回归的原业务

原十管理模块、MASTER/SUBADMIN 两步 `/api/admin/login` → `/api/admin/totp/verify`、邀请码、客户归属、资金审批/账本、KYC/银行/私人资料、客服、镜像与统一审计、目录/商品条款。新的 `GET /api/admin/client-analytics` 只读且按客户归属授权，账本 FIFO 历史缺失时不得伪造已实现盈亏；实时未实现盈亏需要市场数据和交易窗口的许可报价与估值契约。
 
**未解决前置**：合规 US/CN 报价/FX 来源与内部定价许可、公共交易 HTTP 挂接、统一 QA 源 SHA 和数据库连接映射、023/024 迁移审批、真实授权会话/浏览器 E2E、三端最新版清理包最后交接。保持 `TRADING_ENABLED=false`。共享/生产 DB 写入 0。
