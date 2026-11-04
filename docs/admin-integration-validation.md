# 前后台本地修复与验证记录

日期：2026-11-04。

## 代码范围与交付状态

唯一仓库：`dalulu05168/global-stock-platform`。源码基点：后台开发分支 `dev/graphite-admin-client-controls-20261103` 的 `0f38a65`。本地交付分支：`codex/admin-integration-20261104`。

客户详情、主/子管理员权限、APP 账户镜像、工单及审计已有实现，本轮在这些实现上补缺和验证，没有把原生 APP 或独立网站分支混入。未推送、合并、部署、绑定域名，也未访问或修改既有 QA/生产数据库。

## 修复及文件清单

| 文件 | 本轮变化 |
|---|---|
| `web/admin.mjs` | 拒绝旧会话迟到响应；退出/失效清理客户、子管理员、证券、镜像、审计及表单；保护迟到的登录验证；切换对象立即清空策略；镜像校验选中客户 ID；保留密码确认失败时的有效会话 |
| `src/readiness.mjs` | 就绪检查覆盖 26 张账户、权限、业务、客服及审计所需表，避免缺少后台表仍报告就绪 |
| `src/admin-http.mjs` | 修正被前一个相同条件遮蔽的镜像审计依赖 503 错误提示；不泄露内部数据库错误 |
| `test/admin-session-isolation.test.mjs` | 8 项真实页面 DOM 控制器回归：目录/审计迟到响应、退出、失效、对象切换、密码确认、迟到登录校验、错误客户镜像 |
| `test/admin-api-integration.test.mjs` | HTTP handler 层验证镜像依赖错误与受保护数据不返回；数据库边界使用测试替身 |
| `test/readiness.test.mjs` | 逐个模拟必要表缺失，验证拒绝报告就绪 |
| `test/postgres-integration.test.mjs` | 在真实 PostgreSQL 上增加非空自选股/账户与镜像一致性、统一审计角色范围、审计 INSERT 失败时拒绝快照的验证 |
| `test/http-api.test.mjs` | 适配扩展后的就绪检查数据库目录替身 |
| `test/render-blueprint.test.mjs` | 接受 Windows CRLF，不改 Render 配置 |
| `test/live-site-api.test.mjs` | 移除其他网站默认目标；普通 CI 不运行外站探测；显式目标/授权后才能启用，POST 另需显式开关，拒绝重定向 |
| `test/live-site-opt-in.test.mjs` | 子进程模拟 CI 并拦截全部网络，验证未授权时不访问外站 |
| `docs/API.md`, `docs/INTEGRATION.md`, `docs/HTTP_SETUP.md` | 纠正“未实现/内存原型”等过时描述，记录实际接口、角色、测试与运行方法及限制 |
| `docs/superpowers/specs/2026-11-04-admin-integration-design.md`, `docs/superpowers/plans/2026-11-04-admin-integration.md` | 保存用户确认范围、执行步骤及结果 |

## 实际验证结果

首次全量基线：125 项，104 通过、1 失败、20 跳过。唯一失败是 Render 测试对 CRLF 的误报；当时数据库集成未运行。新增会话/策略/镜像回归均先观察到对应失败，再进行修复。

最终全量：**136 项，119 通过、0 失败、17 跳过**。其中 3 项真实 PostgreSQL 集成测试全部运行通过；其余 17 项为外站检查，按任务边界未执行。独立只读代码审查另运行 11 项定向测试，全部通过，未发现阻止本地交付的缺陷。

- 使用工作区独立安装的便携 PostgreSQL 16.15 二进制（`@embedded-postgres/windows-x64@16.15.0-beta.19`），不是系统数据库服务。工具来源：[embedded-postgres](https://github.com/leinelissen/embedded-postgres)。
- 全新数据目录、仅监听 `127.0.0.1:55434`；每次完整集成运行创建新的空测试数据库。仅合成账号、记录与故障注入，没有复制现有业务数据。
- 仓库迁移在最终空库连续运行两次成功，随后执行全量 Node 测试。真实 SQL 验证包括注册登录/撤销会话、客户隔离、订单与回滚、客户和子管理员登录停用、策略并发版本、业务审核、镜像及审计。
- 故障注入仅在合成测试库临时创建拒绝审计写入的触发器，验证 500 且无快照返回后撤销。
- `npm run build` 退出码 0；构建前 `public/` 不存在，本轮生成该目录，没有覆盖已有产物。未调用发布命令。
- 修改的产品 JavaScript 和数据库集成测试通过 `node --check`；`git diff --check` 无空白错误（Git 的 LF/CRLF 转换提示不影响结果）。
- 本地 PostgreSQL 测试进程已正常停止；测试目录及合成数据保留，没有删除文件。

详细本机运行日志保留在工作区 `.local-postgres/final-validation.log`，可重复测试的本机辅助入口为 `.local-postgres/run-tests.mjs`（需先启动该独立 PostgreSQL）。辅助工具未加入应用依赖，也不属于发布内容。跨环境复测按 `INTEGRATION.md` 使用另一个全新空数据库。

## 如何运行和复测

1. 在仓库目录执行 `npm install --ignore-scripts`。
2. 不配置数据库运行 `npm test`，验证单元、HTTP 和 DOM；数据库测试会明确跳过。
3. 准备全新、隔离的本地 PostgreSQL 空库，将 `DATABASE_URL`、`DATABASE_URL_UNPOOLED` 和 `TEST_DATABASE_URL` 都明确设为同一测试库。运行 `npm run migrate`，再运行 `npm test`。已有 singleton master 的测试库不能直接作为下一次完整运行的空库。
4. 使用专门的本地开发空库运行 `npm run dev:api`。客户入口 `/`，后台入口 `/admin.html`，默认本机端口 3001。主账号按本地配置的身份与 bootstrap secret 初始化，不提供通用默认密码。
5. `npm run build` 生成静态前端产物；该命令会替换已有 `public/`，在其他 checkout 中先检查目录。

## 尚未验收及限制

- 未做真实浏览器视觉、触屏或持续操作验收。jsdom 测试属于自动化 DOM 验证，不等于实机截图或用户验收。
- 未合并/构建/验收原生 iOS、Android APP。本轮 APP 镜像是数据库账户视图，不是远程屏幕或手机控制。
- 未检查或修改任何线上部署；不能据此宣称线上已更新、生产可用或真实资金服务已完成。
- 就绪检查验证表存在，不证明列版本、数据库运行账号权限、性能或全部生产安全属性。
- 客户目录最多 500 条、统一审计最多 200 条/次、镜像订单最近 100 条；全量导出与这些列表的新增分页不在本轮范围。
- 审计与账户快照读取通过各自查询完成；`checkedAt` 是读取完成时间，不是券商实时成交时间或跨表强一致性保证。
- 贷款资格只保存策略，尚无贷款申请工作流；身份核验、银行核验、真实支付、实盘交易及授权实时行情均未因此接入。
