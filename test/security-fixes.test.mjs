import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createApi} from "../src/http-api.mjs";
import {createAuthRateLimiter,clientAddress} from "../src/auth-rate-limit.mjs";
import {reviewAdminRequest,submitClientRequest} from "../src/operational-workflows.mjs";
import {sellInternalStock} from "../src/internal-stock-sales.mjs";
import {settleDueFunds} from "../src/fund-maturities.mjs";

async function withServer(options,fn){
  const api=createApi({db:{query:async()=>({rows:[]}),connect:async()=>({query:async()=>({rows:[]}),release(){}})},
    resolveSession:async()=>null,...options});
  await new Promise(resolve=>api.listen(0,"127.0.0.1",resolve));
  try{await fn("http://127.0.0.1:"+api.address().port);}
  finally{await new Promise(resolve=>api.close(resolve));}
}
const post=(base,path,body)=>fetch(base+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});

test("rate limiter locks one identity after repeated failures and clears on success",()=>{
  let time=0;
  const limiter=createAuthRateLimiter({now:()=>time,limits:{
    accountFailures:{max:3,windowMs:1000},ipFailures:{max:100,windowMs:1000},registrations:{max:5,windowMs:1000}}});
  const checks=[["accountFailures","client:a@example.test"]];
  for(let i=0;i<3;i++){assert.equal(limiter.blocked(checks),0);limiter.record(checks);}
  assert.equal(limiter.blocked(checks),1);
  assert.equal(limiter.blocked([["accountFailures","client:b@example.test"]]),0);
  time=1000;
  assert.equal(limiter.blocked(checks),0,"window expiry lifts the lock");
  limiter.record(checks);limiter.reset("accountFailures","client:a@example.test");
  assert.equal(limiter.blocked(checks),0);
});

test("client address uses the proxy-observed right-most forwarded entry",()=>{
  assert.equal(clientAddress({headers:{"x-forwarded-for":"6.6.6.6, 203.0.113.9"}},undefined),"203.0.113.9");
  assert.equal(clientAddress({headers:{"cf-connecting-ip":"198.51.100.4","x-forwarded-for":"1.1.1.1"}},"cf-connecting-ip"),"198.51.100.4");
  assert.equal(clientAddress({headers:{},socket:{remoteAddress:"127.0.0.1"}},undefined),"127.0.0.1");
});

test("client login is throttled with 429 and Retry-After after repeated wrong passwords",async()=>{
  const authLimiter=createAuthRateLimiter({limits:{
    accountFailures:{max:2,windowMs:60000},ipFailures:{max:100,windowMs:60000},registrations:{max:5,windowMs:60000}}});
  await withServer({authLimiter},async base=>{
    const body={email:"victim@example.test",password:"wrong password 1"};
    assert.equal((await post(base,"/api/auth/login",body)).status,401);
    assert.equal((await post(base,"/api/auth/login",body)).status,401);
    const blocked=await post(base,"/api/auth/login",body);
    assert.equal(blocked.status,429);
    assert.ok(Number(blocked.headers.get("retry-after"))>0);
    assert.equal((await post(base,"/api/auth/login",{...body,email:"other@example.test"})).status,401);
  });
});

test("admin login is throttled the same way",async()=>{
  const authLimiter=createAuthRateLimiter({limits:{
    accountFailures:{max:1,windowMs:60000},ipFailures:{max:100,windowMs:60000},registrations:{max:5,windowMs:60000}}});
  await withServer({authLimiter},async base=>{
    const body={email:"master@example.test",password:"wrong password 1"};
    assert.equal((await post(base,"/api/admin/login",body)).status,401);
    assert.equal((await post(base,"/api/admin/login",body)).status,429);
  });
});

test("registration attempts per address are capped before any password hashing",async()=>{
  const authLimiter=createAuthRateLimiter({limits:{
    accountFailures:{max:5,windowMs:60000},ipFailures:{max:100,windowMs:60000},registrations:{max:1,windowMs:60000}}});
  await withServer({authLimiter},async base=>{
    const body={email:"new@example.test",password:"short"};
    assert.equal((await post(base,"/api/auth/register",body)).status,400);
    assert.equal((await post(base,"/api/auth/register",body)).status,429);
  });
});

test("every response carries anti-framing and nosniff headers",async()=>withServer({},async base=>{
  for(const path of ["/","/admin.html","/api/health","/api/does-not-exist"]){
    const res=await fetch(base+path);
    assert.equal(res.headers.get("x-frame-options"),"DENY",path);
    assert.equal(res.headers.get("content-security-policy"),"frame-ancestors 'none'",path);
    assert.equal(res.headers.get("x-content-type-options"),"nosniff",path);
  }
}));

