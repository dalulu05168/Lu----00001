# 交易一致性修复：本地候选

分支 fix/trade-consistency；基线 7362714a37f10dc2807b6d33674bccecd0231044。未提交，未部署。

## 范围与行为
- 普通订单与大宗交易保持原账户行锁、同连接事务；统一使用 BigInt 半入金额计算进行可用资金检查和实际扣款。
- 保留原报价有效期：普通执行价 60 秒、原参考路径 5 天。本批不把这些阈值认定为正式业务规则，也不改变手续费、订单类型、休市或结算方式。
- 两个客户成交入口传递报价证据，取得账户锁后、实际更新前重新验证时间；过期不扣款。
- 新订单在同一事务存储 request_intent 和 quote_evidence。幂等请求比较全部实际交易条件（市场、标的、方向、数量、限价，或产品、版本、确认价格）；密码不持久化。
- 账户锁内重复检查请求条件，防止并发相同键不同条件重放。
- 旧记录没有请求条件快照，不能捏造补齐：普通无附加条件订单沿用已有市场/标的/方向/数量重放；旧限价及大宗记录返回 409，须人工核对已有订单，不应引导客户换键直接重下。
- 报价记录包括源时间、当前有效期、价格、汇率、记录时间及来源标记；大宗记录包含参考价。普通提供器未给精确源标记时使用 EXECUTION_PROVIDER 分类，不宣称已记录原始行情响应或行情许可证。

## 文件
- cloudflare-release/src/worker.template.mjs.in
- cloudflare-release/src/products/service.js
- cloudflare-release/db/migration-trade-evidence.sql（只新增两个可空 jsonb 列，保留旧记录，已在隔离库首次与重复执行验证）
- cloudflare-release/qa/trade-consistency.test.cjs
- cloudflare-release/qa/trade-database.cjs
- cloudflare-release/qa/trade-offline.cjs
- cloudflare-release/scripts/build-trade-candidate.cjs
- cloudflare-release/scripts/test-trade-candidate.cjs

## 构建与安全
原 scripts/build.cjs 未修改、release-manifest.json 未修改、dist 未覆盖。原生产构建对新源码返回退出码 1，提示 Source differs from recorded production release；这是发布摘要守卫生效，不宣称生产构建成功。
单独候选编译复用原页面/模块拼接阶段，输出到 artifacts/trade-candidate，明确标记 UNPUBLISHED_DEVELOPMENT_CANDIDATE，不修改生产摘要、不调用发布脚本。
候选 SHA256：ef36772cae239a3ef40e1391d3726e8a1a5a338587f82e4022255ff5a5d778b0。
原 dist SHA256：0b8e258ffc21c8d20e5a92136fe6e84cdb5eaa640a013db074e798ff9efb4159。

## 实际验证
34 项单元测试通过、0 失败；7 个候选/工具文件语法检查通过。
7 组隔离验收全部退出码 0：trade-database、contracts、order-concurrency、write-receipts、browser-sessions、security、quote-guards。
trade-database 包含迁移重复执行、证据原子写入、限价冲突重放、事务内冲突、流水故障全回滚、锁等待报价过期及超持仓卖出拒绝共 7 项检查。
原并发组覆盖 12 次重复买入只写一次及竞争买卖；浏览器组覆盖 Cookie、CSRF、后台密码与 2FA 二次验证、限流与报价异常。
首次新增数据库组因隔离服务器连接数不足出现 ECONNRESET，修正仅测试调度连接配置后重跑通过；没有改变业务断言。
测试子进程剔除生产环境变量，fetch/socket/DNS 仅允许回环；浏览器默认阻断未被测试拦截的非回环请求。新闻请求被阻断，属于预期边界，不宣称生产新闻回归通过。
证据：cloudflare-release/artifacts/trade-candidate/verification.json、unit-tests.log、production-build-guard.log；artifacts/acceptance-QQESdO/results.json 与 artifacts/acceptance-dG69Bn/results.json。

复跑：
    node cloudflare-release/scripts/build-trade-candidate.cjs
    node --test cloudflare-release/qa/trade-consistency.test.cjs
    node cloudflare-release/scripts/test-trade-candidate.cjs
    node cloudflare-release/scripts/test-trade-candidate.cjs browser-sessions security quote-guards

