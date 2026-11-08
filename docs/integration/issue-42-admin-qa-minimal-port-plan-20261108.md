# Issue #42｜管理后台 QA 兼容性清单与最小移植计划（2026-11-08）

> **P0：仅用于审查，不代表总控已批准迁移或合并。** 本轮只读检查 GitHub/Neon，新增本文档；未修改已有 API、后台 UI、数据库、生产部署。源仓库以 `dalulu05168/Lu----00001` 为准。Issue #42 的 2026-11-08 总控回复 `6715278186` 明确要求在 QA 基线/目标 DB 未批准前保持只读兼容性审查，不得整支覆盖。

## 1. 有效基线与执行证据

| 项目 | 只读实时检查结果 |
|---|---|
| 后台开发分支（旧式单步 2FA，只供差异参考） | `dev/admin-backend-hardening-20261108` @ `52206e89a31166fff84023ea87e84fc8f86d503a`（本文件提交前） |
| 共享 QA 候选代码（**未经总控正式确定为唯一集成基线**） | `dev/restore-four-role-platform-20261103` @ `0368652392781a2959d0bbab83eb619bb8026e11` |
| QA 核心文件 GitHub blob | `src/admin-service.mjs`: `9c9de06e0799...`; `src/admin-http.mjs`: `8237ac21c9d4...`; `web/admin.mjs`: `ccbed4036428...`; `src/auth-rate-limit.mjs`: `13d06b476564...`; `src/operation-audit.mjs`: `98c6d14707ce...` |
| Neon 项目 | `bitter-heart-61838251`，database `neondb`，schema `public` |
| Neon main（`br-crimson-morning-b3rhjeoi`） | `schema_migrations` **6 条**，最高文件 `005_admin_roles_and_catalog.sql`，无 `admin_totp_challenges` / `admin_auth_attempts` / `admin_audit_events` / `last_login_totp_step` |
| Neon QA（`br-shy-poetry-b3kzsxug`） | `schema_migrations` **23 条**，最高 `022_mobile_session_handoffs.sql`；有 `admin_totp_challenges`，但无 `admin_auth_attempts` / `admin_audit_events` / `last_login_totp_step` |
| 邀请政策 | 两条 Neon 分支的 `registration_policy.invite_required=false`；**不能**当成自动授权开放注册的产品决策 |
| 线上绑定 | 未读取实际部署的数据库密钥，**生产域名使用哪条 Neon 分支未知** |

上面的 Neon 字段/表与迁移统计，是本轮在**显式指定 Neon 分支**执行无副作用 `SELECT` / `to_regclass` / `information_schema` 得到的，并非 Vercel/Render 实际连接证明。

本轮 GitHub 源码共检查 **9 个 QA 文件**、**19 个静态条件**；其中旧前端端点文字检查第一次误将 `/api` 前缀写死而不匹配，读回 `web/admin.mjs` 后确认实际代码使用 `fetch("/api"+path)` 与 `api("/admin/workflow-requests", ...)`，额外 **4 个静态检查全部成立**。合计 **23 项条件已由源码读取确认**，非运行时 HTTP、浏览器或真实资金测试。

## 2. QA 已有功能：必须保留而不是重新开发

