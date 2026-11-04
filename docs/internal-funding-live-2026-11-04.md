# 012迁移和内部资金审批发布验收

## 已执行

- 用户本轮明确批准012迁移和本批部署。
- Neon项目 bitter-heart-61838251，QA分支 br-shy-poetry-b3kzsxug / qa-app-mirror-20261103，neondb / neondb_owner；没有更改主分支。
- 通过已登录Neon SQL控制台执行仓库012迁移原文的事务主体，同事务写入 schema_migrations。额外使用 advisory transaction lock 871204、5秒锁等待和30秒语句超时。
- 控制台9条语句全部成功，包括3条ALTER、1条迁移标记INSERT、COMMIT。迁移标记1条、cash_ledger_single_source约束存在。
- 前后核对均为 users=4、accounts=4、orders=0、ledger=0、cash_total=0、funding_count=2；迁移后 INTERNAL_POSTED=0。没有自动回填历史审批、修改余额、审批真实申请或提交测试订单。
- 既有备份分支 br-rough-hall-b32z79az 状态ready，父分支仍为QA。

## 首次功能发布

- 910c3fb332022d13bb7df6f12af2c64b52212f06。
- Render服务 srv-dbkkglugekts73edpmd0 / global-stock-qa-preview。
- 部署 dep-dblnur5g1s2s73d6i580，控制台显示 Deploy succeeded | Live，耗时29.8秒。
- GitHub检查41891612171最终success。
- /api/health: alive，brokerConnected=false，pricingConnected=false；/api/ready: ready、database=connected。

## 线上只读核验

- 管理员重新通过已保存登录会话登录，页面使用单一“全局运营总览”标题。
- 资金概览2笔充值申请合计$20,000、提现0、待处理1、通过1；旧通过申请仍为未划转，内部已记账0。
- 近期资金申请明细读到两笔各$10,000申请，与已有记录一致。该金额为申请汇总，不是账户余额。
- 点击客户业务分组标题只收起该组，其他导航组和品牌仍显示。
- 打开待处理资金申请，默认选项“同意并完成平台内部入账”；理由框DOM required=false、minLength=0。不勾选确认，不点击保存。
- 前台刷新后正常读取账户和4条旧申请，现金余额仍0；四个市场比例框均显示“暂无持仓”；ECB参考数据日期已更新为2026-11-04。
- 线上截图 internal-funding-live-dashboard.png，不再使用本地合成数据作为上线证据。

## 验收中发现并修正

- APP镜像仍有“仅修改审核状态”的旧提示，103054e改为资金同意将更新内部余额。
- 窄屏旧样式隐藏分组标题，c3cfa6d恢复标题并让导航换行，保留各组展开收起。
- 旧测试要求“审核不执行资金划转”原文，阻止上述修正版部署；bc60b4f将断言更新为明确内部记账、不执行银行付款。本地完整测试147通过、22跳过、0失败；数据库事务完整测试此前152通过、17跳过、0失败。
- 最终修正版线上状态须在下方追加，不得仅凭推送当作完成。

## 仍未完成

股票、基金、IPO内部购买流程、内部价格配置、身份证正反面安全上传、完整银行卡加密绑定不在此次已完成范围。当前订单入口仍关闭，不能宣称资金入账之后已经可以购买。

## 最终发布确认

- 最终提交 bc60b4f6d0cc2bc8fe341050ced7159433398cce；GitHub运行41892707680完成success。
- Render部署 dep-dblo220473hc73bpe7pg，详情页显示 Deploy succeeded|Live，日志记录2026-11-04 21:02:00 GMT+2服务已上线。
- 前台实际窄屏读取3个分组summary均为display:block；点击研究与数据分组后仅该组open=false，另外两组仍open=true。保存 client-navigation-live-mobile.png。
- 最终后台刷新后标题为“全局运营总览”，未提交真实审批或其他业务写入。
- 操作结束恢复临时视口尺寸，关闭Neon和Render工作标签，保留前台与后台标签。
- internal-funding-live-dashboard.png为首次功能版上线后的实际业务数据截图；最终版只追加审批提示和窄屏导航修正。未将失败的最终全页截图宣称为已保存。
