# Issue #42｜窗口5 第二阶段真实 UI 源码修补与交接｜2026-11-08

**状态：UI 清理候选已执行并经离线/隔离浏览器核验；交易七项上线端到端 0/7，未发布。** 已读取总指挥评论 #6715968333，按指定的“窗口5独占 GPT 资料库最终设计包”施工，不改旧 GitHub UI、`src/http-api.mjs`、交易/报价/管理后台共享代码及数据库。

## 一、本轮新增真实代码（非重复第一轮）
上一版候选：`/交易平台/CN_Capital_新版三端_清除假数据_待对接_20261108_验收候选.zip`，SHA256 `9ed7b73f2aa65df484a608aeebf8f285fe89c2085726802eeaf4f77e7fc526db`。

**第二阶段修补 ZIP**：`/交易平台/CN_Capital_新版三端_UI清理_第二阶段_20261108.zip`，SHA256 **`3f0e71dc70cce3a9396e4964f35a779aef04e6bc887c1fb1a42ed88d7e9e7a93`**，1,922,184 bytes，21 文件。已从 GPT Library 实际重新复制、与本地 ZIP 逐字节比较一致（`cmp`），ZIP CRC 21/21 OK；源 ZIP、第一阶段 ZIP 均保留。

三份真正改过 JavaScript 的文件：
- `前台.html`：SHA256 `f9b38dd10837052bbb00731e9cdd27a2e0d6423cfc9200aafe558e7816bd159a`；
- `手机端.html`：SHA256 `07bf03895275a265e86ead549585fd28e7629d8db11253f42ff7bc9afb2d4a81`；
- `后台.html`：SHA256 `f4a49976a7ef0358753f20ed87eb26d989c46d6f8c5f40853c95c2924a0b76e0`。

**精确修补**：删除三个图表共享的 `bridge()` 随机生成 1D/5D 盘中 OHLCV 与成交量代码、空路径随机种子及静态 `2026-01-01` 年初日期。 `ser()` 只过滤实际传入 `DL` 的 OHLCV；没有真实条形就保持空态；按收到数据的实际日期筛选 1D/5D/1M/6M/YTD/1Y/All。**没有声称这些原始输入已经来自获许可真实上游**；图表真实注入尚未接线。不能用此过滤代替合规源验证。

新增 ZIP 内 `DOM_EVENT_API_MAP.md`，交接前台 `data-b`/表格/资金和客服表单、手机 `data-a`、后台 5 页/11 弹窗的 DOM→后端 API/权限/零值或未知/401/403/503；明确后台旧十模块不能删除；后续由窗口3/4/6在后端阶段 I–III 通过后逐端绑定。不在客户可见 UI 新增技术说明。

## 二、实际测试（运行目录为解压后 ZIP，非线上）
```bash
node qa/verify-static.mjs .
node qa/verify-chart-data.mjs .
node qa/verify-preservation.mjs .
python qa/verify-browser.py
```
- **静态：PASS**，3 HTML / 13 内联脚本；交易禁用门禁等仍在；
- **图表数据：PASS 21/21**，测无记录、1D/5D 不扩成假分时、日内记录原样、无效 OHLCV 拒绝、跨年 YTD、1M；
- **设计保真：PASS**，和上一阶段候选严格对比三端非脚本 HTML、所有 CSS 样式块、页面 ID 和静态事件绑定属性的 SHA/列表完全一致；
- **隔离 Chromium：PASS 9/9**：电脑版断网、空对象、有效 0、非 0、401、503；手机 390/428px；后台 1440px，观测 page errors []。Chromium 中注入的余额与失败均为**明确测试桩**，不是 QA API、生产数据或银行/交易结果。
- ZIP 文件校验：**21/21 CRC OK**，Library 回读 SHA256 与本地相同。

页面 ID 保留：前台 **93/93**、手机 **5/5**、后台 **103/103**，11 个后台弹窗未删。上述保真是静态 DOM/CSS 和基础 Chromium 测试，不冒充全量业务按钮 E2E 验收。

## 三、GitHub 交接与隔离界限
工作分支 `work/ui-library-cleanup-stage2-20261108`，派生自本窗口原 `work/ui-library-cleanup-handoff-20261108`，**只放脚本/交接文档，不往旧 GitHub `web/*.html` 写**，避免跨窗口覆盖用户的 GPT Library 最新设计。GitHub 本轮新增独立 fail-closed 证券走势图测试 `qa/issue-42-ui-cleanup/verify-stage2-chart-source.mjs`；本文件记录真实 ZIP 校验及交接。生产/共享 QA 部署、DB 迁移、资金交易写入、PR 合并均为 **0**。

## 四、七项验收与阻断
#1 US/CN 真实许可报价、#2 名称/代码/历史 K 线、#3 买、#4 卖、#5 DB 资金持仓、#6 内部成交记录、#7 盈亏：本窗口 **0/7 已在授权端到端 QA 验收**，不代替市场/交易/数据库负责窗口宣告完成。仍缺：许可与行情数据注入、真实订单及账户回读、现存资金/KYC/客服/内购等 API 逐端授权验收、后台原十模块与 2FA 正式权限 E2E。发布顺序仍为先七项业务/隔离数据库与真实 API 测通，再由窗口3/4/6将**本 ZIP 经总控签收后**接线，保留 `TRADING_ENABLED=false` 直到授权验收。

**重要：不得整支合并本分支进入 QA**；请总控和三端窗口按该独立 ZIP 及 SHA 锁版，而不是沿用旧 `web/index.html` 或旧 UI 分支。
