# Issue #58 发布操作清单

基线：`release-candidate/nuvexa-20261112@f0e63b6896ec7e3d0ec5360742ee0db284e90515`。本目录仅补充部署工具和本轮账户核查，不替代 `../release-review-58/` 的业务验收报告。没有重跑原有业务验收。

## 已完成的离线修复

- 普通 `build.cjs` 现在验证已经验收的候选 SHA，不再要求候选与旧生产包相同；历史 `release-manifest.json` 保留，`--record` 被拒绝。
- Worker 仍为 `bb4c87a5b840499563d76bf488ce3533104404dc3484b1f3e7ad3643d4c0fe6a`，原先六项归档哈希全部一致。新增输出已经内嵌于同一 Worker 的 `assets/admin-next.html`；完整七项锁在 `candidate-lock.json`。
- 旧生产上传/激活脚本立即停止，不再使用硬编码账户、旧 schema 证明和 `keep_assets` 上传候选。
- 新入口只接受 staging，显式上传完整 assets；保留兼容日期、flags、变量、Observability 和 ASSETS。测试包一次性映射客户、后台、手机及 workers.dev Host，避免跳回正式网站。生产包字节不变。
- 候选/产物/配置哈希、独立 Worker、Host、Neon 分支/端点/数据库/角色/TLS、单版本 100% 基线、绑定内容、路由、调度、回滚资源及恢复演练证明均有门禁。上传后、激活前再次检查基线；任何失败停止后续步骤。激活开始前后写操作日志，不自动回滚或修库。
- 测试环境 cron 显式为空；正式 cron 保持现状。生产版本回滚不恢复数据库、域名或 cron，不能据此代替数据库恢复演练。

## 离线操作（仓库根目录）

以下命令用于后续复现；本轮已完成的测试不要再次运行。

```powershell
node cloudflare-release/scripts/build.cjs
node cloudflare-release/scripts/release.cjs check
node --check cloudflare-release/dist/worker.mjs
node cloudflare-release/scripts/release.cjs prepare cloudflare-release/staging-target.example.json artifacts/staging-58
node cloudflare-release/scripts/release.cjs validate cloudflare-release/staging-target.example.json artifacts/staging-58
```

真实使用前将 example 复制到 `cloudflare-release/artifacts/target.json`，填写真实测试账户、专用测试 zone、三个测试 Host、workers.dev Host、隔离 Neon 项目/分支/端点以及**经过确认**的生产分支/端点排除清单。示例不是实际资源授权。输出目录必须是新的 `cloudflare-release/artifacts/` 子目录，避免覆盖现有记录。

`prepare` 输出完整 Worker、全部页面及 Logo、独立 `wrangler.json`、503 bootstrap 与其配置、目标身份和逐文件哈希。工具不会生成或存储 secret。测试包与正式包因为 Host 映射具有不同哈希，`bundle.json` 记录两者关联。

## 云预发（账户条件具备后，由操作员执行；本轮未执行）

