# 前端 PR：统一登录页集成（候选，未发布）

分支 `frontend/claude-login-integration-20261112`，基于：
- `frontend/claude-login-candidate-20261112`（a10f490，交接稿）；
- `claude/reproducible-860bea19`（a7b1578，可从源码逐字节重建生产 860bea19）。

**禁止自动合并。未部署，未改动 Neon，未改后端 Worker 代码。**

候选包 SHA256：`b564d636a5ad64584e2b41786f560b21a9bd58a1bc7a7e40dec1da01e917b9de`

## 修改文件

| 文件 | 改动 |
|---|---|
| `web/login.html` | 由交接候选稿生成，生成脚本是 `frontend-handoff/integrate-login.cjs`。每处修改都必须唯一匹配，否则脚本直接失败。 |
| `scripts/build.cjs` | 采用与 Codex 后端分支完全相同的 `--development` 开关：输出到 `dist-dev/`，不校验也不写入 `release-manifest.json`，与 `--record` 同时使用会报错。默认构建仍只认生产 860bea19。 |
| `.gitignore` | 加入 `dist-dev/`，与 Codex 分支一致。 |
| `qa/login-page.cjs` | 新增登录页验收，共 16 项，覆盖电脑和 iPhone 13。 |
| `scripts/acceptance-release.cjs` | 新增 `login-page` 套件。 |
| `frontend-handoff/screenshots/` | `redesigned-*` 共 5 张，是已改版页面；`mobile-app-login-NOT-redesigned.png` 是手机 App 内的登录表单，本次未改。 |
| `frontend-handoff/PR-login-integration.md` | 本文。 |

开发构建与生产包对比：后端代码、电脑页、手机页、后台页、新运营工作台**全部与 860bea19 逐字节一致**，只有登录页不同。

已验证：开发构建前后，`dist/worker.mjs` 均为 `d055098d…`，`release-manifest.json` 未变；本分支执行普通构建会被拒绝（源码与生产不符）。

## 已改版与未改版

| 入口 | 页面 | 状态 |
|---|---|---|
| 电脑 `nuvexapro.com/login` | `web/login.html` | 已改版 |
| 管理员 `admin.maacropierce.com/` | `web/login.html`（管理员模式） | 已改版 |
| 手机浏览器直接打开 `/login` | `web/login.html` | 已改版 |
| 手机 `nuvexapro.com/`（App 内登录） | `mobile-client` 的 `#auth-form` | **未改版** |

## 相对候选稿的修正

- 保留现有测试和功能依赖的元素编号：`#email`、`#password`、`#loginBtn`、`#otp`、`#regEmail`、`#regPassword`、`#regBtn`、`#inviteCode`、`[data-tab=register]`。
- 找回密码恢复为生产流程：申请 → 管理员发放 6 位重置码 → `/api/auth/password-reset/confirm`。
- **`?next=` 开放跳转**：先用浏览器自身的地址解析规则解析目标地址，只接受同源结果。
  - 现行生产页面会被 `/\evil.example`、`/%09/evil.example` 跳到外部站点。
  - 我的第一版只按字符判断，同样会被 `/%09/`、`/%0A/`、`/%0D/` 绕过；这一版已修正。
- 恢复以下生产行为：已有会话直接进入工作区；记录手机和管理员入口标记；清理地址栏；注册后自动登录；显示服务器返回的错误信息；保留 Cloudflare 统计脚本。
- 注册规则读取失败时，与生产一致：允许继续注册，邀请码作为可选项。
- 删除装饰 K 线上的价格数字。
- 管理员文案（含中英切换）。
- 输入框字号改为 16px（候选稿 CSS 写法无效，且会触发 iOS 聚焦缩放）。
- 注册时邮箱格式错误的提示文案。

会话机制未改：`session-transport.js` 由构建注入，登录走 HttpOnly Cookie，`localStorage` 只保存 `cn-cookie-session` 标记。

## 验收记录（2026-11-12，本机隔离 PGlite，未接触生产库）

命令：

~~~powershell
node scripts/build.cjs --development
node scripts/acceptance-release.cjs --bundle <bundle>
~~~

### 30 套完整验收

