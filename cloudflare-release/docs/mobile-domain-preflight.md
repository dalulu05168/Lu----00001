# 手机子域名迁移前置检查

最新只读结果见mobile-domain-audit.json：m.nuvexapro.com仍指向c824af4759146db2.vercel-dns-017.com，访问返回Vercel；lu----00001仅绑定nuvexapro.com和admin.maacropierce.com。Worker管理API可读，DNS记录管理API403。内部浏览器工具仍显示禁用。未变更DNS。

授权范围：新令牌限定nuvexapro.com，Zone / DNS / Edit，以及Zone / Zone / Read。无需全账户、全域名或Global API Key。创建流程参考 https://developers.cloudflare.com/fundamentals/api/get-started/create-token/ 。令牌不得写入仓库或命令参数，只以进程环境变量CLOUDFLARE_DNS_API_TOKEN提供。

只读预检：node scripts/domain-preflight.cjs。脚本固定zone和m主机名，要求唯一CNAME且目标仍等于已核实的Vercel记录；任何变动立即停止。结果保存artifacts/domain-audit/m-dns-before.json，现有备份不覆盖。

后续迁移步骤（本轮未执行）：
1. 读取并备份m DNS及现有Worker域名和运行资源。
2. 仅处理m与现有CNAME冲突；把m绑定到既有lu----00001，保留主域名、后台、Vercel原部署及全部资源。
3. 检查TLS、手机HTML、API访问保护、主域名/后台不变。
4. 若验证失败，撤回新增m绑定，按备份恢复原CNAME各字段；重新验证原入口。没有DNS读写权限前不开始变更，以免无法回退。

预检脚本未取得DNS授权，当前仅通过语法检查，不能称迁移或回退已通过。
