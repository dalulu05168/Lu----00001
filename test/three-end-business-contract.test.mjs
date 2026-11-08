import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {validateBusinessSnapshot,runBusinessContractGate} from '../scripts/three-end-business-contract.mjs';

const NOW=Date.parse('2026-11-08T01:45:00.000Z');
function examples(){return {
 '/api/account':{account:{id:'acc-1',cashCents:0,currency:'USD'},positions:[],orders:[]},
 '/api/account/analytics':{historyAvailable:true,currency:'USD',method:'FIFO',realizedPnlCents:0,unrealizedPnlCents:0,
  positionCostCents:0,portfolioValueCents:0,asOf:new Date(NOW).toISOString()},
 '/api/catalog':{items:[{market:'US',itemType:'STOCK',symbol:'AAPL',name:'Apple'},
  {market:'CN',itemType:'STOCK',symbol:'600519',name:'贵州茅台'}]},
 '/api/watchlist':{items:[]},'/api/internal-purchases':{positions:[],purchases:[],sales:[]},
 '/api/stock-quote?market=US&symbol=AAPL':{market:'US',symbol:'AAPL',currency:'USD',priceCents:10000,timestampMs:NOW-1000,source:'licensed test fixture',entitled:true,stale:false},
 '/api/stock-quote?market=CN&symbol=600519':{market:'CN',symbol:'600519',currency:'CNY',priceCents:20000,timestampMs:NOW-1000,source:'licensed test fixture',entitled:true,stale:false},
 '/api/admin/me':{role:'MASTER',userId:'admin-1'},'/api/admin/clients':{items:[]}
};}
async function fixture(overrides={}){
 const rows={...examples(),...overrides},calls=[];
 const server=createServer((req,res)=>{
  calls.push({method:req.method,url:req.url,authorization:req.headers.authorization});
  res.writeHead(rows[req.url]===undefined?404:200,{'content-type':'application/json'});
  res.end(JSON.stringify(rows[req.url]??{}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:'http://127.0.0.1:'+server.address().port,calls,close:()=>new Promise(resolve=>server.close(resolve))};
}
test('verified zero balance and empty rows are valid; unknown balance is not',()=>{
 const account=examples()['/api/account'];
 assert.equal(validateBusinessSnapshot('account',account),null);
 assert.match(validateBusinessSnapshot('account',{account:{id:'acc',currency:'USD'},positions:[],orders:[]}),/cash/);
 assert.match(validateBusinessSnapshot('account',{...account,positions:[{market:'RO',symbol:'BRD',quantity:1}]}),/position/);
});
test('quote rejects missing license, stale, future time and wrong currency',()=>{
 const quote=examples()['/api/stock-quote?market=CN&symbol=600519'];
 assert.equal(validateBusinessSnapshot('quoteCN',quote,{now:NOW}),null);
 for(const changed of [{entitled:false},{timestampMs:NOW-7200000},{timestampMs:NOW+10000},{currency:'USD'},{priceCents:0}]){
  assert.match(validateBusinessSnapshot('quoteCN',{...quote,...changed},{now:NOW}),/verified licensed/);
 }
});
test('P&L requires server-backed unrealized P&L even when realized is zero',()=>{
 const v=examples()['/api/account/analytics'];
 assert.equal(validateBusinessSnapshot('pnl',v),null);
 const {unrealizedPnlCents,...missing}=v;
 assert.match(validateBusinessSnapshot('pnl',missing),/realized\/unrealized/);
});
test('without authorized credentials no API requests run and no passes are claimed',async()=>{
 const f=await fixture();try{
  const result=await runBusinessContractGate({baseUrl:f.url,now:NOW});
  assert.equal(result.schemaPassed,false);
  assert.equal(result.results.length,9);
  assert.ok(result.results.every(r=>r.status==='BLOCKED'));
  assert.equal(f.calls.length,0);
 }finally{await f.close();}
});
test('isolated fixture performs exactly nine GETs and schema passes; business remains unverified',async()=>{
 const f=await fixture();try{
  const result=await runBusinessContractGate({baseUrl:f.url,clientToken:'client fixture',adminToken:'admin fixture',now:NOW});
  assert.equal(result.schemaPassed,true);
  assert.equal(result.results.filter(r=>r.status==='PASS').length,9);
  assert.equal(result.executionVerified,false);
  assert.equal(result.dbDurabilityVerified,false);
  assert.ok(f.calls.every(c=>c.method==='GET'&&c.authorization?.startsWith('Bearer ')));
 }finally{await f.close();}
});
test('unexpected null analytics and missing CN quote fail without exposing sensitive fields',async()=>{
 const f=await fixture({'/api/account/analytics':{},'/api/stock-quote?market=CN&symbol=600519':{}});try{
  const r=await runBusinessContractGate({baseUrl:f.url,clientToken:'secret customer',adminToken:'secret admin',now:NOW});
  assert.equal(r.schemaPassed,false);
  assert.equal(r.results.filter(x=>x.status==='FAIL').length,2);
  assert.doesNotMatch(JSON.stringify(r),/secret customer|secret admin|acc-1/);
 }finally{await f.close();}
});
test('bearer credentials are never sent to a remote plaintext HTTP origin',async()=>{
 await assert.rejects(runBusinessContractGate({baseUrl:'http://qa.example.test',remoteReadonly:true,
  clientToken:'secret customer',adminToken:'secret admin',fetchImpl:()=>{throw Error('fetch must not run')}}),/HTTPS/);
});
