# 并发订单及隔离备份恢复验收

生产保持5a210001-825b-4744-bd7f-ee9a626acf65，未增加业务补丁或改动客户数据，因此本轮没有重复发布相同构建。

## 已执行

`node scripts/acceptance.cjs order-concurrency` 对当前已发布构建建立独立假账户、完成身份/银行卡审核和双阶段充值审批后：

- 同一幂等键并发12次买入：1次201创建，其余200重放，订单ID一致。
- 四个不同键竞争买入：资金仅容许一笔，恰好一笔成功。
- 四个不同键竞争卖出：持仓仅容许一笔，恰好一笔成功。
- 最终3笔成交、11股持仓、余额86386美分；没有负余额或负持仓。

`node qa/backup-recovery.cjs artifacts/acceptance-InOHOT/order-concurrency`：对已关闭的本地假账户库创建PGlite备份，加载至全新实例。39张公共表逐表按行排序哈希相同，428条约束和1个序列相同；直接读取恢复库确认4条资金流水合计86386美分，与余额一致，持仓11股。

证据：concurrency-acceptance.json、isolated-recovery-acceptance.json；原始假数据与二进制备份仅保留在被Git忽略的artifacts目录。移动端16项单元测试通过。

## 验收边界

这是本机PGlite隔离环境的事务逻辑、幂等和恢复验证；测试代理单连接，不代表生产PostgreSQL多连接压力、容量、延迟或生产Neon备份恢复通过。正式生产恢复演练仍未执行。

## 子域名阻塞

已登录Cloudflare页面被识别为当前内部浏览器标签页，但getTab仍明确返回Local browser use is disabled in Work settings。Cloudflare现有OAuth能列Worker域名、发布版本，DNS记录读取403。未绕过访问限制，也未覆盖未知记录。m.nuvexapro.com迁移未完成。

迁移前需获得当前会话的浏览器控制或最小DNS读取/编辑权限，读取并备份m记录；核对目标Worker现有主域名和后台绑定；迁移后检查TLS、页面与API路由，保留原Vercel部署供回退。官方约束参考：https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ 。
