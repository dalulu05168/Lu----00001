import test from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../src/http-api.mjs";
async function withServer(fn){
 const api=createApi({db:{connect:async()=>({query:async(sql)=>({rows:sql.startsWith("SELECT cash_cents")?[{cash_cents:100000}]:[]}),release(){}})},resolveSession:async token=>token==="good"?{accountId:"acct"}:null,createId:()=>"id-1"});
 await new Promise(resolve=>api.listen(0,"127.0.0.1",resolve));
 try{await fn("http://127.0.0.1:"+api.address().port);}finally{await new Promise(resolve=>api.close(resolve));}
}
test("health endpoint declares broker disconnected",async()=>withServer(async base=>{
 for(const path of ["/health","/api/health"]){
  const res=await fetch(base+path);
  assert.equal(res.status,200,path);
  assert.equal((await res.json()).brokerConnected,false);
 }
}));
test("rejects unauthenticated order",async()=>withServer(async base=>{
 const res=await fetch(base+"/api/orders",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});assert.equal(res.status,401);
}));
test("rejects client-controlled account ID",async()=>withServer(async base=>{
 const res=await fetch(base+"/api/orders",{method:"POST",headers:{authorization:"Bearer good","idempotency-key":"key-12345678"},body:JSON.stringify({accountId:"other"})});assert.equal(res.status,400);
}));
test("rejects invalid JSON",async()=>withServer(async base=>{
 const res=await fetch(base+"/api/orders",{method:"POST",headers:{authorization:"Bearer good","idempotency-key":"key-12345678"},body:"{"});assert.equal(res.status,400);
}));

test("rejects client-supplied execution pricing",async()=>withServer(async base=>{
 const res=await fetch(base+"/api/orders",{method:"POST",headers:{authorization:"Bearer good","idempotency-key":"key-12345678","content-type":"application/json"},body:JSON.stringify({market:"US",symbol:"AAPL",side:"BUY",quantity:1,priceCents:1,fxUsdMicros:1})});
 assert.equal(res.status,400);
 assert.equal((await res.json()).error,"Unexpected fields");
}));

test("registration rejects client-defined opening funds",async()=>withServer(async base=>{
 const res=await fetch(base+"/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"user@example.com",password:"secure password",openingCashCents:100000})});
 assert.equal(res.status,400);
}));
test("account endpoint requires authenticated session",async()=>withServer(async base=>{
 const res=await fetch(base+"/api/account");assert.equal(res.status,401);
}));
test("registration rejects invalid email before database writes",async()=>withServer(async base=>{
 const res=await fetch(base+"/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"invalid",password:"secure password"})});
 assert.equal(res.status,400);
}));

test("without trusted provider, order request returns 503",async()=>withServer(async base=>{
 const res=await fetch(base+"/api/orders",{method:"POST",headers:{authorization:"Bearer good","idempotency-key":"key-12345678","content-type":"application/json"},body:JSON.stringify({market:"US",symbol:"AAPL",side:"BUY",quantity:1})});
 assert.equal(res.status,503);
 assert.equal((await res.json()).error,"Verified market pricing unavailable");
}));
test("auth endpoints reject GET method",async()=>withServer(async base=>{
 const res=await fetch(base+"/api/auth/login");assert.equal(res.status,405);
}));

test("serves the replacement UI entrypoints from the same origin",async()=>withServer(async base=>{
 for(const path of ["/","/login.html","/index.html","/mobile.html","/cn-terminal.html","/admin.html","/cn-admin.html"]){
  const page=await fetch(base+path);
  assert.equal(page.status,200,path);
  assert.match(await page.text(),/<!doctype html>/i,path);
 }
}));
test("rejects inaccessible static paths",async()=>withServer(async base=>{
 const res=await fetch(base+"/private.env");assert.equal(res.status,404);
}));

test("readiness endpoint checks database connection",async()=>{
 let healthy=true, schemaReady=true;
 const names=["app_users","accounts","positions","orders","cash_ledger","user_sessions"];
 const db={query:async()=>{if(!healthy)throw new Error("db offline");return {rows:[Object.fromEntries(names.map(name=>[name,schemaReady?name:null]))]};},connect:async()=>({query:async(sql)=>({rows:sql.startsWith("SELECT cash_cents")?[{cash_cents:100000}]:[]}),release(){}})};
 const api=createApi({db,resolveSession:async()=>null});
 await new Promise(resolve=>api.listen(0,"127.0.0.1",resolve));
 const base="http://127.0.0.1:"+api.address().port;
 try{
  for(const path of ["/ready","/api/ready"]){
   const res=await fetch(base+path);
   assert.equal(res.status,200,path);
   assert.equal((await res.json()).database,"connected");
  }
  schemaReady=false;
  const missing=await fetch(base+"/api/ready");
  assert.equal(missing.status,503);
  assert.equal((await missing.json()).database,"schema_missing");
  schemaReady=true;
  healthy=false;
  const response=await fetch(base+"/api/ready");
  assert.equal(response.status,503);
  assert.equal((await response.json()).database,"unavailable");
 }finally{await new Promise(resolve=>api.close(resolve));}
});

test("does not expose deleted legacy UI assets",async()=>withServer(async base=>{
 for(const asset of ["/app.mjs","/styles.css","/admin.mjs","/stock-chart.mjs"]){
  const response=await fetch(base+asset);
  assert.equal(response.status,404,asset);
 }
}));

test("root serves unified login instead of an unverified account screen",async()=>withServer(async base=>{
 const response=await fetch(base+"/");
 assert.equal(response.status,200);
 const html=await response.text();
 assert.match(html,/id="loginForm"/);
 assert.match(html,/data-login-role="master"/);
 assert.doesNotMatch(html,/state\.role=state\.loginRole/);
}));
