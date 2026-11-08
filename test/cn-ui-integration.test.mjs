import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = async path => readFile(new URL('../'+path, import.meta.url), 'utf8');

test('existing customer and administrator login forms remain available', async () => {
  const customer=await source('web/index.html');
  const admin=await source('web/admin.html');
  assert.match(customer,/id="authForm"/);
  assert.match(customer,/id="email"/);
  assert.match(customer,/id="password"/);
  assert.match(admin,/id="adminLoginForm"/);
  assert.match(admin,/id="adminOtp"/);
  assert.match(customer,/cn-entry-redirect\.mjs/);
  assert.match(admin,/cn-admin-entry-redirect\.mjs/);
});

test('new terminal keeps account dialogs and only displays after authenticated account fetch', async () => {
  const html=await source('web/cn-terminal.html');
  const js=await source('web/cn-terminal-bridge.mjs');
  for(const id of ['m-dep','m-id','m-bank','m-req','m-trade','m-ord']){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.match(html,/html:not\(\.cn-ready\) body\{visibility:hidden!important\}/);
  assert.match(html,/window\.CN_SYNC_ACCOUNT/);
  assert.match(js,/sessionStorage\.getItem\('gsp_token'\)/);
  assert.match(js,/fetch\('\/api\/account'/);
  assert.match(js,/Authorization:/);
});

test('admin console requires current 2FA authorization and renders only API-backed data',async()=>{
 const html=await source('web/cn-admin.html');
 const js=await source('web/cn-admin-bridge.mjs');
 assert.match(html,/id="adminVerifiedApp"/);
 assert.match(html,/id="clientsRows"/);
 assert.match(html,/id="subadminsRows"/);
 assert.match(html,/id="listingsRows"/);
 assert.match(html,/html:not\(\.cn-ready\) body\{visibility:hidden!important\}/);
 assert.doesNotMatch(html,/998937\.6|linyi05168@gmail\.com|4b6b2266|预览模式/);
 assert.match(js,/fetch\('\/api\/admin\/me'/);
 assert.match(js,/\['MASTER','SUBADMIN'\]/);
 assert.match(js,/location\.replace\('\/admin\.html'\)/);
 assert.match(js,/api\('clients'\)/);
 assert.match(js,/api\('subaccounts'\)/);
 assert.match(js,/api\('listings'\)/);
 assert.match(js,/textContent=/);
 assert.doesNotMatch(js,/innerHTML\s*=/);
});

test('US chart vendor remains present and includes AA and NEM', async () => {
  const chart=await source('web/stock-chart.mjs');
  assert.match(chart,/s3\.tradingview\.com/);
  assert.match(chart,/"US:AA": "NYSE:AA"/);
  assert.match(chart,/"US:NEM": "NYSE:NEM"/);
  const bridge=await source('web/cn-terminal-bridge.mjs');
  assert.match(bridge,/mountStockChart/);
});

test('unified N login gate preserves both real authentication forms', async () => {
  const customer=await source('web/index.html');
  const admin=await source('web/admin.html');
  const css=await source('web/cn-login.css');
  const clientRoute=await source('web/cn-entry-redirect.mjs');
  const adminRoute=await source('web/cn-admin-entry-redirect.mjs');
  assert.match(customer,/id="cn-entry-gate"/);
  assert.match(customer,/id="authForm"/);
  assert.match(admin,/id="adminLoginForm"/);
  assert.match(admin,/id="adminOtp"/);
  assert.doesNotMatch(admin,/管理员使用独立的双因素验证；客户会话不具备后台权限。/);
  assert.match(customer,/cn-login\.css/);
  assert.match(admin,/cn-login\.css/);
  assert.match(css,/cn-n-slow-orbit/);
  assert.match(css,/20s linear infinite/);
  assert.match(css,/radial-gradient\(circle/);
  assert.match(clientRoute,/location\.replace\('\/cn-terminal\.html'\)/);
  assert.match(adminRoute,/location\.replace\('\/cn-admin\.html'\)/);
  assert.match(clientRoute,/slot\.appendChild\(accountFormHost\)/);
});

test('mobile terminal initializes with empty account data and cannot fake financial submissions',async()=>{
  const html=await source('web/cn-terminal.html');
  assert.doesNotMatch(html,/cashOverride:998937|acct:'4b6b2266'|orders:\[\{s:'AA'/);
  assert.match(html,/cashOverride:null/);
  assert.match(html,/watch:\[\],fav:\[\],catalog:\[\],watchLoaded:false,watchStatus:'自选尚未同步',orders:\[\],holds:\[\],reqs:\[\],chat:\[\]/);
   assert.match(html,/window\.CN_SYNC_WATCHLIST/);
   assert.match(html,/window\.CN_SYNC_CATALOG/);
  assert.match(html,/if\(!Number\.isSafeInteger\(a\.cashCents\)\|\|a\.cashCents<0\)throw/);
  assert.match(html,/return \{s:key,q:Number\(p\.quantity\),c:null\}/);
  assert.match(html,/充值与提现服务暂不可用/);
  assert.match(html,/身份资料提交服务暂不可用/);
  assert.match(html,/银行卡绑定服务暂不可用/);
  assert.match(html,/客服消息服务暂不可用/);
  assert.doesNotMatch(html,/DATA\.reqs\.unshift|DATA\.chat\.push/);
  assert.match(html,/html:not\(\.cn-ready\) body\{visibility:hidden!important\}/);
});

test('mobile stock chart never fabricates OHLC or volume before licensing',async()=>{
 const html=await source('web/cn-terminal.html');
 assert.match(html,/ctx\.fillText\('授权行情尚未接入'/);
 assert.match(html,/行情数据暂不可用/);
 assert.doesNotMatch(html,/mkDaily\(|Math\.random\(|function bridge\(|function ser\(\)/);
 assert.doesNotMatch(html,/1D · Cboe One/);
});
