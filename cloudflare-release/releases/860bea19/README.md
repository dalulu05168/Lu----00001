# 生产版本 860bea19 保全与可复现构建

Worker `lu----00001`，2026-11-12 发布，生产流量 100%。上一版本 733317be 用于回滚。

## 可复现构建

在本分支执行 `npm ci` 和 `npm run build`，从已提交源码生成的 `dist/worker.mjs` 与实际部署包逐字节一致：SHA256 `d055098d474f651d9085b81d66787f45e542d387f97d35f60b78cc0a1e43d8d0`。构建会按 `release-manifest.json` 校验摘要，不一致即失败。

已验证：本机全新克隆，`core.autocrlf` 为 true 和 false 时各构建两次，四次结果相同。Linux CI 尚未验证。

本目录的 `worker.mjs` 是部署包原件，只作对照，不参与构建。

## 线上包为何曾无法从 Git 重建

1. 2026-11-12，Codex 从 08bbfd25 出发连续发布了 9 个版本（256511cb → 5854e267 → 9f9777c2 → ec220b82 → e1d382e2 → 4eb23e7c → 247ae441 → 733317be → 860bea19）。每一版都由 `build-admin-release.cjs`、`build-admin-design.cjs` 或 `build-frontend-sync.cjs` 修补上一版已发布的打包文件，不是从模板构建。
2. 修补用到的源码从未提交。`release-manifest.json` 仍停留在 08bbfd25。
3. Codex 工作区的 `worker.template.mjs.in` 还包含未发布的交易一致性代码（下单意图、报价校验，需要 `request_intent`、`quote_evidence` 表）。`build-admin-release.cjs` 发布时会断言这些代码不进入生产。线上发布记录也显示数据库没有这两项（`publication.json` 的 `schema` 字段）。
4. 设置为 `core.autocrlf=true` 的机器检出时会改写 LF 文件，构建结果随之改变。现在已用 `.gitattributes` 固定构建输入的字节。

## 本分支相对 Codex 源码的改动

- `src/worker.template.mjs.in`、`src/products/service.js`：以 08bbfd25 的源码（c6ef5ca）为起点，只加入线上实际存在的后端改动，内容如下：
  - 出入金审核、客服回复、IPO/基金结算的审计日志和防重复提交；
  - 公告和产品的变更原因；
  - `/admin` 改为新运营工作台。
- 未发布的交易代码已移出。参考差异见 `unreleased-backend-from-codex.patch`，权威版本在提交 32dec7e（远程分支 `backup/prod-860bea19-20261112`）。
- `scripts/build.cjs`：后台展示样式（`web/admin-presentation.css`）放在 head 开头，手机镜像视口样式放在 head 结尾，与线上一致。
- 删除模板末尾指向不存在文件的 `sourceMappingURL` 注释（线上已删除）。
- `service.js` 中一行保留线上的 LF 行尾。

## 已知回归（如实复现，未修复）

860bea19 的电脑客户页、手机页和后台内嵌手机镜像缺少 `design-system.css`；08bbfd25 时都有。原因是前台同步使用了旧版 `build.cjs`。`scripts/build.cjs` 中的 `designSystemPages`、`designSystemInMobile` 标记了这一点。修复应作为单独改动处理，并重新测试。

## 只读核对线上

~~~powershell
node scripts/verify-live-release.mjs releases/860bea19
~~~
