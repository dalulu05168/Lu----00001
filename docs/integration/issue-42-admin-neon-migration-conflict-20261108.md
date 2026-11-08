# Issue #42 管理后台／Neon 迁移与分支冲突核查（2026-11-08）

> 状态：**P0 BLOCKED — 只读审计**。本文仅记录 GitHub 实际代码与 Neon 只读 SQL 查询结果，**没有**执行生产/QA 迁移、修改账户、部署或合并。发布与迁移须经总控批准。

## 实际核对的版本

- 仓库：`dalulu05168/Lu----00001`
- `main`: `105fcf55f4f687d8de1fc68e062419f3cc15c50f`
- 后台候选：`dev/admin-backend-hardening-20261108` @ `b87537c54f0b1ab82f2f779aab045689e3ffcf2d`
- 共享 QA 源码：`dev/restore-four-role-platform-20261103` @ `0368652392781a2959d0bbab83eb619bb8026e11`
- 前台独立分支（仅用于冲突判定）：`dev/frontend-phase2-session-catalog-20261108` @ `3d6b1c88c641695f5bea8e9782632b284da3fd7c`
- 后台候选的隔离 CI：Actions `42430184645`：Node **103 total / 83 pass / 20 skip / 0 fail**，PostgreSQL **3/3 pass**。此运行使用隔离数据库，**并非目标 Neon 已迁移或上线**。
- 统一任务板：Issue #42，全链路审计评论 `6715119816`，协作协议 `6715133415`，后台 ACK `6715174198`。

## Neon 只读实证（2026-11-08）

项目 `bitter-heart-61838251` / `global-stock-platform-free`，通过 Neon 连接器在**明确指定的**以下分支执行只读 `SELECT`，返回数据库名均为 `neondb`，schema 均为 `public`：

| 检查项 | Neon main (`br-crimson-morning-b3rhjeoi`) | Neon qa-app-mirror-20261103 (`br-shy-poetry-b3kzsxug`) |
|---|---|---|
| 已记录迁移 | 001–005（6 个文件） | 001–022（22 个文件） |
| `admin_auth_attempts` | 不存在 | 不存在 |
| `admin_audit_events` | 不存在 | 不存在 |
| `admin_roles.last_login_totp_step` | 不存在 | 不存在 |
| `registration_policy.invite_required` | false | false |
| `orders` / `positions` 市场约束 | US, HK, CN, MY | US, HK, CN, MY |
| `watchlist_items` 市场约束 | US, HK, CN, MY | US, HK, CN, MY, RO |
| `listings` 市场约束 | US, HK, CN, MY | US, HK, CN, MY, RO |
| 市场记录按市场分组 | 四张表均无记录 | listings 有 8 条 US；另三表未返回记录 |

**注意：** 以上是直接连接 Neon 上述两条分支的只读结果；我们没有从 Vercel/Render 取得实际连接目标的已验证映射，因此**不能**推断生产部署使用其中任一数据库。记录数只是查询瞬间，不代表迁移锁定后的状态。

### P0：迁移编号与结构**不兼容**

后台候选源码迁移：
- `006_supported_markets_us_cn.sql`（市场 US/CN）
- `007_admin_auth_protection.sql`（后台数据库级限流、TOTP 时间步）
- `008_admin_audit.sql`（仅追加的审计表）
- `009_invitation_revocation_audit.sql`（邀请码撤销审计动作）

共享 QA 源码/Neon QA 已迁移：
- `006_admin_mirror_access.sql`、`007_admin_password_only.sql`
- `008_client_admin_policies.sql`、`009_operational_requests.sql`
- 另有 `010`–`022`，尤其 **`021_admin_totp.sql`** 创建 `admin_totp_challenges`，并采用两阶段验证。

**不能**在 QA 数据库直接执行后台候选的 006–009，也不能按数字排序重新跑两条迁移历史。需要由总控选择唯一基线、明确目标库、先备份并在隔离克隆分支验证新迁移；若以共享 QA 为基线，新的补丁必须分配 **023+** 且审查表/字段与已有约束、业务数据的兼容性。不得重命名已应用的迁移历史记录。

