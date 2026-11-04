# 前后台功能核验状态

日期2026-11-04。用户已明确授权：核对数据库及备份、新增011迁移五表、部署完整版本；不修改现有业务数据。该授权无需再次重复请求。

## 代码及本地证据

完整发布分支codex/full-release-20261104（8b8e488）已通过完整合成PostgreSQL验证：163项，146通过、0失败、17外站检查跳过；4项数据库集成运行。此前真实本机浏览器记录保存在browser-validation-2026-11-04.md和client-api-chart-validation.md，不能代替线上验收。

本轮再次执行listings-management、client-api-wiring、admin-session-isolation、account-analytics-ui：24项全部通过，无跳过，日志function-verification.log。

| 功能 | 实际链路及限制 | 当前证据 |
|---|---|---|
| 后台上票 | MASTER创建/编辑草稿、发布/撤回；SUBADMIN不可发布；客户GET /api/catalog只读PUBLISHED | 专项HTTP/DOM测试；完整真实数据库测试包含发布证券并从客户目录读回 |
| 看板客户/子管理员/证券数 | 登录后读取对应目录并计算已返回items.length，按权限限制 | 代码核对；非独立全库聚合接口，客户最多500、证券最多300 |
| 资金看板 | 从资金申请列表计算充值、提现、待处理及已批准条数 | 列表最多300，显示最近100；非支付流水/到账总金额，不代表银行已到账 |
| 前后台业务联动 | 同一API与数据库读取目录、申请状态、客服消息及商品 | 本地真实数据库、DOM及历史浏览器验收 |
| 客户与子管理员权限 | 归属隔离、会话撤销、政策/权限控制，迟到响应不串号 | 完整数据库及专项DOM检查 |
| APP管理镜像 | 账户数据库视图和授权操作，不是手机远程屏幕 | 本地测试及历史浏览器证据 |
| 账户统计 | 全历史内部账本FIFO已实现毛盈亏；无持仓报价时不显示市值 | 真实数据库及DOM验证；非券商收益证明 |
| 股票报价、估值、股息/风险 | 无已授权报价供应商及真实股息入账/风险模型 | 尚未接通，不得宣称所有页面功能正常 |

## 发布推进与实际阻碍

- 线上Render服务srv-dbkkglugekts73edpmd0当前Live仍为c9a4532（汇率更新版）；完整分支未推送。
- 已从Render环境页面只读匹配数据库端点ep-blue-bar-b3eby9ud到Neon项目bitter-heart-61838251的qa-app-mirror-20261103（br-shy-poetry-b3kzsxug），不涉及main或另一nuvexa项目。
- 已建立无compute的迁移前备份分支qa-full-release-backup-20261104（br-rough-hall-b32z79az），parent LSN 0/1FC3E68。创建返回init，后续应确认ready后再迁移。未变更线上连接字符串。
- Neon管理工具可列项目/分支/端点，但run_sql返回401 supplied credentials do not pass authentication。未获得现有迁移及表状态，未执行SQL写入。
- Render免费实例无Shell/SSH；未升级或付费。
- 自动审批拒绝把完整数据库URL保存至本机.env.migration，理由为明文凭据泄露/残留风险。已停止此路径；本机检查确认文件不存在。不得通过其他文件或间接方式绕过拒绝。
- 更安全替代为在Neon控制台内核查和迁移；控制台目前需要用户登录，已打开并请求用户自行登录，不要求聊天提供密码。用户登录后继续授权流程，不再索要相同部署授权。

后续必须先核对目标库、迁移001–010及011状态、备份ready，再仅应用确认的011迁移并标记历史；完整发布按照full-release-checklist-2026-11-04.md执行。线上功能验收需授权测试账号，不更改真实资金或客户资料。
