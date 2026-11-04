# 完整前后台上线记录

2026-11-04。用户已明确授权五表迁移及完整部署，随后完成Neon控制台登录。

## 已执行

- 目标：Neon项目bitter-heart-61838251，分支br-shy-poetry-b3kzsxug（qa-app-mirror-20261103），数据库neondb、运行角色neondb_owner。已由Render实际端点匹配，未修改main或其他项目。
- 备份：qa-full-release-backup-20261104（br-rough-hall-b32z79az），已确认ready，保留无compute分支；未执行恢复或重置。
- 控制台只读核对：原迁移记录11条（001至010，含两个003），public表22张，011五表均不存在。
- 在Neon SQL编辑器中执行版本文件011的建表内容，并在同一事务记录schema_migrations；加入5秒锁超时、30秒语句超时和与应用迁移相同键的事务咨询锁。控制台返回24条语句执行成功，包括COMMIT。没有导出连接凭据。
- 迁移后五表行安全均开启，角色权限查询通过；011标记恰好1条。迁移前后用户4、账户4、订单0、cash_ledger 0、账户现金合计0一致。未执行现有业务数据UPDATE/DELETE，未新增测试客户或证券。
- 推送完整分支提交4c1f5a46d3ed394d5627eba5935d63ed834cce8a到dev/restore-four-role-platform-20261103，非force push。
- GitHub Actions 41833121941完成success；此前本地全量真实PostgreSQL验证146通过、0失败、17外站检查跳过，专项24项全部通过，构建成功。
- Render服务srv-dbkkglugekts73edpmd0部署dep-dblilop7lnhs739piu6g，26.6秒，已核实Live提交4c1f5a4。未改域名、方案、连接字符串或启动命令。

## 线上只读结果

https://nuvexapro.com/api/health、/api/ready、/api/reference-fx均200；数据库connected。汇率日期2026-11-03。

未登录的/api/catalog、/api/admin/listings、/api/account/analytics、/api/support、/api/commodities均401。静态app.mjs包含完整统计、客服及汇率逻辑。

后台https://nuvexapro.com/admin.html可正常显示CN Capital主/子管理员登录页；已打开供用户登录。尚未获得应用管理员登录会话，因此不能把发布成功与未登录接口检查称作“线上上票/看板全部操作验收通过”。用户登录后只读核对目录、看板、客户及权限；真实发布或业务写入另按用户边界执行。

股票授权报价、真实交易/支付、外部核验、股息入账、风险模型仍未接通。看板基于有条数上限的列表，并非无限量全库总计。具体限制见function-status-2026-11-04.md。

证据截图位于本checkout根目录migration-tables-verified.png、full-release-live.png。原function-status及checklist中的阻碍描述为此前阶段记录，本上线记录为当前实际状态。

## 复测

本地运行npm test；PostgreSQL集成需全新独立测试库，不能用线上库运行合成数据测试。部署后继续只读验证health/ready；登录页验收使用用户提供的正常会话，不提取或保存密码/token。

## 后续线上主账号只读验收

用户完成管理员登录后，已通过真实浏览器核验：

- 概览：客户2、子管理员1、证券1；页面显示券商未接入，截图admin-dashboard-live.png。
- 上票管理：读取已发布US:NEM（Newmont Corporation），客户目录可见标记；刷新成功，已发布资料编辑按钮禁用，须先撤回。仅观察保存/撤回入口，没有提交，截图admin-listings-live.png。
- 资金看板：充值申请2、提现0、待处理1、审核通过未划转1，列表与分类统计一致；没有批准或变更申请。
- 客户管理：2/2列表及选中客户基本资料、所属子账号、策略版本1正常读取；VIP、登录/提现/贷款权限和历史变更可见，未保存。
- APP镜像：所选客户账户快照读取成功，余额0、持仓0、订单0、自选0，管理权限侧栏加载。正常访问会自动产生访问审计，这是该只读功能的既有审计行为，不是业务数据修改。没有改余额、客户策略或申请状态。
- 子管理员：读取1个子管理员及邀请码使用统计；未创建、修改、禁用或复制凭据。
- 商品模块：成功同步0条，不是缺表错误；未创建商品。
- 客服模块：当前权限0会话，空状态正常；未发送消息。
- 审计：镜像访问历史7条、统一操作历史16条在打开新镜像前正常读取。没有修改既有记录。

以上为主管理员线上读取验收，不扩大为全部写入、子管理员真实登录或前台客户真实登录验收。上票发布/撤回写入、角色拒绝及前后台完整闭环已有本地专项/数据库证据，本轮没有为了测试改写线上证券或客户数据。未导出应用密码或token。
