# 生产版本 860bea19 保全记录

本目录保存 2026-11-12 由 Codex 部署到 Worker `lu----00001` 的发布包，生产流量 100%。上一版本 733317be 用于回滚。

部署时源码未提交到 Git，只存在于本机 `Nuvexa-Codex主开发` 工作区和其 `artifacts/unified-ui-release-1RWOVS`。本分支把这些源码（11 个修改文件、25 个新文件）和实际部署的 `worker.mjs` 一并纳入版本控制。文件均原样复制，未改动内容。

- `worker.mjs`：实际部署的打包文件，SHA256 `d055098d474f651d9085b81d66787f45e542d387f97d35f60b78cc0a1e43d8d0`。
- `candidate.json`、`publication.json`、`online-readonly.json`、`final-verification.json`：Codex 的发布记录原件。

该打包由 `scripts/build-frontend-sync.cjs` 与 `scripts/build-admin-release.cjs` 在已发布的线上包上叠加前台与后台组件生成，并非由 `npm run build` 从模板直接构建。`release-manifest.json` 仍记录旧版本 08bbfd25，未修改。

只读核对线上是否仍为此包（只发送 GET 请求，不需要凭据）：

~~~powershell
node scripts/verify-live-release.mjs releases/860bea19
~~~