| 运行 | 包 | 通过 | 失败 | 跳过 | 证据目录 |
|---|---|---|---|---|---|
| 候选 | b564d636 | 25 | 5 | 0 | `artifacts/release-acceptance-P2G90W` |
| 生产基线（同一套测试文件） | 860bea19 | 25 | 5 | 0 | `artifacts/release-acceptance-OfftEL` |

失败分类：

| 套件 | 候选 | 基线 | 结论 |
|---|---|---|---|
| news、layout-controls | 失败 | 失败 | 生产已有问题：电脑页缺 `design-system.css`，字体约定检查失败。 |
| admin-next | 失败 | 失败 | 生产已有问题：后台手机镜像沙盒中的 TradingView 读取 cookie 报错；断网运行时通过。 |
| trade-database | 失败 | 失败 | 不适用：测试的是未发布的 `cnOrderIntent` 代码。 |
| login-page | 通过 | 失败 | 预期结果：生产页缺少新功能和跳转防护。 |
| products | 失败 1 次 | 通过 | 测试框架的间歇性竞态，见下。 |

`products` 的详细情况：
- 报错为 `/api/news` 的 `route.fetch` 在页面关闭后才返回（TargetClosedError）。
- 导航追踪显示该套件只访问 `/`、`/admin`、手机 `/`，从不加载登录页；而候选包与生产包的唯一差异就是登录页。
- 候选包累计 5 次中 3 次通过，生产包 4 次全部通过。
- 结论：不是本次改动引入的回归，但该竞态尚未修复。

### 登录专项 `qa/login-page.cjs`：16/16 通过

- 电脑和 iPhone 13 各一遍：
  - 开场动画后表单可用，无横向溢出，无页面报错；
  - 输入格式错误时不发请求；
  - 401 提示并清空密码；429、服务器返回的错误、断网均有提示，且可恢复；
  - 登录使用 HttpOnly `__Host-cn-client` Cookie，`localStorage` 只存标记，手机写入 `cncap.mobile.entry`；
  - 已有会话直接跳转（电脑）；
  - 重置码找回密码完整流程，新密码可登录、旧密码失效。
- **开放跳转专项**：电脑和手机各测 10 个目标：
  - 制表符、回车、换行注入；
  - 反斜杠；
  - `//` 开头的协议相对地址、绝对地址、`javascript:`；
  - 编码后的斜杠；
  - 合法同源地址。

  全部停留在本站，且没有任何请求发往外部域名。反向验证：在上一版（f237547）运行时失败，报错为 `next="/\t/evil.example" left the site`。
- 管理员：
  - 必须填写 2FA 动态码，错误动态码被拒绝；
  - 失败后密码清空；
  - 客户入口控件隐藏，中英切换后仍是管理员文案；
  - 签发 HttpOnly `__Host-cn-admin` Cookie。
- 现有登录相关套件 sessions、registration、browser-sessions、security、access 在完整验收中均通过。

单元测试：mobile-client 19 项，news-service 4 项，settlement-native 2 项，共 25/25 通过。

## 与 Codex 的协作点

- `src/worker.template.mjs.in` 与 `backend/codex-development-20261112` **有合并冲突**。Codex 分支基于 32dec7e（含未发布交易代码的模板）。建议 Codex 改基于 `claude/reproducible-860bea19`，否则合并会带回未发布代码，或破坏可复现构建。由 Codex 决定。
- `scripts/build.cjs`：两边的 `--development` 代码相同，只剩行尾差异造成的冲突，按任一边处理即可。
- `web/login.html` 同时是管理员域名的登录页：管理员 2FA 界面已改版，契约仍是 `/api/admin/login` 和 `/api/admin/me`，未变。
- 隔离测试服务器不提供 `/api/registration-policy`：该接口在 Worker 外层，测试中需要模拟。可请 Codex 在 `qa/isolated-server.cjs` 中补上。

## 待你决定 / 未覆盖

- 品牌：页面仍是 CN Capital，与生产一致；是否改为 NUVEXA 需要你确认。
- 手机 App 内登录表单（`#auth-form`）未改版，也未在真机上测试。其中“会话仅保存在内存，刷新页面后需重新登录”的文案可能与现行 Cookie 会话不符，尚未核实。这是下一项任务。
- 开场动画为 3.5 秒，可点击跳过。
