# 客户页面文案整改：验证证据

分支 `frontend/claude-customer-copy-20261113`，基线 `release-candidate/nuvexa-20261112@f0e63b6`（Worker SHA-256 `bb4c87a5…`）。整改后开发构建 SHA-256 `643e0656615fc034fe7989529c22dbe4d911edb1cf0a87ffae16fa4f17ed7cd6`。未部署，未接触生产库。

## 改动范围

只改客户电脑端和手机端的可见文案与提交前披露。没有新做前台，没有改动设计系统、Logo、字体、样式文件、布局、Worker、数据库、资金、订单、持仓、会话和接口契约。

| 文件 | 内容 |
|---|---|
| `cloudflare-release/web/desktop.html` | 订单预览加「交易与权益说明」；确认勾选文案；「成交单价」改「平台执行单价」；页脚说明精简；IPO／基金弹窗的披露块及其样式 |
| `cloudflare-release/web/products-ui.js` | 大宗买卖弹窗、期限基金认购弹窗加披露 |
| `mobile-client/app.mjs` | 去掉 API 路径、「隔离」「接口」「服务端」等开发语言；保留报价时间、报价来源、延迟与估值依据提示；页脚说明精简 |
| `mobile-client/business.mjs` | 卖出、大宗买卖、期限基金认购前加披露；卖出回执补「平台内部执行，未向券商下单」 |
| `mobile-client/ipo.mjs`、`mutual-funds.mjs` | IPO 申购、基金申购赎回前加披露；去掉「后台」「服务端」措辞 |
| `cloudflare-release/qa/customer-copy.cjs` | 新增验收套件，断言每个提交点的披露在提交前可见，且客户页面无开发语言 |
| `cloudflare-release/scripts/acceptance-release.cjs` | 仅登记新套件 |

Logo：`web/logo.png` 与基线、线上 `nuvexapro.com/logo.png` 的 SHA-256 前 16 位均为 `4da4c8b3ce9a6315`，未改动。

## 测试结果

- 单元测试 48/48 通过（`ops` 与 `qa` 22 项，`mobile-client` 26 项）。
- 隔离验收：原有 32 套中 31 套退出码 0，`trade-database` 仍为既有的不适用（`cnOrderIntent` 未定义），与基线一致，不计为通过。以上是整改后构建 643e0656 的结果，与基线相比没有新增失败。
- 新套件 `customer-copy`：整改后退出码 0。
- 负向对照：同一套断言对整改前的旧包运行，退出码 1（缺少「平台内部记账权益」说明），证明断言确实在检测这次改动。

## 截图

`docs/customer-copy-20261113/before` 为整改前（旧包，基线模式只截图不断言），`after` 为整改后。电脑 1440×900、手机 iPhone 13，均整页截图。截图里的底部导航条悬浮在页面中部，是整页截图的固定定位副产物，整改前后相同。

| 场景 | 文件 |
|---|---|
| 电脑：股票卖出订单预览 | `desktop-sell-preview.png` |
| 电脑：IPO 与普通基金 | `desktop-ipo-fund-dialog.png` |
| 电脑：大宗买入 | `desktop-bulk-buy-dialog.png` |
| 电脑：期限基金认购 | `desktop-term-fund-dialog.png` |
| 手机：首页／行情／个股详情 | `mobile-home.png`、`mobile-market.png`、`mobile-detail.png` |
| 手机：卖出、IPO、基金、大宗买入、期限基金 | `mobile-sell.png`、`mobile-ipo.png`、`mobile-mutual-fund.png`、`mobile-bulk-buy.png`、`mobile-term-fund.png` |

## 测试环境说明

隔离验收环境不提供 `/logo.png`。截图脚本从 `web/logo.png` 供给 Logo，所以截图中的 Logo 与线上一致。

## 业务审核

文案是草案，需要业务／合规逐条确认，见 `customer-copy-review-20261113.md`。
