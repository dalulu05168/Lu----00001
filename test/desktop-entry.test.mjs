import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const file = name => readFile(new URL('../'+name,import.meta.url),'utf8');
test('desktop is independent from mobile entry and retains backend auth',async()=>{const d=await file('web/desktop.html'),m=await file('web/cn-terminal.html'),b=await file('web/desktop-bridge.mjs'),r=await file('web/cn-entry-redirect.mjs');assert.match(d,/NUVEXA PRO · 桌面客户终端/);assert.match(d,/desktop-bridge\.mjs/);assert.match(m,/cn-terminal-bridge\.mjs/);assert.match(b,/fetch\('\/api\/account'/);assert.match(b,/Authorization:/);assert.match(r,/location\.replace\('\/desktop\.html'\)/);assert.match(r,/location\.replace\('\/cn-terminal\.html'\)/)});
test('static preview is read-only with no authentication fetch',async()=>{
  const page=await file('web/desktop.html'),bridge=await file('web/desktop-bridge.mjs');
  assert.match(page,/IS_READONLY_PREVIEW/);
  assert.match(page,/desktop-public-preview/);
  assert.match(page,/acct:'未登录'/);
  assert.match(bridge,/if \(readOnlyPreview\)/);
  assert.match(bridge,/control\.disabled = true/);
  assert.match(bridge,/\} else \{\s*run\(\);/);
});
test('desktop data is authenticated, no fabricated quote or balance',async()=>{const d=await file('web/desktop.html');assert.match(d,/window\.CN_SYNC_ACCOUNT/);assert.match(d,/Number\.isSafeInteger\(a\.cashCents\)/);assert.match(d,/synthetic OHLC/);assert.doesNotMatch(d,/DATA\.reqs\.unshift\(/);assert.match(d,/h\.c!=null/);assert.match(d,/申请接口尚未接入，未提交任何充值或提现请求/);assert.doesNotMatch(d,/998937\.60|function mkDaily\(|2026-11-04 · 1 USD/);});

test('read-only preview does not misrepresent disconnected account as zero activity',async()=>{
 const d=await file('web/desktop.html');
 assert.match(d,/nord:'—',nhold:'—',nreq:'—'/);
 assert.match(d,/账户交易数据未连接/);
 assert.match(d,/账户持仓数据未连接/);
 assert.match(d,/申请记录接口未连接/);
 assert.match(d,/桌面端布局|电脑端布局/);
 assert.match(d,/desktop-orders-summary/);
 assert.match(d,/\.desktop-preview-notice\{display:flex;flex:none/);
 assert.doesNotMatch(d,/\.desktop-preview-notice\{[^}]*position:fixed/);
 assert.match(d,/if\(!IS_READONLY_PREVIEW\)\{\['pointerdown'/);
});
