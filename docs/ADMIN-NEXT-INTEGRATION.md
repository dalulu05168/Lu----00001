# Nuvexa 新后台第一版整合

分支 feat/admin-next，基础 HEAD 7362714a37f10dc2807b6d33674bccecd0231044。承接尚未提交的交易一致性修复，二者尚未拆分提交；新后台候选包含前批 orders 字段迁移依赖，不可绕过前批验证直接上线。

## 附件检查
用户提供 TODO.md、Home.tsx、index.css、code.zip。附件仅作为设计与代码参考，TODO 中勾选的完成状态未经运行不当作本项目验收。
单独文件与 code.zip 内 Home.tsx / index.css 不同，已同时检查；压缩包内包含 OrderDrawer、ApprovalDiffModal、DangerConfirmModal。没有执行附件里的登录、迁移、构建或安装脚本。
压缩包是 React/Manus OAuth/Express/MySQL 方向工程；当前项目是 Workers、Neon 和现有 Cookie/2FA。保留视觉与交互方向，未搬入不兼容后端及几十项无关依赖，也未导入演示登录或角色切换。

## 设计保留与调整
| 设计 | 整合处理 |
| --- | --- |
| 深蓝侧栏、白色卡片、青绿重点色、圆角和状态文字 | 已应用到独立新后台 |
| 统一右侧详情抽屉 | 账户、订单、持仓、资金审批、审计共用；420px / 620px；720px 样式预留 |
| 订单生命周期 | 优先展示可核验的内部成交及时间；不制造部分成交、券商提交或已结算状态 |
| 订单字段 | 展示真实编号、标的、市场、方向、数量、价格、金额；未知 ISIN、交易所、费用、结算日明确未提供/待确认 |
| 审批前后差异 | 显示真实节点、金额、方向和审核要求；原余额/到账时间等接口没有的快照不臆造 |
| 危险操作 | 审批和登录限制要求原因至少10字符及完整编号；提交前重取状态；禁用重复点击，错误时提示先核查回执 |
| 冻结账户 | 当前只支持登录限制，明确不是冻结资金或持仓；不把缺失功能冒充可执行 |
| 角色和数据范围 | 只使用服务端 MASTER/SUBADMIN，保留所属客户权限；三层角色/动态RBAC不伪装接通 |
| BVB / NYSE / Nasdaq | 当前接口只有 US/HK/CN/MY 市场字段；US 不等于已知 NYSE/Nasdaq；不新增 BVB 可交易标的或假币种 |
| 表格 | 固定表头/首列、列显示、密度、筛选回显、偏好保存恢复、批量选择、实际CSV导出；只导出已加载授权数据 |
| 批量审批/冻结、转交、独立保存意见 | 缺事务/审批流接口，暂不提供写入按钮 |
| 快捷搜索 | Ctrl+K / Cmd+K；页面、已加载账户/订单/审批/审计分组；明确不是服务端全库搜索 |
| 最近访问/收藏 | 保存页面偏好，不把客户订单全文保存到浏览器 |
| 空状态与加载 | 加载骨架、失败重试、无结果清筛选、未接入说明；未配置/未接入不可显示正常 |
| 手机后台 | 响应式账户/订单/审批/搜索；不加载复杂兼容模块 iframe，提示电脑端操作 |
| 假数据/假成功 | 移除原型身份模拟、趋势装饰数据、静态连接正常、toast式导出/审批成功；仅响应真实回执 |

## 原有功能保留方式
新版客户账户、订单、持仓、资金审批和审计直接调用现有 API，仍受服务端角色、客户归属、Cookie、CSRF、管理员2FA及再验证保护。
产品配置、资料审核、子账户完整设置、客服公告、IPO/基金复核和手机镜像暂通过同源兼容工作区复用旧模块。它们尚未全部重写成新原生组件；没有删旧功能或历史文件。
用户授权要删除的是新设计中无用内容，本轮不物理删除原设计文件、旧后台、历史快照或任何数据。

候选入口：/admin-next；原 /admin 不变。兼容页 /admin-compat 只在后台域名响应，同源嵌入；自身响应 X-Frame-Options SAMEORIGIN / frame-ancestors self。新入口仍 DENY 外部嵌入，frame-src 仅补同源以加载兼容模块。
静态页面本身不包含客户数据，进入后 /api/admin/me 验证；401跳转原登录，权限由后端决定。原型不含真实认证的 React 组件没有直接复制运行。

## 修改文件
新增 cloudflare-release/web/admin-next.html、admin-next.css、admin-next.js、qa/admin-next.cjs。
修改 scripts/build.cjs（打包新页，不改原摘要守卫）、src/worker.template.mjs.in（仅追加新页/兼容页路由）、scripts/test-trade-candidate.cjs（新增隔离套件调度）。
其余交易修复和旧文档保持；本文件是新增说明。