| 范围 | QA 当前事实（源码依据） | 防回退要求 |
|---|---|---|
| 管理员 2FA | `POST /api/admin/login` 只校验密码并产生 10 分钟 `pendingToken`；`POST /api/admin/totp/verify` 才创建 `adminVerified` 会话 | 不能替换成旧分支单请求 `{email,password,otp}`，不能让 pendingToken 访问管理员接口 |
| 单个挑战限额 | `admin_totp_challenges` 用 `FOR UPDATE OF c`、最多 5 次、成功删除挑战；验证时间窗口允许 ±1 个 30 秒 step | 保留现有一次性挑战与速率限制；单挑战防重放 **不等于** 跨两个 pendingToken 的同一 TOTP 防重放 |
| 登录失败限制 | `src/auth-rate-limit.mjs` 每账户 15 分钟最多 8 次失败，IP 15 分钟最多 50；但仅为进程内 Map | 无共享存储就不能宣称多实例/Serverless 全局防爆破；不删除现有边缘限速保护 |
| 账号停用 | `PATCH /api/admin/subaccount-controls`，MASTER 确认密码、版本比对，审计后撤销该子管理员未撤销会话 | **已实现**，不要再新增冲突停用路由；保留现有版本冲突/角色边界 |
| 邀请码 | `invite_codes.revoked_at` 已有；注册查询过滤 `revoked_at IS NULL`，`FOR UPDATE OF i` 防抢占 | 无需再新增 revoked_at 字段；尚未见 QA 主管理员撤销邀请的独立业务 API |
| 客户归属 | MASTER 可查询普通客户，SUBADMIN 按 `client_links.subadmin_user_id` 过滤 | 不将客户转移、子管理员停用和旧客户删除混为一谈 |
| 现有审计 | `GET /api/admin/audit-events` 来自 `src/operation-audit.mjs` 的多表 UNION、SUBADMIN 范围隔离；还有单独策略/工作流/镜像/客服审计 | 不以旧分支 `GET /api/admin/audit` 或另一套表替换；新事件应接入既有审计聚合 |
| 已有后台业务 | `/api/admin/workflow-requests`、`client-controls`、`mirror`、`support`、`commodities`、`product-terms`、`stock-position-lock` 等 | 不整体覆盖 `src/admin-http.mjs`；保留 `web/admin.html`、`web/admin.mjs` 已有十模块和防迟到响应检查 |

## 3. 最小移植拆分（均未实施；需要总控批准后另开 QA 基线隔离分支）

### A. 2FA 跨挑战 TOTP 重放保护（优先）

- **候选文件**：`src/admin-service.mjs` 仅 `verifyAdminTotp` 内的验证及事务；`src/totp.mjs` 可新增返回匹配 `time-step` 的纯函数，**原 `verifyTotpCode` 不改变 API**；新迁移编号需从最终 QA 基线当前最高编号之后分配。
- **候选列**：`admin_roles.last_used_totp_step bigint`（NULL 默认），绝不复用旧分支已编号的 `007_admin_auth_protection.sql`。
- **并发保障**：验证同一个 OTP 对应的时间步后，在已加锁的事务中以单条 `UPDATE admin_roles SET last_used_totp_step=$step WHERE user_id=$userId AND (last_used_totp_step IS NULL OR last_used_totp_step<$step) RETURNING user_id` 做原子比较写入。若未更新一行则拒绝发会话。保留挑战行删除/次数上限，整段必须跟 `createSession` 一起提交或回滚。慎防旧 step 在窗口内晚于新 step 被重复使用。
- **边界**：使用 pendingToken 的两阶段契约、加密的 TOTP secret 及 `ADMIN_TOTP_KEY` 不变；无需在客户端/日志显示验证码或秘钥。
- **必须通过**：两套并行 pendingToken 使用**同一** 30 秒 OTP，最多 1 次成功、最多 1 个 adminVerified session；过期/错误/5 次失败被拒；新 step 在时间窗轮转后正常登录；MASTER/SUBADMIN 权限保持。

### B. 登录失败计数跨实例一致性（优先）

- QA 现有 `createAuthRateLimiter` 为进程内 Map。候选新增隔离表 `admin_auth_attempts`（或现有共享存储，不预设名称），以参数化 SQL、账户标识摘要、15 分钟窗口、原子计数防并发绕过；必须明确锁定、窗口重置、缓存清理/索引策略。保留 IP 边缘限制，不能信任未受代理覆盖的 `X-Forwarded-For`。
- **重要契约差异**：`/api/admin/login` 的密码通过即会调用 `authLimiter.reset("accountFailures")`，TOTP 失败不以相同的 emailKey 计数；移植时需分别设计密码失败和 OTP 失败的持续性限速，避免仅给第一步加锁却让攻击者申请无限挑战。
- **必须通过**：多并发/多进程等价测试 8 次失败触发拒绝；窗口过期后恢复；有效管理员未被其他账号的失败锁定；无账号信息泄漏；限流状态不可从客户端读取。

### C. 邀请码撤销（其次，避免重复建表）

