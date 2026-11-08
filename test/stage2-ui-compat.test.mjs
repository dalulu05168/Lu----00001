import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyStage2State,toStage2State,createStage2ClientController,
 createStage2ClientSession,createStage2AdminReader,STAGE2_ADMIN_API} from '../web/stage2-ui-compat.mjs';
import {inspectStage2Html,auditStage2Files} from '../scripts/stage2-ui-dom-audit.mjs';
const account=()=>({account:{id:'account-12345678',currency:'USD',cashCents:0},
 positions:[{market:'US',symbol:'AAPL',quantity:3}],orders:[{id:'o1',market:'US',symbol:'AAPL',side:'BUY',
 quantity:3,priceCents:10001,amountUsdCents:30003,createdAt:'2026-11-07T10:30:00Z'}]});
const analysis=()=>({historyAvailable:true,currency:'USD',method:'FIFO',
 realizedPnlCents:1700,positionCostCents:30003,volumeCents:30003,portfolioValueCents:null});
const overview=()=>({account:{state:'ready',data:account()},analytics:{state:'ready',data:analysis()}});
const res=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>data});
test('unknown state is not real zero or enabled trading',()=>{
 const x=emptyStage2State();assert.equal(x.desktop.cashOverride,null);
 assert.equal(x.mobile.cash,null);assert.equal(x.desktop.totalAssets,null);
 assert.equal(x.flags.tradeEligible,false);assert.equal(x.mobile.auth,0);
});
test('account exact cents, orders, FIFO, confirmed zero and unknown valuation',()=>{
 const x=toStage2State(overview(),{catalog:[{market:'US',symbol:'AAPL',name:'Apple'}],
   watchlist:[{market:'US',symbol:'AAPL'}],requests:[]});
 assert.equal(x.desktop.cashOverride,0);assert.equal(x.mobile.cash,0);
 assert.equal(x.desktop.realizedPnl,17);assert.equal(x.mobile.holdCost,300.03);
 assert.equal(x.desktop.totalAssets,null);assert.equal(x.desktop.orders[0].a,300.03);
 assert.equal(x.desktop.orders[0].p,100.01);assert.equal(x.desktop.holds[0].c,null);
 assert.equal(x.flags.tradeEligible,false);assert.equal(x.flags.requests,true);
});
test('missing analytics, account and 503 never become cash, volume or profit',()=>{
 const a=toStage2State({account:{state:'unavailable'},analytics:{state:'unavailable'}});
 assert.equal(a.desktop.cashOverride,null);assert.equal(a.mobile.accountReady,false);
 const b=toStage2State({account:{state:'ready',data:account()},analytics:{state:'unavailable'}});
 assert.equal(b.desktop.cashOverride,0);assert.equal(b.desktop.realizedPnl,null);
 assert.equal(b.desktop.totalAssets,null);assert.equal(b.mobile.tradeTotal,null);
});
test('token switch and 401 clear previous customer state',async()=>{
 let token='first',resolveOverview;
 const api={loadOverview:()=>new Promise(resolve=>{resolveOverview=resolve;}),
 getCatalog:async()=>[],getWatchlist:async()=>[],getRequests:async()=>[]};
 const ctl=createStage2ClientController({businessApi:api,getToken:()=>token});
 const pending=ctl.refresh();await Promise.resolve();token='other';resolveOverview(overview());
 await assert.rejects(pending,e=>e.code==='SESSION_CHANGED');
 assert.equal(ctl.getState().desktop.cashOverride,null);
 const failure={...api,loadOverview:async()=>{throw {status:401};}};
 const ctl2=createStage2ClientController({businessApi:failure,getToken:()=>token});
 await assert.rejects(ctl2.refresh(),e=>e.status===401);
 assert.equal(ctl2.getState().mobile.auth,0);
});
test('internal order is forbidden by default and uses existing verified adapter',async()=>{
 let count=0,got=null;
 const api={loadOverview:async()=>overview(),getCatalog:async()=>[],
 getWatchlist:async()=>[],getRequests:async()=>[],
 submitInternalOrder:async v=>{count++;got=v;return {order:{id:'o2'}};}};
 const ctl=createStage2ClientController({businessApi:api,getToken:()=> 'qa-token'});
 await assert.rejects(ctl.submitOrder({side:'BUY',market:'US',symbol:'AAPL',quantity:1}),e=>e.status===503);
 assert.equal(count,0);
 const enabled=createStage2ClientController({businessApi:api,getToken:()=> 'qa-token',
  capabilities:{internalTradingQaVerified:true}});
 const input={side:'BUY',market:'US',symbol:'AAPL',quantity:1,idempotencyKey:'abcdefgh-1234'};
 await enabled.submitOrder(input);assert.deepEqual(got,input);assert.equal(count,1);
});
test('client login requires real response token and /account readback',async()=>{
 let token=null,paths=[];
 const s=createStage2ClientSession({getToken:()=>token,setToken:v=>token=v,
 fetchImpl:async(path)=>{paths.push(path);
 return path==='/api/auth/login'?res(200,{token:'issued-by-server'}):res(200,account());}});
 const result=await s.login({email:'qa@example.test',password:'valid-for-test'});
 assert.equal(result.accountId,'account-12345678');assert.equal(token,'issued-by-server');
 assert.deepEqual(paths,['/api/auth/login','/api/account']);
 const bad=createStage2ClientSession({getToken:()=>token,setToken:v=>token=v,
 fetchImpl:async p=>p.endsWith('/login')?res(200,{token:'new'}):res(503,{})});
 await assert.rejects(bad.login({email:'x',password:'y'}),e=>e.status===503);
 assert.equal(token,null);
});
test('logout clears token after unreachable endpoint',async()=>{
 let token='t';const s=createStage2ClientSession({getToken:()=>token,setToken:v=>token=v,
 fetchImpl:async()=>{throw Error('offline');}});
 await assert.rejects(s.logout(),/offline/);assert.equal(token,null);
});
test('admin reader isolates MASTER/SUBADMIN verified identity and uses only GET',async()=>{
 assert.equal(Object.keys(STAGE2_ADMIN_API).length,10);
 const calls=[];const r=createStage2AdminReader({getAdminToken:()=> 'admin-token',
 fetchImpl:async(path,opt)=>{calls.push({path,method:opt.method,auth:opt.headers.authorization});
 return res(200,path==='/api/admin/me'?{role:'SUBADMIN',userId:'a'}:{items:[]});}});
 const result=await r.read('p-cli');assert.equal(result.path,'/api/admin/clients');
 assert.deepEqual(calls.map(x=>x.path),['/api/admin/me','/api/admin/clients']);
 assert.ok(calls.every(x=>x.method==='GET'&&x.auth==='Bearer admin-token'));
});
test('admin missing session, CLIENT identity and 503 fail closed',async()=>{
 const unauth=createStage2AdminReader({getAdminToken:()=>null,fetchImpl:async()=>{throw Error('must not fetch');}});
 await assert.rejects(unauth.read('p-over'),e=>e.status===401);
 const wrong=createStage2AdminReader({getAdminToken:()=> 'x',fetchImpl:async()=>res(200,{role:'CLIENT'})});
 await assert.rejects(wrong.read('p-cli'),e=>e.status===403);
 const fail=createStage2AdminReader({getAdminToken:()=> 'x',fetchImpl:async()=>res(503,{})});
 await assert.rejects(fail.read('p-cli'),e=>e.status===503);
});
test('exact stage2 UI file hash protects design without modifying HTML',()=>{
 const data=inspectStage2Html('前台.html',Buffer.from('<html id="p-trade"></html>'));
 assert.equal(data.ready,false);assert.equal(data.shaVerified,false);
 assert.ok(data.missingIds.includes('f-chat'));
});
test('materialized original stage2 ZIP exact three file hash + event hooks',async t=>{
 if(!process.env.STAGE2_UI_ROOT){t.skip('Stage2 Library ZIP not available in CI workspace');return;}
 const result=await auditStage2Files({root:process.env.STAGE2_UI_ROOT});
 assert.equal(result.passed,true,JSON.stringify(result.checked.filter(x=>!x.ready)));
 assert.equal(result.checked.length,3);
 assert.equal(result.uiMounted,false);assert.equal(result.tradeQAVerified,false);
});
