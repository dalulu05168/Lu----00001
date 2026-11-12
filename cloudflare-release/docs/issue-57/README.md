# Issue #57：桌面字体设计契约（news / layout-controls）

**原因**：生产 08bbfd25 在所有页面注入 `web/design-system.css`（共享视觉契约）。860bea19 前台同步时，电脑客户页和手机页（以及后台内嵌手机镜像）丢失该样式。电脑端因此回落到 `ui-refinements.css` 的 `Inter, "Microsoft YaHei UI", …`，`qa/design-contract.cjs` 的字体断言失败。

**修复**：`scripts/build.cjs` 只改两个开关，按 08bbfd25 的方式重新注入现有样式表。未改任何 CSS 规则，也未改任何测试断言。

**对比**：
- 后端、登录页、新运营工作台与 1d09eee 逐字节一致；
- 电脑页、手机页只多出该样式块；
- 后台页只有内嵌手机镜像多出该样式块。

**证据**：

| 构建 | news | layout-controls |
|---|---|---|
| 修复前 13b42a3c（1d09eee） | 失败 | 失败 |
| 生产对照 08bbfd25（同一套测试文件） | 通过 | 通过 |
| 修复后 bb4c87a5 | 通过 | 通过 |

修复后完整回归：32 套中 31 套通过；`trade-database` 不适用（测试的是未启用的 `cnOrderIntent`）。

截图与实测字体见 `before-13b42a3c-*`、`after-bb4c87a5-*`、`results.json`。全部在本机隔离 Worker + PGlite 上运行。
