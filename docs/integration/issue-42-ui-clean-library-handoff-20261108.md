# Issue #42 — 三端 UI 清理候选交接（2026-11-08）

## 责任与交付
窗口 5（UI 清理）；仅在 GPT 资料库最新原包之上修复 UI 中的假数据、假成功和未知态，保留三端页面/现有功能入口/弹窗/响应式。**未改变或部署业务后端、行情源、数据库、公共路由、正式域名。**

最新版交接 ZIP（GPT Library）：`/交易平台/CN_Capital_新版三端_清除假数据_待对接_20261108_验收候选.zip`。完整包含三份真实 HTML、`README_交接说明.md`、`qa/manifest.json`、静态和 Chromium 检查脚本、九项隔离截图与日志。另有可下载对话附件。

完整 ZIP SHA256：`9ed7b73f2aa65df484a608aeebf8f285fe89c2085726802eeaf4f77e7fc526db`

| 文件 | 来源 SHA256 | 清理后 SHA256 |
|---|---|---|
| 前台.html | `2eff10b9b4e02730a2434cc196b6451fc412d05c23ec1711a146026b646e049d` | `e7a2c144df41c05655dff9e8480a32d3360cd2757754dcce4369afc2a325e7a5` |
| 手机端.html | `62ad772cec52c8e844fbf05e90afe73d1ce1e1ae013c13adffb71cd2301ca91b` | `12d3661f779d3e537ccc6744aff3a18479a75d15bf5ed71c3496c049f99f0fbf` |
| 后台.html | `a7fc08450f4238beaebcaaf336d589d682fab8f60c1c44316aecd31be2f8b98d` | `289518ac384ccfb138cc719dbb5d8ce3313cd4493ecd78d96ceaede5a4d5acfd` |

## 修改与交接
- 前台：现金/总资产/已实现盈亏仅用真实快照明确字段；未同步显示“—”，不从充值申请和订单推测现金，不用本地列表合成历史资产线；未确认的订单/持仓/申请/自选区别于真正空数组。保留 `TRADING_ENABLED=false`。
- 手机/后台镜像：缺账户快照或未认证保持未知，不由浏览器本地生成订单、KYC、银行、资金或客服成功；US/CN 市场展示（不再显示其他旧市场），原布局和页面交互入口仍在。
- 管理后台：未得到 Promise/后端肯定响应时不显示保存成功；保留五页和原有 11 弹窗 DOM。
- 绑定入口详见 ZIP 内 README：前台 `data-b=...`、`#tb-ord`/`#tb-hold`/`#tb-watch`/`#tb-req`，动态手机 `data-a`，后台 `#p-over` 等。其他窗口应以 SHA 固定最新 UI 包，不以旧 GitHub UI 代替，也不得提前将此包发布。

## 本轮实测（严格区分本地隔离与线上）
- `node qa/verify-static.mjs .`：`UI_STATIC_OK`，3 HTML、13 个内联 JS 通过语法检查，已知 DOM/交易门禁通过。
- `python qa/verify-browser.py`：**9/9 PASS**；电脑离线、空响应、合法零余额、合法非零余额、401、503，手机 390px/428px，后台 1440px；控制台 page errors 均为空；测试所用快照及失败响应均为 **隔离测试桩，不是真实生产 API**。
- `unzip -t`：ZIP 17 文件均完整，CRC 检查无错误。
- UI ID 保留数：前台 93/93、手机 5/5、后台 103/103；CSS/style/script 块数量不变。全部业务按钮实际 API 生效、全量视觉回归仍待绑定后验收。

## 7 项业务/阻断
七项交易业务的**端到端上线验收 0/7**（本窗口不负责实现）：US/CN 合法报价和 K 线、内部买单、内部卖单、真实 DB 账本/持仓、订单回读、准确盈亏。尚无从该 ZIP 指向已授权生产/QA 后端的绑定；业务窗口分别继续开发。不能由静态 UI 通过推定账户或资金业务已完成。

## 交付边界
此 GitHub 分支仅提交 UI 清理的测试与交接文档（不把最新版三端 HTML 覆盖旧 GitHub 线上页面）；完整 HTML 在上述 GPT Library ZIP。未合并、未部署、未运行生产 DB 迁移。待阶段 I–III 的真实行情/内账/盈亏隔离 QA 验收后由窗口 3/4/6 按 DOM→API→DB 回读适配三端。
