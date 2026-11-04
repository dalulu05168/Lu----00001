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
