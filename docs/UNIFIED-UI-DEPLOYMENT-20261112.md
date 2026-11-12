# 前后台合并发布记录 — 2026-11-12

已上线版本：860bea19-546f-4900-aa23-7f37827d0fdd，生产流量100%。上一版本733317be-cdfd-4057-ad6b-afc1c68fa71e保留用于回滚。

本次合并后台公共底部说明删除、页面淡出淡入和已验证的电脑/手机前台同步。客户权益披露保留为中文。后台手机镜像复用更新后的移动页面。已逐页校验组合来源；后端代码与原线上版本完全一致，没有执行数据库迁移或生产资金/交易测试。

发布包：cloudflare-release/artifacts/unified-ui-release-1RWOVS/worker.mjs。
SHA256：d055098d474f651d9085b81d66787f45e542d387f97d35f60b78cc0a1e43d8d0。

发布前同包3套验证通过：前后台联动、72项后台布局/38项账户权限检查（含动画、连续切换和减少动态效果）、匿名接口保护。证据 acceptance-khZwqR。

上线后对同一发布包在隔离环境执行7套，7通过、0失败。其中6套专项为frontend-sync、stocks、order-concurrency、write-receipts、quote-guards、forms，另加admin-next后台业务回归。12项联动检查全部通过，覆盖提现预留、初审不扣账面、终审扣款、驳回释放、实际内部成交后的余额/持仓同步、账户接口503失败提示和恢复、公告、产品、客服及会话撤销。证据 acceptance-DWXDNZ。不能把这些隔离写入描述为生产资金验证。

生产只读验证：前后台/ready均200且database=connected；后台匿名/api/admin/me为401；客户域名管理接口404；两端匿名/api/account均401；后台/admin、/admin-next和兼容页200，页面摘要与候选一致。绑定、域名、运行配置及资产保留。

新闻接口已在线只读验证：/api/news返回200、public,max-age=60、FinVibe来源12条。此项仅证明该时点接口响应正常，未把新闻客户端全流程、外部图表或物理手机验收描述为完成。IBKR准备包仍未连接。

发布与回滚程序、publication.json、online-readonly.json、final-verification.json位于同一发布包目录。未修改历史发布摘要清单。scripts/build-frontend-sync.cjs默认基线更新为本次已发布包，仍支持显式指定已验证的基线目录，避免后续构建带回旧后台。

待继续事项：真实外部图表显示、新闻客户端交互和物理手机会话验证；当前没有相关完成证据。
