# Nuvexa 统一开发主线

本目录：C:/Users/pipi0/Desktop/Nuvexa-Codex主开发

开发分支：dev/nuvexa-unified。基础提交：7362714a37f10dc2807b6d33674bccecd0231044。
推荐代码基线：原开发副本中的发布工作区-mirror-mobile-sell-20261111。
本次只建立主线和验证，不改业务实现，不发布。

## 架构与修改入口

| 功能 | 实际入口 |
|---|---|
| 电脑客户前台 | cloudflare-release/web/desktop.html；构建注入 products-ui.js、news-ui.js、session-transport.js |
| 手机客户前台 | mobile-client/app.mjs、api.mjs、business.mjs、experience.mjs、ipo.mjs、mutual-funds.mjs 及 CSS |
| 管理后台 | cloudflare-release/web/admin.html、login.html、products-ui.js、security-ui.js、session-transport.js；镜像复用 mobile-client |
| 用户认证与权限 | cloudflare-release/src/worker.template.mjs.in、browser-sessions.js、security.js；当前 MASTER/SUBADMIN 及客户归属检查 |
| 订单、交易、资金流水 | Workers 模板内交易/账务/资金申请逻辑；src/products/service.js；cn_write_receipts 去重 |
| 行情与产品报价 | Workers 模板中的执行/参考行情入口，src/products/quote.js |
| Neon 连接 | Workers 模板内嵌 serverless 驱动；createRequestScopedDb 区分单次查询与事务连接 |
| 数据库结构 | cloudflare-release/db；外层 db 仅为旧 Node 路径基础迁移 |
| Workers API | cloudflare-release/src/worker.template.mjs.in；build.cjs 注入产品、安全、会话、新闻及页面 |
| 部署配置 | cloudflare-release/wrangler.jsonc、release-manifest.json、scripts/publish-*.cjs；本轮禁止执行发布 |
| 验证 | mobile-client/*.test.mjs、cloudflare-release/qa、ops/core.test.cjs；CI 当前主要验证外层 Node |

### Node 与 Workers 边界

后续面向现有 Cloudflare 平台的开发以 cloudflare-release 和 mobile-client 为主。
外层 src/*.mjs、web、scripts/build-static.mjs、railway.toml 是旧 Node API、兼容静态入口及测试路径，不是 Worker 的自动上游。
外层 npm run build 只复制 web 到 public；Workers 构建才生成 dist/worker.mjs 和 dist/assets。
不要把只修改外层 Node 源码、只通过根目录 CI，描述为 Worker 行为已修改或已验证。
worker.template.mjs.in 已内嵌驱动和部分服务实现，目前缺少完整上游重打包工具链；不要无依据重写模板。

## 原有功能保留

新版 Cookie 会话、CSRF、防跨客户访问、后台密码与 2FA 再验证、持久化限流、新闻、交易、产品和资金处理均按基线保留，业务文件未修改。
未复制真实环境文件或本机授权配置。没有修改原仓库工作树内容、修剪旧 worktree、重置分支或执行部署。
本目录是 linked worktree，Git 公共数据库仍在原副本的源码仓库/.git；请保留该原目录。

## 旧动态 RBAC 迁移清单（尚未合入）

来源：原副本 当前源码/前后台。

1. src/rbac.mjs：角色 CRUD、权限目录、角色权限绑定、自身权限及路由处理。
2. db/migration-rbac.sql：cn_roles、cn_permissions、cn_role_permissions、cn_user_roles 四表；外键、唯一约束、索引；角色/菜单/API 权限种子；MASTER 角色映射。
3. web/roles-ui.js：角色管理界面。审查其依赖的 admin.html 菜单/挂载点；design-tokens.css 属旧版界面资源，不能仅因同目录而整体覆盖新 UI。
4. scripts/build.cjs 的 roles-ui 注入和 __CN_RBAC__ 替换；worker.template.mjs.in 的 RBAC 路由分发、模块插入点。移植时须保留新版 Cookie、CSRF、限流、二次验证、新闻及客户归属隔离。
5. 独立验证事务回滚、权限启停、越权、用户/角色绑定、系统角色约束、菜单与 API 权限一致性。

已确认的阻塞：cnRbacSetRolePermissions 使用 db.query('BEGIN') 后继续 db.query。Worker 的单次 query 每次创建不同 Pool，因此这些语句不能形成同一数据库会话的事务。
未来移植必须用 db.connect() 获得同一连接，在其上执行 BEGIN、全部变更、COMMIT/ROLLBACK，并在 finally 释放。应验证中途插入失败不会留下已清空的权限。
另需复核：权限目录/自身权限路由仅凭有效用户会话即进入处理，管理员资格、禁用状态及新后台再验证守卫必须统一。
本轮没有复制旧 RBAC，也没有执行它的数据库变更。

## 依赖与安全验证方法

Node v24.22.1，npm 11.20.0。Workers 要求 Node >=22。
只在 cloudflare-release 通过 npm ci --ignore-scripts --no-audit --no-fund 恢复锁文件版本。
本机 npm 不在 PATH，实际使用 node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" 调用。
四个直接依赖版本：PGlite 0.5.16、PGlite Socket 0.2.19、pg 8.23.1、Playwright 1.65.0。
外层 Node 没有锁文件，本轮未安装外层依赖，也未把内层 pg 当作外层依赖安装成功。

执行的原构建：在 cloudflare-release 运行 node scripts/build.cjs，不带 --record。
构建 SHA-256：0b8e258ffc21c8d20e5a92136fe6e84cdb5eaa640a013db074e798ff9efb4159。
与基线 manifest 和发布工作区产物一致；package-lock.json、release-manifest.json 均未改变。

基础验证结果：
- 95 个源 JavaScript 文件语法检查通过；生成 Worker 的 node --check 通过。
- 手机适配/体验、新闻服务、备份核心纯单元测试共 30 项，30 通过、0 失败。
- 原隔离验收 contracts、order-concurrency、write-receipts 三组退出码均为 0。
- contracts 验证 36 类受保护端点拒绝匿名访问。
- 并发交易验证 12 次重复买入只写一次，竞争买卖保持余额/持仓/订单一致。
- 写入回执验证资金申请和客服六路并发、重放、冲突、归属隔离及被拒提款无提交回执。

隔离验证使用临时 PGlite 和 127.0.0.1，测试子进程只继承运行所需的系统环境；额外预加载 offline-guard.cjs 阻断非回环 fetch、socket 和 DNS。没有使用生产数据库 URL。
证据：cloudflare-release/artifacts/development-baseline/report.json、isolated-api.log；原验收结果 cloudflare-release/artifacts/acceptance-WNUiot/results.json。
artifacts、node_modules、dist 是忽略项；本文件是新增、尚未提交的开发说明。

## 文件保留核对

新目录生成 dist 后，273 个非敏感文件与推荐发布工作区逐字节一致，差异 0、缺失 0。
117 个敏感或可能含账户信息的配置/记录文件未读取正文比较（记录及 runtime-bindings 等），不宣称它们已完成内容审计。Git 跟踪文件由指定提交完整检出。
发布工作区多出的六个 dist 文件均由原构建重新生成，没有直接覆盖复制。
没有发现额外的未跟踪有效业务源码需要补入；原源码仓库独有的未跟踪 migrate-mobile-domain.cjs 保留原处，不带入主线。
原仓库 status 内容摘要前后相同；旧 worktree 引用保留，仅新增本开发 worktree 和分支。

## 剩余限制

- 未运行全部 25 组浏览器验收：部分脚本会访问真实新闻、外部资源或线上地址，未经逐组隔离审查不执行。
- 未运行 Cloudflare workerd 真实运行时验证、真实 PostgreSQL 全量回归或真机验证；PGlite 结果不能替代它们。
- CSP 仍有 unsafe-inline；生产报价授权、质量和参考报价时效规则仍需单独验收。
- 数据库迁移两条路径未统一；外层 migrate 只处理编号迁移，不能用它替代 Workers 增量结构管理。
- 环境变量模板不完整；发布/运维脚本有原电脑路径、历史默认值和外部工具依赖。
- 原根项目锁文件缺失；CI 未覆盖当前 Workers 完整验收。
- 本次具备继续本地统一开发的基础，不构成生产发布或整个平台交付验收。