1. 在明确的隔离 Neon 分支创建测试数据库及专用角色，只导入合成数据。不要从生产克隆真实客户数据。数据库初始化使用经过审核的 schema 清单；不能盲目遍历全部迁移，尤其不启用 `migration-trade-evidence.sql`。本工具**没有自动执行迁移**。
2. 在独立工具目录安装并锁定 `wrangler@4.134.0`；保留该工具目录的 lockfile。设置 `WRANGLER_ENTRY` 为其 `node_modules/wrangler/bin/wrangler.js` 绝对路径。工具核验包名与精确版本，不依赖 PATH、gh 或全局 Wrangler。
3. 凭据由操作员注入当前进程：Cloudflare 账户 token、Neon 授权及 `STAGING_DATABASE_URL`。不要放入命令参数、源码或报告。`NUVEXA_STAGING_WRITE` 必须等于测试 Worker 名。这是操作员有权写 staging 的声明，不代表生产批准。
4. 首次部署运行 `bootstrap`：仅当目标 Worker 不存在、Neon 隔离检查成功时创建 503 占位 Worker，带测试域名、完整静态资源及空 cron。其 Worker-first fetch 总是 503，不运行数据库代码。
5. 通过测试 Worker 的密钥管理界面配置 `runtime-bindings.json` 中六个 secret 的**测试值**。`DATABASE_URL` 使用 `bind-db`：工具先验证 URL 的端点、数据库、角色及 TLS，再以 Neon 控制平面确认端点归属和非默认分支，然后只写测试 Worker。不要复用生产密钥或启用真实付费外部调用。密钥配置必须在快照之前完成。
6. 在隔离资源完成真实恢复演练。创建忽略目录下的演练证明 JSON，包含 `branchId`、`completedAt`、`restoredAndVerified:true`、`evidence`（真实演练记录路径）。设置 `NUVEXA_DB_DRILL_FILE` 指向该文件。该文件是操作员证据输入，工具不自行证明恢复成功。
7. 只读 `snapshot` 核对测试域名、无额外 zone route、空 cron、必需绑定、runtime、旧版本及恢复证据。记录不可覆盖，30 分钟后过期。
8. `deploy` 先检查同一产物与最新基线，通过 Wrangler **versions upload** 上传资源和代码，上传后校验新版本注释、绑定值及 runtime，确认流量仍在旧版；再次检查后才激活**测试 Worker**。之后核对 active ID/100%、路由/设置/cron、客户/手机/后台页面、三 Host Logo 与 ready。结果及 journal 留在 baseline 文件旁边。
9. 如需 Wrangler dry-run，使用专门准备的一份副本；dry-run 会新增文件，原目录随即不再通过精确文件清单校验。实际 deploy 使用重新 `prepare` 并验证的目录，不能手工改清单绕过。

示例（从仓库根运行；以下有 staging 写入，当前未授权/未执行）：

```powershell
node cloudflare-release/scripts/release.cjs bootstrap cloudflare-release/artifacts/target.json artifacts/staging-58
node cloudflare-release/scripts/release.cjs bind-db cloudflare-release/artifacts/target.json artifacts/staging-58
node cloudflare-release/scripts/release.cjs snapshot cloudflare-release/artifacts/target.json artifacts/staging-58 cloudflare-release/artifacts/baseline-58.json
node cloudflare-release/scripts/release.cjs deploy cloudflare-release/artifacts/target.json artifacts/staging-58 cloudflare-release/artifacts/baseline-58.json
node cloudflare-release/scripts/release.cjs rollback-check cloudflare-release/artifacts/target.json artifacts/staging-58 cloudflare-release/artifacts/baseline-58.json
```

bootstrap 使用同一个预发配置，创建 Worker/域名可能需要额外账户权限。它不能替换现有 Worker。实际 staging 完整业务验收、跨 Host Cookie 行为和外部服务必须记录云端结果，现有本地验收或本轮模拟不冒充云预发。当前没有执行这些写入步骤。

## 只读生产盘点

浏览器核查事实见 `ACCOUNT-CHECK.md`。也提供无写入路径的 GET-only API 盘点器：

```powershell
node cloudflare-release/scripts/release-audit.cjs cloudflare-release/artifacts/audit-target.json cloudflare-release/artifacts/production-before.json
```

输入只有 `accountId`、`worker:"lu----00001"`、两个正式 zone 的 `zoneIds`。输出 active versions、资源元数据、settings、域名、完整分页的 zone routes、schedules；不能回读 secret，也不能确定数据库身份。失败不会把部分结果标为可发布。不能凭这份快照宣称云端资产逐文件一致。

## 最小授权

