# Issue #42 — 窗口5 UI 第三阶段保真与接线交接（2026-11-08）

**基准**：GPT Library /交易平台/CN_Capital_新版三端_UI清理_第二阶段_20261108.zip，SHA256 3f0e71dc70cce3a9396e4964f35a779aef04e6bc887c1fb1a42ed88d7e9e7a93。原仓库 work/ui-stage2-library-upload-20261108 的三 HTML、DOM_EVENT_API_MAP.md、manifest.json 的 Git blob 经真实 git hash-object 对照：5/5 相同。

## 实际修改（保留颜色、布局风格、业务模块）
1. ui/stage2-20261108/手机端.html：原四处 max-width:420px 断点改为 599px，修复 428×926 手机端实测出现 390×844、(19,41) 偏移、1px 外框及 36px 圆角的伪全屏问题；360/390/428 宽均实际变为从(0,0)覆盖全视口、无边框/圆角/横向溢出。600px 宽仍保留居中带外框桌面预览；内嵌镜像 .emb 行为保留。未修改颜色和控件结构。
2. ui/stage2-20261108/后台.html：审批列表尚无后端数据却写死共4条，仅改一处静态文本为共—条；不触碰原后台权限/API。
3. ui/stage2-20261108/前台.html：完全未改动。

## 第三阶段锁定哈希（SHA256）
| 文件 | SHA256 | 字节 |
|---|---|---:|
| 前台.html | f9b38dd10837052bbb00731e9cdd27a2e0d6423cfc9200aafe558e7816bd159a | 154465 |
| 手机端.html | afc62f87ef8a99b634ae6c28ef010af42e02fee9c486582041b5b95e64b79afc | 79411 |
| 后台.html | c4a7f0584bb0152c1967a7030a949ed9c44cc00b61247b61b26f46148a6d60e7 | 167084 |

## 验证
- node qa/verify-static.mjs .：PASS 3 HTML / 13 内联脚本。
- node qa/verify-chart-data.mjs .：PASS 21/21（仅固定行情测试数据，不是真实报价）。
- node qa/verify-preservation.mjs . --stage3：PASS；强制恢复两处白名单差异并比对原阶段二三个文件的 SHA、HTML/CSS/IDs/静态控件。原 qa/preservation-baseline.json 不变。
- python qa/verify-stage3-map.py：PASS；3 个文件哈希、10 前台 ID、17 手机动态事件、16 后台 ID、7 组真实后端路由合同与权限提示。
- python qa/verify-browser.py：PASS 9/9（隔离余额零值/未知/401/503 + 三端静态渲染）。
- python qa/verify-stage3-browser.py：PASS 9/9（新增真实浏览器几何检查：360/390/428 全屏；登录不能本地绕过；桌面资金弹窗；后台五页/11弹窗和客户导航）。截图、日志在独立第三阶段交付 ZIP 中。没有宣称 Safari/iPhone 实机已测试。
- GitHub 分支 qa/verify-stage3-browser.py 提供独立重跑脚本；目前未声明该新分支 GitHub CI 或线上部署通过。

## DOM_EVENT_API_MAP.md 与下游边界
该交接地图未修改，已逐项核对前台 data-b 资产/资金/订单/身份/银行/客服，手机 Shadow DOM data-a 登录/导航/买卖/申请/客服/图表，后台五页与十一弹窗。地图所列 /api/account、/api/account/analytics、/api/orders、/api/requests、/api/private-data、/api/support、/api/admin/me 是**待接线合同**，不是已通真实 API 的事实；401/403/503、真实零余额与未知值严格区分。
七项业务授权 HTTP/DB E2E 总控验收依然 0/7；本窗口没有修改交易/行情/数据库/公共 API 或生产 web/ 文件，也未合并/发布。后台原十模块、MASTER/SUBADMIN 两阶段 TOTP、资金/KYC/银行/客服/理财功能继续交由窗口4/6逐项保留验证。