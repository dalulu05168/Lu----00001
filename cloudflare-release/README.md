本目录保存 CN Capital 当前 Cloudflare 发布代码。正式服务为 lu----00001，客户入口为 https://nuvexapro.com/，后台入口为 https://admin.maacropierce.com/。客户入口按设备返回桌面或手机页面。

src/worker.template.mjs.in 包含实际运行的 API、权限、路由和打包后的驱动代码。web 保存三端页面、登录页和 Logo。db 保存建库及补充迁移。runtime-bindings.json 记录运行时与绑定名称。records 保存隔离验收结果及账务快照。

使用 Node.js 22 以上版本，在本目录执行以下命令。

~~~powershell
npm ci
npm run build
npm test
~~~

build 会校验生成的 dist/worker.mjs 与 release-manifest.json 中的 SHA-256 相同。修改代码后需同步维护发布清单中的文件摘要。

浏览器验收使用本机 Chrome。默认路径为 C:/Program Files/Google/Chrome/Application/chrome.exe，可以通过 CN_CHROME_PATH 指定其他已安装的 Chrome。手机使用 Chrome 的 iPhone 13 视口。测试需要联网读取正式页面，业务 API 写入转到本机 PGlite 隔离库。隔离服务监听 127.0.0.1，端口范围为 8891 至 8899 和 15491 至 15499。数据库、日志与输出保存在 artifacts。已通过的可交接记录保存在 records。

可单独运行一组测试。

~~~powershell
npm test -- sessions
npm test -- forms access
~~~

九组验收覆盖产品结算、客户权限与客服、注册、股票买卖、三端交互、登录与密码找回、商品 ETF 参考价回放、客户资料与出入金表单、子账户后台访问控制。

普通美股买卖在隔离库使用固定买卖价格验证。商品 ETF 使用保存的报价样本及冻结的验证时钟回放。实际报价核查结果与原始时间见 records/provider-reference-check.json。后续正式成交报价需验证 AAPL、NVDA、SPY 的标的映射、买卖价格与时间戳，再启用生产价格解析。

已有 Cloudflare Worker 的发布使用 scripts/publish-existing.cjs。该脚本核对现有生产版本，上传代码时使用 keep_assets 和 keep_bindings，并验证绑定类型、名称和运行时匹配。需要设置 CLOUDFLARE_ACCOUNT_ID 和 CLOUDFLARE_API_TOKEN，令牌须具备该 Worker 的读取与版本上传权限。

~~~powershell
node scripts/publish-existing.cjs
~~~

上传结果写入 artifacts/publication.json。核对该文件的 version，再执行以下命令，其中 VERSION 为实际上传版本。

~~~powershell
npx wrangler versions deploy VERSION@100% --name lu----00001 --yes
node scripts/publish-existing.cjs verify
~~~

verify 会核对实际流量版本、两域名、Logo 内容摘要和数据库就绪状态。回滚时使用 versions deploy 命令，将 release-manifest.json 的 baseVersion 指定为 100% 流量。

数据库升级应核对目标项目、分支和已有表结构后执行。当前生产库已经应用 migration-admin-audit.sql。该迁移增加审计表与索引。新数据库初始化时先执行数字编号迁移，再执行 migration 开头的补充迁移，最后依次执行 product-settlement-schema.sql、product-settlement-workflows.sql、commodity-reference-order-prices.sql。部分产品迁移是一次性初始化脚本，应先检查已有表。

恢复到新 Worker 时，使用 wrangler.jsonc 中的静态资源与运行时设置，并按 runtime-bindings.json 配置对应绑定。生产凭据由 Cloudflare 和 Neon 管理。该目录保存代码、配置结构和隔离验收数据。
