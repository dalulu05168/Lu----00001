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

test('admin redesign requires current admin authorization and keeps system management fallback', async () => {
  const html=await source('web/cn-admin.html');
  const js=await source('web/cn-admin-bridge.mjs');
  assert.match(html,/id="mirror"/);
  assert.match(js,/fetch\('\/api\/admin\/me'/);
  assert.match(js,/\['MASTER','SUBADMIN'\]/);
  assert.match(js,/\/admin\.html\?legacy=1/);
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
