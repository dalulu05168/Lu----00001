import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const file = name => readFile(new URL('../'+name,import.meta.url),'utf8');
test('desktop is independent from mobile entry and retains backend auth',async()=>{const d=await file('web/desktop.html'),m=await file('web/cn-terminal.html'),b=await file('web/desktop-bridge.mjs'),r=await file('web/cn-entry-redirect.mjs');assert.match(d,/NUVEXA PRO · 桌面客户终端/);assert.match(d,/desktop-bridge\.mjs/);assert.match(m,/cn-terminal-bridge\.mjs/);assert.match(b,/fetch\('\/api\/account'/);assert.match(b,/Authorization:/);assert.match(r,/location\.replace\('\/desktop\.html'\)/);assert.match(r,/location\.replace\('\/cn-terminal\.html'\)/)});
test('desktop data is authenticated, no fabricated quote or balance',async()=>{const d=await file('web/desktop.html');assert.match(d,/window\.CN_SYNC_ACCOUNT/);assert.match(d,/Number\.isSafeInteger\(a\.cashCents\)/);assert.match(d,/synthetic OHLC/);assert.doesNotMatch(d,/DATA\.reqs\.unshift\(/);assert.match(d,/h\.c!=null/);assert.match(d,/申请接口尚未接入，未提交任何充值或提现请求/);assert.doesNotMatch(d,/998937\.60|function mkDaily\(|2026-11-04 · 1 USD/);});