## P0：已确认的文件/API 冲突

| 路径/契约 | 后台候选分支 | 共享 QA 分支 | 合并规则 |
|---|---|---|---|
| `src/admin-service.mjs` | 单请求 `adminLogin({email,password,otp})`；持久限流/TOTP step/revokeInvitation | **双阶段** `adminLogin({email,password})` → pendingToken → `verifyAdminTotp({pendingToken,code})`；管理账户、真实 QA 子账号/商品逻辑 | 绝不可整文件覆盖，先决定沿用双阶段契约，按函数移植安全补丁 |
| `src/admin-http.mjs` | 小范围 2FA/客户/目录/审计/邀请码 `PATCH /api/admin/invitations` | 包含审批、资金、镜像、股票操作、商品、客服、客户策略、`/api/admin/audit-events` 等几十条路由 | 必须逐端点合并，保持现有 QA API 不回退 |
| `web/admin.html` / `web/admin.mjs` | 来自旧主分支，与新 `web/cn-admin.html` 页面并存 | 已有主管理员侧栏/十模块/审批/客户端镜像/2FA 等业务绑定，`web/admin.mjs` 约 107KB | 不能将旧页面替换当前 QA 管理端；独立审阅视觉改造，保留业务 DOM/脚本 |
| `web/cn-admin-bridge.mjs` | 请求 `GET /api/admin/audit`，调用简单管理员创建与目录接口 | QA 使用现有 `web/admin.mjs` + `GET /api/admin/audit-events`，没有相同 UI 契约 | 不直接接入 QA 的主页路由 |
| `src/http-api.mjs` | 旧 main 的静态资源/API 路由 | 现有 QA 的 admin/desktop/mobile 资源白名单及代理更多 | 由总控统一处理，不由后台窗口覆盖 |
| `db/006`–`009` | 新文件名与原 QA 相同序号、不同含义 | QA 已迁移至 022 | 必须重新规划迁移编号与结构 |

### 不存在的生产业务验收

- 后台候选隔离 CI 成功只证明相应代码在临时测试环境的行为；没有证明真实 `admin.nuvexapro.com` 已发布这些更改。
- 当前目标 Neon 的两个分支均无候选 `007/008/009` 所需结构，不能直接使用依赖这些表/列的后台安全逻辑。
- `invite_required=false` 经只读核实，是否启用邀请制是业务决定；不能误将它当成任意账号可登录的证据。
- QA 的内部余额、审批记录或内部订单不能等同真实银行出入金或券商成交。

## 建议的下一步验收顺序（待总控选择）

1. 总控确认**唯一集成基线**：共享 QA `dev/restore-four-role-platform-20261103` 的最新 SHA、部署目标和被授权的 Neon 分支，记录实际服务 SHA。
2. 后台窗口单独列出想移植的安全功能（TOTP 重放限制、数据库级失败次数、邀请撤销审计），先对照 QA 的现有双阶段 TOTP/权限/审计实现做去重；保留 QA 现有资金审批/客户策略/镜像/客服业务模块。
3. 在 QA **克隆或隔离数据库** 上设计并执行新编号的幂等/兼容迁移（如需，`023+`），跑 2FA、MASTER/SUBADMIN、客户归属、审计、资金审批等回归；保护已有资金/订单和客户关系。
4. 后台 PR 仅包含本人负责的最小差异与实际 CI/HTTP/DB/Chromium 证据，不直接修改前台和独立手机文件，也不擅自合并。
5. 若要启用生产环境，另行校验具体域名、目标数据库连接映射、完整迁移历史、运营批准和授权角色 E2E；不能以预览 READY 或 CI 成功替代业务验收。

## 本次执行核验与边界

- 已实际读取 Issue #42 和相关代码；已查询 Neon 两个明确分支的迁移列表、列/表/约束、邀请策略和四张市场表汇总。
- **数据库写入 0；迁移执行 0；生产部署 0；分支合并 0。**
- 本文为合并阻断与交接证据，不是功能实现或交易平台验收报告。
