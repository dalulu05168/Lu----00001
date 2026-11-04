import test from "node:test";
import assert from "node:assert/strict";
import {createApi} from "../src/http-api.mjs";
test('analytics endpoint derives account from the customer session, ignores supplied account identifiers and rejects other roles',async()=>{
 const scoped=[];
 const db={connect:async()=>({query:async(sql,params)=>{
  if(sql.includes('FROM '))scoped.push(params);
  return {rows:sql.includes('FROM accounts')?[{cash_cents:'1234'}]:[]};
 },release(){}})};
 const app=createApi({db,resolveSession:async token=>token==='customer'?{userId:'A',accountId:'own-account',adminVerified:false}:
  token==='admin'?{userId:'master',accountId:'admin-account',adminVerified:true}:null});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.address().port;
 const request=(token,method='GET')=>fetch(base+'/api/account/analytics?accountId=another-account',{
  method,headers:token?{authorization:'Bearer '+token}:{}});
 try{
  assert.equal((await request()).status,401);assert.equal((await request('admin')).status,403);
  assert.equal((await request('customer','POST')).status,405);
  const response=await request('customer');assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.portfolioValueCents,1234);
  assert.equal(result.realizedPnlCents,0);assert.ok(scoped.length>0);
  assert.ok(scoped.every(params=>params.length===1&&params[0]==='own-account'));
 }finally{await new Promise(resolve=>app.close(resolve));}
});