## 实际验证
36 项离线单元测试全部通过。9组隔离验收全部通过：admin-next、contracts、order-concurrency、write-receipts、browser-sessions、security、quote-guards、mirror、trade-database。
新后台增强浏览器套件10项通过：真实Worker CSP/嵌入边界、真实身份、真实订单抽屉、实际CSV文件、Ctrl K、原因+编号审批、旧功能兼容、移动无横溢、子管理员范围、无未捕获脚本错误。
首次测试因缺资料审批、客户未归属子管理员分别失败；修正隔离测试前置数据后通过，没有放宽服务端校验。
证据：artifacts/acceptance-i0U4jh/results.json、artifacts/acceptance-Dllsc6/admin-next/results.json、artifacts/trade-candidate/admin-next-verification.json、admin-next-units.log；截图位于 acceptance-Dllsc6/admin-next/。
测试使用本机 PGlite 与浏览器网络拦截，禁止连接真实生产数据库；页面截图中的账户数量来自隔离测试数据，不是生产数据。

候选 SHA256：63292bd06d0be16c9652cff082edcaad16bea6bf693e9e5eb0ce3ea33ece8835。原 release-manifest.json 未修改，生产 dist 未覆盖；原生产构建仍会因摘要不一致拒绝该候选。未提交、未部署、未生产迁移。

## 剩余边界
这是一版真实数据与旧模块兼容整合，不是附件全部菜单都已原生实现。动态RBAC、BVB主数据/币种及交易支持、全库搜索、批量审批/冻结、转交流程、角色删除等需服务端专项实现与测试。
上线仍须先解决真实 PostgreSQL/Cloudflare 运行时验证、部署连接和迁移审核。上一轮上线授权不被当作本轮新后台已发布的证据。


## 第二批原生迁移（最新状态）
- 产品与证券：原生列表、统一详情抽屉、名称/发布状态编辑；档位、图片、交易密码、期限等复杂配置仍保留原模块。
- 产品修改复用现有版本化 API；新版要求原因及编号确认。服务端对传入原因校验10至500字符，并在原事务审计中追加原因与前后名称/状态/版本；旧调用没有原因时保持原兼容行为。不是全面强制所有历史客户端填写原因。
- 产品编辑发生并发变更时返回409，不覆盖新配置；浏览器实际验证已通过。
- 客户资料：所属子管理员原生待审列表、身份证明/银行卡抽屉、原因+编号确认、版本化审批。总管理员仍不能越过归属直接读取资料，不改变原授权模型。
- 证件明文图片只放当前抽屉；关闭后清空DOM，不持久化到浏览器，不提供资料详情导出。银行卡仅显示银行和尾号。
- 更新权限受限与单阶段资料审核文案，避免标为服务未接入或资金初审。
- 改动涉及 web/admin-next.js、admin-next.css、src/products/service.js、qa/admin-next.cjs，本批未新增数据库迁移。
- 浏览器专项由10项增加至15项，全部通过；最新候选9组隔离验收通过；36项离线测试通过。此前测试因同名控件及多元素选择器失败，已仅限定测试定位后重跑，业务断言未放宽。
- 最新证据：artifacts/acceptance-3ADRai/results.json、artifacts/acceptance-3ADRai/admin-next/results.json、artifacts/trade-candidate/admin-native-verification.json；产品抽屉截图在 acceptance-3ADRai/admin-next/native-product.png，截图均为隔离虚构账户与产品。
- 最新候选 SHA256 3afc38140a343eb22deb6e3ddfa6bcb29fa25657c9421c2d8dbfed189b985ca4，取代上节旧候选摘要。旧报告与证据保留，不能将旧摘要当本轮产物。
- 客服公告、完整子管理员设置、IPO/基金复核和复杂产品配置仍使用兼容模块；不是全部原生化已完成。
- 未提交，未部署，未生产迁移；原发布清单及dist未修改，独立 PostgreSQL/Cloudflare运行时验证仍待完成。


