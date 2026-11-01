import test from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../src/http-api.mjs";
async function withServer(fn){
 const api=createApi({db:{connect:async()=>({query:async(sql)=>({rows:sql.startsWith("SELECT cash_cents")?[{cash_cents:100000}]:[]}),release(){}})},resolveSession:async token=>token==="good"?{accountId:"acct"}:null,createId:()=>"id-1"});
 await new Promise(resolve=>api.listen(0,"127.0.0.1",resolve));
 try{await fn("http://127.0.0.1:"+api.address().port);}finally{await new Promise(resolve=>api.close(resolve));}
}
test("health endpoint declares broker disconnected",async()=>withServer(async base=>{
 const res=await fetch(base+"/health");assert.equal(res.status,200);assert.equal((await res.json()).brokerConnected,false);
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

test("serves terminal from the same origin",async()=>withServer(async base=>{
 const page=await fetch(base+"/");
 assert.equal(page.status,200);
 assert.match(await page.text(),/Global Stock Platform/);
 const script=await fetch(base+"/app.mjs");
 assert.equal(script.status,200);
 assert.match(await script.text(),/refreshAccount/);
}));
test("rejects inaccessible static paths",async()=>withServer(async base=>{
 const res=await fetch(base+"/private.env");assert.equal(res.status,404);
}));