## 尚未实施
- 生产迁移、部署、真实交易、生产数据核验均未执行。若未来发布，先审核增量迁移及版本/数据库兼容性，不能直接运行当前生产发布脚本。
- 数据库驱动事务仍需真实 PostgreSQL/Neon 分支及 Cloudflare 运行时验证；PGlite 不等于生产验证。
- 估值一致快照、客户中文权益披露、完整行情响应与规则版本、未确认的交易规则留待独立批次。
- 原有 docs/UNIFIED-DEVELOPMENT.md 和基础验证记录保持不变。


## 第二批：账户快照与权益披露（最新候选）
本节取代前文第一批的候选摘要与“尚未实施”中账户快照、中文披露两项状态。第一批测试记录保留为历史记录。

- getAccountSnapshot 在同连接事务中先取得账户 FOR SHARE 锁，再读取现金、持仓、订单、成本和冻结资金；按账户锁更新的现有账务路径不能在读取中途修改该账户。不是全库一致性快照，不涵盖绕过账户锁的外部手工写入。
- 采用 BEGIN/COMMIT/ROLLBACK，与后台镜像现有 savepoint 代理兼容；外部行情查询在快照事务结束后执行，不把行情网络等待包含在账户锁中。
- 历史成交价估值回退现在使用成交记录的 FX，并返回逐持仓 valuation 来源分类、估值时间（未知为 null）、币种和是否估算。报价有效期及成本规则未改变；完整估值策略仍需业务确认。
- 电脑前台增加持续页面说明，手机使用中文 API 披露及同文案 fallback：客户持有内部记账权益，无实际登记证券，不撮合、不向券商购买。管理员镜像复用手机说明。仅展示披露，未新增客户签署/确认记录。
- 本轮修改追加涉及 cloudflare-release/web/desktop.html、mobile-client/app.mjs，及快照实现与回归测试。
- 36 项离线测试通过，0 失败；最新候选对应 7 类隔离验收全部通过。数据库新增快照余额/持仓/订单及中文披露断言通过。
- 最新未发布候选 SHA256：ff2dc32730c3027f421574947877d60aa8d0d3b65b945f8e913a443af8cd776c。
- 新证据：artifacts/trade-candidate/verification-phase2.json、unit-tests-phase2.log、artifacts/acceptance-SMkz0J/results.json、artifacts/acceptance-dbu7uK/results.json。
- 原生产 dist、release-manifest.json、生产构建守卫保持不变。无提交、部署、生产迁移或真实资金操作。
- 尚待：真实 PostgreSQL/Cloudflare 运行时验证、跨连接并发读写专项压力测试、估值有效期正式规则、披露确认流程。不可把 PGlite 测试等同生产验收。


## 第三批：嵌套事务与镜像恢复验证
业务源码和候选摘要保持第二批状态，本批仅补测试及去除测试的生产依赖。
- 隔离数据库新增两项实际断言：快照 savepoint 不提交外层代客事务；快照读取故障回滚、释放连接后可继续读取。trade-database 共 10 项检查通过。
- 实际执行 trade-database、order-concurrency 与 mirror。mirror 首次因读取生产站 CSP 被外网守卫拒绝，保留失败记录；qa/mirror-operations.cjs 改为解析本地候选的 CSP 后，原业务断言全部重跑通过，未放宽外网保护。
- 镜像组验证子管理员买入、主管理员卖出、客户归属、资金限制、响应丢失后幂等恢复、审计失败回滚。镜像页面实际在浏览器执行。
- 测试日志改为时间戳命名，不覆盖前次日志；基线文档和基础证据保留。
- 证据：artifacts/acceptance-HDBF3q/results.json（含已解释的首次 mirror 失败）、artifacts/acceptance-k3c6Zv/results.json（修正后的 mirror 通过）、artifacts/trade-candidate/verification-phase3.json。
- 本机检查未发现 postgres、psql、pg_ctl、Docker 或 Podman；没有安装系统服务，没有读取生产连接信息。跨独立 PostgreSQL 会话的锁等待、并发快照压力及 Neon/Cloudflare 运行时验证仍为未执行，不将 PGlite 回归冒称该项完成。
- 当前候选 ff2dc32730c3027f421574947877d60aa8d0d3b65b945f8e913a443af8cd776c；生产清单和 dist 未变；无提交、生产迁移或部署。