## 第三批：客服、公告与子管理员原生流程
本节为最新状态，客服/公告和子管理员基本管理不再仅用兼容iframe。
- 客服：总管理员原生会话列表、历史消息、文本回复；仍使用服务端权限，子管理员不增加客服访问权。查看标记只代表当前页面会话，不冒称全团队未读同步。
- 管理员回复增加既有 cn_write_receipts 的事务幂等机制；消息、审计及回执同一事务。新界面使用请求键，旧接口无键调用保持兼容（旧客户端不因此自动具备去重）。
- 通过 support GET 的 key 参数核对属于当前管理员且目标邮箱一致的回复回执，先执行原客户权限检查；不会返回他人回执。
- 浏览器 sessionStorage 仅存按管理员/客户隔离的随机请求键及消息 SHA256 摘要，不存正文；响应未知时保留原请求，不允许更换原文盲目重发。新请求被明确4xx拒绝可修正，已有未决请求不会因此丢弃。
- 发送前检查JSON请求不超过8KiB，正文不超过4000字符。会话内容以 textContent 显示，不能执行正文HTML。
- 故障注入发现通用 audit() 会吞异常，本批客服改用事务内直接 INSERT，不改变其他旧日志调用；审计失败时消息及回执回滚。
- 公告：原生读取、发布、撤下及版本冲突处理；新界面要求原因+platform编号确认，服务端保留现有锁及版本校验；可选原因新增10至500字符校验并记录 previousVersion，旧调用兼容。
- 子管理员：原生列表、固定SUBADMIN权限上下文、限制/解除登录；限制登录撤销旧会话，沿用服务端 parent_user_id 范围检查，不提供自助升权。详情默认导出排除邀请码。
- 完整开户、密码/2FA凭据管理、IPO/基金复核与复杂产品配置仍保留兼容模块，本批没有重写它们或宣称全部原生化。

变更集中于 web/admin-next.js、admin-next.css、src/worker.template.mjs.in、qa/admin-next.cjs、qa/isolated-server.cjs，无新增数据库迁移。

最终候选 SHA256：ad94309ef19b1eaee92847aa9b4e119807365b7c2038213b3aca27f2e29810b7。36项离线测试通过；9组完整隔离验收通过；增强后的新后台浏览器22项检查通过。原生产清单和dist未改，生产构建摘要守卫仍拒绝未发布候选。
证据：artifacts/acceptance-lralpz/results.json、artifacts/acceptance-F5XdNx/admin-next/results.json、artifacts/trade-candidate/admin-operations-verification.json、admin-operations-units-final.log。
未提交、未部署、未生产迁移。独立PostgreSQL与Cloudflare运行时验证仍未执行；本地PGlite及浏览器回归不能替代生产验收。


## 第四批：IPO与普通基金原生复核（最新状态）
- 原生工作区覆盖创建IPO/普通基金产品、录入发行价/净值、价格复核、IPO配售草稿及配售复核结算；此模块不再依赖兼容iframe。
- 金额/份额转换使用BigInt微单位，不经浮点换算。价格及配售均展示真实编号和当前值；写操作要求原因及编号确认，复用现有管理员二次验证。
- 管理员结算写入改为同连接事务内业务、审计和幂等回执一起提交/回滚；新界面提供请求键与核对未决操作，旧无键客户端仍仅有原状态约束，不宣称自动获得完整去重。
- 配售草稿可附expectedAllocation校验防止覆盖他人新草稿；复核仍核对当前配售数量。失败的新版本冲突可刷新重试，已存在但结果未知的请求保留原键。
- 保留既有规则：认购扣款/冻结、部分获配退款、份额记账、基金申赎。没有新增双人复核人制度；当前MASTER可按原规则录入并复核，是否要求不同人员需业务另行决定。
- 日期字段以数据库DATE文本返回，修复驱动转时间戳产生前一天显示的问题，新增录入日期与返回日期一致断言。不改变数据库日期或生效比较规则。
- 隔离验证：丢失创建回执后重试仅一个产品；过期配售草稿拒绝；10股认购、6股配售对应持仓与退款精确；审计故障回滚业务和回执；普通基金净值复核后申购/赎回、重复赎回、超份额拒绝通过。
- 新增qa/settlement-native.test.cjs，扩展qa/admin-next.cjs、qa/isolated-server.cjs；服务端变更在src/worker.template.mjs.in，前端在web/admin-next.js。无新增数据库迁移。

最新未发布候选 SHA256：55f60f8b5907eabbb69a0644d8c15d8bcf529ca855ad5d50d0173be01f39714e。38项离线测试通过，后台浏览器28项通过，9类隔离套件均有最终通过记录。
完整运行 acceptance-PbRwQs 中 security 首次跨分钟误报429，检查隔离计数证据为相邻窗口2和29；qa/security.cjs仅将直接计数测试固定now参数，真实HTTP/浏览器继续实时钟，生产限流逻辑及断言未改。专项 acceptance-6eyknc 重跑通过。保留首次失败证据，不称第一次完整运行全绿。
最终汇总：artifacts/trade-candidate/admin-settlement-verification.json；单元日志admin-settlement-units-final.log；界面截图acceptance-PbRwQs/admin-next/native-settlement.png，均为隔离虚构数据。

尚有完整开户/凭据管理和复杂产品档位等保留兼容入口；动态RBAC、跨市场主数据、独立PostgreSQL和Cloudflare运行时验证仍未完成。未提交、未部署、未生产迁移，原发布清单与dist不变。
