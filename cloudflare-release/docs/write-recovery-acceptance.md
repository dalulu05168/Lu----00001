# 资金申请与客服重试保护验收

本阶段为本地候选修复，未上线，未修改生产客户数据。

## 实现

- `db/migration-write-idempotency.sql` 增加客户、接口、请求键联合唯一的提交回执表。
- `src/worker.template.mjs.in` 在业务事务中取得回执锁，完成写入后一起提交；同键同内容返回原结果，同键不同内容返回 409。失败业务事务不留下成功回执。
- 回执不保存登录密码、提款密码或交易密码。回执正文包含业务金额、备注或客服消息，受数据库访问权限保护，不能作为公开日志导出。
- 桌面资金与客服、手机资金与客服发送请求键。网络失败保留恢复记录，明确失败清理记录；浏览器恢复记录只保存摘要和请求键。
- App 镜像沿用服务器归属校验与审计，并允许上述恢复路径。
- 更新表单和权限验收以操作新版手机界面，移除依赖旧版手机选择器的测试路径。
- 清理手机业务表单开发文案、桌面客服“仅当前页面显示”的错误说明。

## 已通过

候选 Worker SHA256：`b0894289ce933e19b6ace762d3ff5a81f5aa3cc83fabbc2f850e5bf6b6a3172d`。

1. `/api/requests`、`/api/support` 各并发提交六次同一请求，只返回一个业务 ID；重放返回原 ID，内容冲突 409，过短请求键 400。
2. 回执查询按客户隔离，同键不同客户互不影响；余额不足提现回滚回执，修正申请可重新提交。
3. Chrome 桌面页面实际点击提交，后台成功后故意丢失响应，再次点击恢复原充值及原客服消息，不重复写入。
4. 新版手机身份/银行卡实际上传，待审和已通过禁止再次上传；充值不提供提款密码仍成功；错误提款密码、余额不足均拒绝；总账户重复审批后现金仍准确为 400 USD。
5. 客户归属、资料审核、客户控制、会话撤销、资金审批权限、客服只到总账户、子账户拒绝客服与资金操作的接口和浏览器回归通过。
6. 35 类受保护接口匿名拒绝与管理员方法校验通过；手机单元测试 16 项通过。

原始本机证据（不纳入 Git，避免提交隔离数据库与会话凭证）：

- `artifacts/acceptance-gqphVY/results.json`：forms、permissions、contracts 全部退出码 0，构建未变化。
- `artifacts/acceptance-UnjaAr/results.json`：write-receipts 退出码 0，构建未变化。
- `../../integration-tools/evidence/run-i6hB01/write-recovery-browser.json`：手机客服/资金在响应丢失、刷新登录后恢复原结果；此记录对应本阶段较早构建，不冒充最终构建完整回归。

## 复现

安装项目原有 QA 依赖后，从源码仓库运行：

```powershell
node cloudflare-release/scripts/build.cjs
node --test mobile-client/adapter.test.mjs mobile-client/experience.test.mjs
node cloudflare-release/scripts/acceptance.cjs write-receipts forms permissions contracts
```

测试自动创建本机隔离库，不能设置为生产连接。

## 发布前边界

生产尚未应用此迁移，禁止只发 Worker 而遗漏回执表。应先核对生产结构、迁移和备份，再按授权发布流程执行。兼容旧客户端无请求键的写入，但它们没有此次同键重试保证。总账户客服回复、旧独立移动站点不因此自动获得完整恢复能力。未完成全量接口、物理真机、生产回归与整体交付验收。

## 扩展回归修复

发现新版手机缺少原有普通基金净值申购赎回入口，已增加 mutual-funds.mjs，复用 /api/product-settlement、既有净值复核、幂等、余额与份额规则。期限基金与净值基金保持区分。手机实际申购 12.50 USD、赎回 0.5 份及 1 份后，与预设链路合计现金 85,250 分、剩余基金 7 份一致；订单和持仓保留。刷新后的旧 token 服务端校验为 401，手机退出和一次性找回密码、自选重新登录回显已实测通过。

最终同一构建九组回归（products/forms/permissions/contracts/write-receipts/sessions/stocks/registration/mirror）全部通过，证据 artifacts/acceptance-zqBmv4/results.json。新版手机独立注册入口追加实测见 artifacts/acceptance-GNEwOx/results.json；16 项单元测试通过。可提交的无凭证结果摘要见 acceptance-write-recovery-summary.json。
