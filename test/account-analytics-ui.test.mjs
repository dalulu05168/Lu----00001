import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";
const flush=async()=>{for(let n=0;n<20;n++)await new Promise(resolve=>setImmediate(resolve));};
const json=(status,body)=>new Response(status===204?null:JSON.stringify(body),{status});
test('frontend renders full-history FIFO statistics, distinguishes cash-only valuation and clears stale results',async()=>{
 const dom=new JSDOM(await readFile(new URL('../web/index.html',import.meta.url),'utf8'),{url:'https://local.invalid/'});
 const old={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
 let response={currency:'USD',method:'FIFO',basis:'INTERNAL_GROSS',reportingTimeZone:'UTC',asOf:'2026-11-04T10:00:00Z',
  orderBasis:'CASH_LEDGER_ID',periodBasis:'ORDER_CREATED_AT',
  historyAvailable:true,reason:null,orderCount:121,holdingCount:0,buyVolumeCents:12000,sellVolumeCents:18000,
  volumeCents:30000,realizedPnlCents:6000,dayRealizedPnlCents:2000,monthRealizedPnlCents:6000,
  positionCostCents:0,portfolioValueCents:23456};
 let blocked=false,release;
 Object.assign(globalThis,{document:dom.window.document,sessionStorage:dom.window.sessionStorage});
 globalThis.fetch=async(url)=>{
  if(url==='/api/health')return json(200,{status:'alive',pricingConnected:false});
  if(url==='/api/ready')return json(200,{status:'ready',database:'connected'});
  if(url==='/api/auth/login')return json(200,{token:'statistics-customer'});
  if(url==='/api/auth/logout')return json(204);
  if(url==='/api/account')return json(200,{account:{id:'account',cashCents:23456,currency:'USD'},positions:[],orders:[]});
  if(url==='/api/account/analytics')return blocked?new Promise(resolve=>release=resolve):json(200,response);
  if(url==='/api/support')return json(200,{thread:null,messages:[]});
  return json(200,{items:[]});
 };
 const el=id=>dom.window.document.getElementById(id);
 try{
  await import('../web/app.mjs?account-analytics-ui');
  el('entryEmail').value='statistics@example.test';el('entryPassword').value='local-only-password-2026';
  el('entryForm').dispatchEvent(new dom.window.Event('submit',{cancelable:true,bubbles:true}));await flush();
  assert.equal(el('transactionVolume').textContent,'$300.00');assert.equal(el('realizedPnl').textContent,'$60.00');
  assert.match(el('realizedPnlNote').textContent,/FIFO/);assert.match(el('transactionVolumeNote').textContent,/121/);
  assert.equal(el('internalRecordCount').textContent,'121');assert.equal(el('orderCount').textContent,'121');
  assert.match(el('transactionHistoryScope').textContent,/完整历史/);
  assert.equal(el('portfolioValue').textContent,'$234.56');assert.match(el('portfolioValueNote').textContent,/仅现金/);
  assert.match(el('accountAnalyticsStatus').textContent,/手续费|税费/);
  assert.equal(el('dayRealizedPnl').textContent,'$20.00');assert.equal(el('monthRealizedPnl').textContent,'$60.00');
  assert.equal(el('overviewDayRealizedPnl').textContent,'$20.00');
  assert.equal(el('overviewMonthRealizedPnl').textContent,'$60.00');
  for(const target of ['serviceRequestsPanel','commodityCatalogPanel','customerSupportPanel'])
   assert.ok(dom.window.document.querySelector('.sidebar-link[href="#'+target+'"]'));
  response={...response,historyAvailable:false,reason:'POSITION_HISTORY_MISMATCH',realizedPnlCents:null,
   dayRealizedPnlCents:null,monthRealizedPnlCents:null,positionCostCents:null,portfolioValueCents:null,holdingCount:1};
  el('refreshAccountButton').click();await flush();
  assert.equal(el('realizedPnl').textContent,'—');assert.equal(el('portfolioValue').textContent,'—');
  assert.equal(el('overviewDayRealizedPnl').textContent,'—');
  assert.match(el('accountAnalyticsStatus').textContent,/不一致/);
  blocked=true;el('refreshAccountButton').click();await flush();
  assert.equal(el('realizedPnl').textContent,'—');
  el('logout').click();await flush();
  release(json(200,{...response,historyAvailable:true,realizedPnlCents:99999}));await flush();
  assert.equal(el('realizedPnl').textContent,'—');assert.equal(el('overview').hidden,true);
 }finally{Object.assign(globalThis,old);dom.window.close();}
});