- QA 的 `invite_codes.revoked_at`、`client_links`、注册端 `FOR UPDATE OF i` 皆已存在；不迁移旧分支的 009，只需添加经审计的撤销业务事务与最小新审计持久化结构（如现有审计体系无匹配表）。
- 候选授权 API：`PATCH /api/admin/invitations`，仅 MASTER，校验拥有该 SUBADMIN，确认操作者身份（参照现有策略的密码再次确认和 `expectedVersion` 约定）、记录撤销审计，与改 `revoked_at` 放同一事务。可先方案审查，不提前扩展共享路由。
- 响应只返回 ID/状态，不能返回邀请码或其他子管理员客户数据。二次撤销拒绝或幂等响应须定契约；并发注册和撤销必须以同一邀请码行锁串行化。
- **必须通过**：未登录/普通客户/SUBADMIN 403/401；MASTER 自己管理范围内成功；两次操作不会生成两条成功审计；已链接客户可继续登录、归属不变；撤销后新注册使用该邀请码被拒；审计不含密码与邀请码明文。

### D. 统一审计（跟随 A–C）

- 使用 QA 现有 `src/operation-audit.mjs` 和 `GET /api/admin/audit-events` 作为唯一公开查询；新增事件须保持 `eventType,eventId,clientId,actorId,action,description,recordedAt` 结构及 MASTER/SUBADMIN 查询范围，不复制旧版 `/api/admin/audit`。
- 只在确实缺表的情况下新增独立、服务端权限受限的事件表；需避免数据库触发器失败导致正常的管理员登录与交易/审批请求被无条件阻断，先验证事务、权限与回滚原则。
- **必须通过**：审计写入失败时关键管理操作整体回滚；不可删除/修改已记录审计；子管理员不能越权看 MASTER 的事件；不记录密码、OTP、pendingToken、setup URI、会话 token。

## 4. 迁移与部署门禁：停止条件

1. 总控以 Issue #42 明确**唯一源码基线 SHA、对应 Render/Vercel 服务 SHA、确切目标数据库分支**；旧 Issue 正文中的旧仓库信息已被 2026-11-08 通报纠正。
2. **先只读**快照 `schema_migrations` 完整 filename 和哈希/应用时间（若存储该信息）、`information_schema`、`pg_constraint`、涉及表行数及 DB 角色权限；当前 QA 已有 001–022，不能依数字覆盖或改动既有迁移历史。最终新迁移编号从真实最大值之后分配（**暂估 023+，非已预留**）。
3. 总控确认有隔离 Neon 克隆或全新 QA 数据库、可验证的备份与恢复演练。没有可恢复路径/数据保留策略，禁止执行迁移。涉及资金/客户/会话的生产数据不能复制至静态预览。
4. 在隔离 DB 跑 `npm run migrate` → `npm test` → `npm run build`，新建双阶段登录与多挑战重放、跨实例限流、邀请撤销及审计专用 Postgres/HTTP/Chromium 用例；每条检查记录执行环境、目标库、命令、通过数、日志/截图。**不得**仅以静态检查替代运行测试。
5. 由总控核对 PR 差异只包含后台负责文件及已获授权的最小共享路由变更。现有工作流/资金/十模块任一回归失败则停止；无批准不合并、不运行迁移、不发布。
6. 实际生产端点及数据库连接映射另行授权核对并执行 E2E，只有完成此项才可考虑后台生产业务验收；真实券商订单、银行资金流、KYC 仍是独立阻断。

### 只读验证 SQL 参考（不得自动对目标生产库执行写入）
```sql
SELECT filename FROM schema_migrations ORDER BY filename;
SELECT table_name,column_name,data_type
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name IN
 ('admin_roles','admin_totp_challenges','admin_auth_attempts','invite_codes')
 ORDER BY table_name,column_name;
SELECT conrelid::regclass::text AS table_name,conname,pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE connamespace='public'::regnamespace
 AND conrelid IN ('admin_roles'::regclass,'invite_codes'::regclass);
```

## 5. 本轮状态与验收口径

- **源码审计**：QA 9 文件静态核对：19 条检查中，18 条直接匹配；剩余 1 条经读回前端 API 前缀拼接后确认是检查条件错误，并完成 4/4 精确补查。没有尝试变更 QA 公共接口。
- **数据库**：只读 SQL，main 6 条迁移至 005；QA 23 条迁移至 022；**数据库写入/迁移 0**。
- **代码改动**：仅新增本文档（GitHub commit/读取验证将在回报中提供），**未新增 API、迁移、权限或前端功能**；生产部署/合并 0。
- **尚未验证**：真实服务 SHA/数据库映射、后台授权登录与申请审批 E2E、供应商行情/券商及真实资金业务。历史隔离 CI 不能补足这些证明。