function workflowDb({bankBound,request}){
  const calls=[];
  const db={connect:async()=>({release(){},async query(sql,p=[]){
    calls.push(sql);
    if(sql.includes("FROM client_bank_link_requests WHERE client_user_id"))return {rows:bankBound?[{id:randomUUID()}]:[]};
    if(sql.includes("SELECT r.*"))return {rows:[request]};
    if(sql.startsWith("INSERT INTO client_funding_requests"))return {rows:[{id:p[0],client_user_id:p[1],kind:p[2],amount_cents:p[3],status:"SUBMITTED"}]};
    if(sql.startsWith("UPDATE client_bank_link_requests"))return {rows:[{...request,status:p[1]}]};
    return {rows:[]};
  }})};
  return {db,calls};
}

test("withdrawal submission requires a bound bank account; deposits do not",async()=>{
  const userId=randomUUID();
  const unbound=workflowDb({bankBound:false});
  await assert.rejects(submitClientRequest(unbound.db,userId,"FUNDING",{kind:"WITHDRAWAL",amountCents:1000}),
    e=>e.statusCode===409&&e.message==="Withdrawal requires a bound bank account");
  assert.equal(unbound.calls.at(-1),"ROLLBACK");
  const deposit=await submitClientRequest(unbound.db,userId,"FUNDING",{kind:"DEPOSIT",amountCents:1000});
  assert.equal(deposit.kind,"DEPOSIT");
  const bound=workflowDb({bankBound:true});
  const withdrawal=await submitClientRequest(bound.db,userId,"FUNDING",{kind:"WITHDRAWAL",amountCents:1000});
  assert.equal(withdrawal.kind,"WITHDRAWAL");
});

test("bank link can leave NEEDS_INFORMATION: resume by any admin, reject by master only",async()=>{
  const request={id:randomUUID(),client_user_id:randomUUID(),status:"NEEDS_INFORMATION",bank_label:"Bank",account_last4:"1234"};
  const sub={role:"SUBADMIN",userId:randomUUID()},master={role:"MASTER",userId:randomUUID()};
  const resumed=await reviewAdminRequest(workflowDb({request}).db,sub,"BANK_LINK",
    {id:request.id,expectedStatus:"NEEDS_INFORMATION",status:"PENDING_VERIFICATION"});
  assert.equal(resumed.status,"PENDING_VERIFICATION");
  await assert.rejects(reviewAdminRequest(workflowDb({request}).db,sub,"BANK_LINK",
    {id:request.id,expectedStatus:"NEEDS_INFORMATION",status:"REJECTED"}),e=>e.statusCode===403);
  const rejected=await reviewAdminRequest(workflowDb({request}).db,master,"BANK_LINK",
    {id:request.id,expectedStatus:"NEEDS_INFORMATION",status:"REJECTED"});
  assert.equal(rejected.status,"REJECTED");
  await assert.rejects(reviewAdminRequest(workflowDb({request}).db,master,"BANK_LINK",
    {id:request.id,expectedStatus:"NEEDS_INFORMATION",status:"MANUALLY_REVIEWED"}),e=>e.statusCode===403,
    "binding still requires going back through verification");
});

test("stock sale fetches its quote before the account lock is taken",async()=>{
  const events=[];
  const db={connect:async()=>{events.push("connect");return {release(){},async query(sql){
    events.push(sql.split(/\s+/).slice(0,3).join(" "));
    if(sql.startsWith("SELECT cash_cents"))return {rows:[{cash_cents:"0"}]};
    return {rows:[]};
  }};}};
  const getStockQuote=async()=>{events.push("quote");return {priceCents:100,timestampMs:Date.now(),source:"test"};};
  await assert.rejects(sellInternalStock(db,randomUUID(),"sale-key-123",{symbol:"AAPL",quantity:1,confirmedStockPriceCents:100},{getStockQuote}),
    /Insufficient unlocked stock quantity/);
  assert.ok(events.indexOf("quote")<events.indexOf("BEGIN"),events.join(" | "));
  assert.ok(!events.slice(events.indexOf("BEGIN")).includes("quote"));
});

test("stock sale keeps idempotent replay working while the quote provider is down",async()=>{
  const accountId=randomUUID(),old={id:randomUUID(),symbol:"AAPL",quantity:"1"};
  const db={connect:async()=>({release(){},async query(sql){
    if(sql.startsWith("SELECT cash_cents"))return {rows:[{cash_cents:"0"}]};
    if(sql.startsWith("SELECT * FROM internal_stock_sales"))return {rows:[old]};
    return {rows:[]};
  }})};
  const getStockQuote=async()=>{throw Object.assign(new Error("Verified US stock quote unavailable"),{statusCode:503});};
  const result=await sellInternalStock(db,accountId,"sale-key-123",{symbol:"AAPL",quantity:1,confirmedStockPriceCents:100},{getStockQuote});
  assert.equal(result.replayed,true);
});

test("fund settlement can be limited to one account",async()=>{
  const seen=[];
  await settleDueFunds({query:async(sql,params)=>{seen.push(params);return {rows:[]};}},{accountId:"11111111-1111-4111-8111-111111111111"});
  await settleDueFunds({query:async(sql,params)=>{seen.push(params);return {rows:[]};}});
  assert.deepEqual(seen,[["11111111-1111-4111-8111-111111111111"],[null]]);
});
