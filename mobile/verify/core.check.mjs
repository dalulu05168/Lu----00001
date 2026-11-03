import test from "node:test";
import assert from "node:assert/strict";
import {amount,dateLabel,orderCsv,shares} from "../src/format.ts";
import {ApiError,accountSnapshot,apiRequest,changeWatchlist,login,verifiedApiBase,watchlist} from "../src/api.ts";
test("currency and quantity display only valid numbers",()=>{
  assert.equal(amount(0,"USD"),"$0.00");
  assert.equal(amount(null,"USD"),"—");
  assert.equal(amount(-1,"USD"),"—");
  assert.equal(shares("12"),"12");
  assert.equal(shares("bogus"),"—");
  assert.equal(dateLabel("not a date"),"—");
});
test("CSV uses actual order rows and neutralizes spreadsheet formulas",()=>{
  const csv=orderCsv([{id:"test",market:"US",symbol:"=1+2",side:"BUY",quantity:2,price_cents:5,amount_usd_cents:10,created_at:"2026-11-03"}]);
  assert.match(csv,/US/);
  assert.match(csv,/"'=1\+2"/);
  assert.match(csv,/BUY/);
  assert.equal(csv.split("\r\n").length,2);
});
test("API refuses HTTP or malformed service destinations",()=>{
  const prior=process.env.EXPO_PUBLIC_API_BASE_URL;
  try{
    process.env.EXPO_PUBLIC_API_BASE_URL="http://insecure.example";
    assert.throws(()=>verifiedApiBase(),ApiError);
    process.env.EXPO_PUBLIC_API_BASE_URL="https://secure.example/api";
    assert.throws(()=>verifiedApiBase(),ApiError);
    process.env.EXPO_PUBLIC_API_BASE_URL="https://secure.example";
    assert.equal(verifiedApiBase(),"https://secure.example");
  }finally{
    if(prior===undefined)delete process.env.EXPO_PUBLIC_API_BASE_URL;
    else process.env.EXPO_PUBLIC_API_BASE_URL=prior;
  }
});
test("authenticated API requests retain verified server boundary and Bearer token",async()=>{
  const orig=globalThis.fetch,prior=process.env.EXPO_PUBLIC_API_BASE_URL;
  const calls=[];
  try{
    process.env.EXPO_PUBLIC_API_BASE_URL="https://secure.example";
    globalThis.fetch=async(input,init)=>{
      calls.push({url:String(input),init});
      if(String(input).endsWith("/api/account"))return new Response(JSON.stringify({account:{id:"acct",cashCents:100,currency:"USD"},positions:[],orders:[],disclosure:"Internal records only"}),{status:200,headers:{"content-type":"application/json"}});
      if(String(input).endsWith("/api/watchlist"))return new Response(JSON.stringify(init?.method==="POST"?{item:{market:"US",symbol:"AAPL"}}:{items:[]}),{status:200,headers:{"content-type":"application/json"}});
      if(String(input).endsWith("/api/auth/login"))return new Response(JSON.stringify({token:"server-issued-token",expiresAt:"2026-11-05"}),{status:200,headers:{"content-type":"application/json"}});
      return new Response(JSON.stringify({error:"not found"}),{status:404,headers:{"content-type":"application/json"}});
    };
    const snap=await accountSnapshot("opaque-session");
    assert.equal(snap.account.cashCents,100);
    assert.equal(calls[0].url,"https://secure.example/api/account");
    assert.equal(calls[0].init.headers.authorization,"Bearer opaque-session");
    assert.deepEqual(await watchlist("opaque-session"),[]);
    const session=await login(" USER@EXAMPLE.COM ","secret");
    assert.equal(session.token,"server-issued-token");
    assert.equal(JSON.parse(calls[2].init.body).email,"user@example.com");
    await changeWatchlist("opaque-session",{market:"US",symbol:"AAPL"});
    assert.equal(calls[3].init.method,"POST");
    assert.deepEqual(JSON.parse(calls[3].init.body),{market:"US",symbol:"AAPL"});
    await assert.rejects(()=>apiRequest("//evil.host"),ApiError);
  }finally{
    globalThis.fetch=orig;
    if(prior===undefined)delete process.env.EXPO_PUBLIC_API_BASE_URL;
    else process.env.EXPO_PUBLIC_API_BASE_URL=prior;
  }
});
test("API rejects unauthenticated account snapshots without pretending success",async()=>{
  const orig=globalThis.fetch,prior=process.env.EXPO_PUBLIC_API_BASE_URL;
  try{
    process.env.EXPO_PUBLIC_API_BASE_URL="https://secure.example";
    globalThis.fetch=async()=>new Response(JSON.stringify({error:"Unauthorized"}),{status:401,headers:{"content-type":"application/json"}});
    await assert.rejects(()=>accountSnapshot("expired"),e=>e instanceof ApiError&&e.status===401);
  }finally{
    globalThis.fetch=orig;
    if(prior===undefined)delete process.env.EXPO_PUBLIC_API_BASE_URL;
    else process.env.EXPO_PUBLIC_API_BASE_URL=prior;
  }
});

test("generated iOS and Android app icons are 1024px PNG images",async()=>{
  const {readFile}=await import("node:fs/promises");
  for(const filename of ["icon.png","adaptive-icon.png"]){
    const buffer=await readFile(new URL("../assets/"+filename,import.meta.url));
    assert.equal(buffer.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
    assert.equal(buffer.readUInt32BE(16),1024);
    assert.equal(buffer.readUInt32BE(20),1024);
  }
});

test("in-app deletion API sends password re-verification and reads server-confirmed status",async()=>{
  const {deletionStatus,submitDeletionRequest}=await import("../src/api.ts");
  const original=globalThis.fetch,prior=process.env.EXPO_PUBLIC_API_BASE_URL;
  try{
    process.env.EXPO_PUBLIC_API_BASE_URL="https://secure.example";
    const calls=[];
    globalThis.fetch=async(url,init)=>{
      calls.push({url:String(url),init});
      return new Response(JSON.stringify({status:"REQUESTED",requestId:"r1",requestedAt:"2026-11-04"}),{status:init?.method==="POST"?202:200,headers:{"content-type":"application/json"}});
    };
    assert.equal((await deletionStatus("abc")).status,"REQUESTED");
    assert.equal((await submitDeletionRequest("abc","secret")).status,"REQUESTED");
    assert.equal(calls[1].url,"https://secure.example/api/account/deletion-request");
    assert.equal(calls[1].init.method,"POST");
    assert.equal(calls[1].init.headers.authorization,"Bearer abc");
    assert.deepEqual(JSON.parse(calls[1].init.body),{password:"secret",confirmation:"DELETE MY ACCOUNT"});
  }finally{globalThis.fetch=original;if(prior===undefined)delete process.env.EXPO_PUBLIC_API_BASE_URL;else process.env.EXPO_PUBLIC_API_BASE_URL=prior;}
});
test("privacy/deletion links allow verified HTTPS only",async()=>{
  const {safeHttpsUrl}=await import("../src/links.ts");
  assert.equal(safeHttpsUrl("javascript:alert(1)"),null);
  assert.equal(safeHttpsUrl("http://example.com/legal"),null);
  assert.equal(safeHttpsUrl("https://localhost/privacy"),null);
  assert.equal(safeHttpsUrl("https://verified.example.org/privacy"),"https://verified.example.org/privacy");
});
