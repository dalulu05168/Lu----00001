import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const client=readFileSync(new URL("../web/index.html",import.meta.url),"utf8");
const admin=readFileSync(new URL("../web/admin.html",import.meta.url),"utf8");
test("client and admin screens use concise product labels rather than internal documentation",()=>{
  for(const phrase of [
    "非市值权重","本平台仅记录账户活动","不向券商或交易所",
    "授权行情未接入前","Account activity · 内部账户记录",
    "平台记录不代表券商成交或结算",
    "全量管理员行为审计和资金风险报表尚未接入",
    "不会同步手机屏幕","不是客户设备的实时画面或券商持仓"
  ])assert.equal((client+admin).includes(phrase),false,phrase);
  assert.match(admin,/账户数据快照/);
   assert.match(admin,/id="mirrorPolicyForm"/);
   assert.match(admin,/id="mirrorReviewForm"/);
  assert.match(client,/查看可购买产品/);
  assert.match(client,/CN Capital/);
  assert.match(admin,/CN Capital/);
});