| 操作 | 最小访问范围 | 是否生产写入批准 |
|---|---|---|
| 当前版本、流量、runtime、绑定名/类型、Assets 元数据、cron | Cloudflare 现有 Worker 的只读成员访问；API 使用 Workers Scripts Read，限定账户/可用 Worker scope | 否 |
| 正式域名、zone routes / DNS 记录 | 对两个正式 zone 的 Workers Routes Read；只有读 DNS 时额外 DNS Read/Zone Read | 否 |
| 读日志（本轮不需要客户请求日志） | Workers Tail Read 或对应 Worker 的 Metadata Read-Only | 否 |
| 创建独立测试 Worker | Workers 产品 Admin（创建能力）；创建后收窄至该 Worker Editor | 只需 staging 写入授权 |
| 测试代码/资产上传、secret 设置、测试版激活及回滚 | 该测试 Worker Editor / Workers Scripts Write | 只需 staging 写入授权 |
| 绑定或修改测试域名/路由 | 该 Worker Editor + 专用测试 zone 的 Workers Routes Write；如单独改 DNS 则仅该 zone DNS Write | 只需 staging 写入授权 |
| Neon 项目/分支/端点/恢复窗口元数据 | 目标项目 Viewer 或受限只读 OAuth；现有浏览器会话可只读核查 | 否 |
| schema、迁移历史及约束 | 正确数据库的只读角色，必要 schema USAGE / SELECT；事务 `BEGIN READ ONLY` | 否 |
| 创建测试分支、端点、数据库/角色及恢复副本 | 仅独立测试项目的 Editor；SQL 仅测试库的初始化权限 | 只需 staging 写入授权 |
| 正式 Worker 上传（即使不切流）、生产 Assets/secret/绑定/cron 修改、激活或回滚 | 正式 Worker Editor / Workers Scripts Write；域名调整另需对应 zone 写权限 | **必须单独明确批准；本工具不提供生产写入口** |
| 生产迁移、数据修复、恢复/PITR、生产角色或连接切换 | 目标生产项目和数据库对应写权限 | **必须单独明确批准；本轮禁止** |

Neon 项目级 API key 通常是 Editor 能力，并非天然只读；不要为“只读核验”泛化授予组织管理员。技术授权与用户的生产写入批准是两个独立条件。Cloudflare 只读不能取得已加密 secret 明文，扩大只读 token 也不能解决这个问题。

## 正式上线仍须完成

- [ ] 从受控部署记录或操作员提供的**非敏感连接身份**，确定实际生产 DATABASE_URL 对应的 Neon 项目、分支、端点、数据库与角色；不要提供密码或完整 URL。必要时由授权操作员在本地解析现有 secret 来源，仅回传这些字段。
- [ ] 在该身份上复核 schema、约束和迁移来源；不得因迁移记录缺少文件名就重放迁移。
- [ ] 取得云端当前完整版本 ID、Assets 配置和逐文件资源证据；确认回滚版本及其资产仍可用。浏览器当前只展示短 ID 和 ASSETS 存在。
- [ ] 补齐 Cron 的真实执行证据；“有调度”与“结算成功”分别验证。本轮历史页面无事件，不能据此断言没有执行，也不能视为成功。
- [ ] 完成独立云预发与真实备份恢复演练；不要重跑已经完成的本地业务测试来替代。
- [ ] 解决 Issue #58 已有的客户权益/执行与报价/重大风险披露门禁（不在本次代码修改范围）。
- [ ] 冻结最终源提交及七项资源锁、生产只读快照、回滚资源、数据库恢复点；取得**正式上传及切流批准**后，另行审核生产发布步骤。
- [ ] 上线后核对双域名、手机 UA、后台访问控制、active version 和资源哈希，观察错误与调度，再结束窗口。

回滚检查不写生产。真正回滚前必须明确目标旧版本、Assets 与 secret 兼容性，检查域名/cron 快照并获得批准。Worker 回滚仅恢复 Worker 版本；不得自动回滚数据库或覆盖真实交易数据。测试 Worker 可由操作员用固定 Wrangler 入口执行 `rollback <baseline中的完整旧版本ID> --config <测试配置>`，随后重新只读核验版本及外部配置。失败先停止并查 journal，不盲目重试激活。

## 依据

- [Cloudflare 版本与部署](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [Cloudflare 回滚](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [Wrangler 配置](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare 权限](https://developers.cloudflare.com/workers/authorization/)
- [API token 权限](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
- [Neon API keys](https://neon.com/docs/manage/api-keys)
