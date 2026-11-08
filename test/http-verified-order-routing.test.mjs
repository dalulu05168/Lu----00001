import test from "node:test";
import assert from "node:assert/strict";
import {createApi} from "../src/http-api.mjs";

const ACCOUNT_ID="11111111-1111-4111-8111-111111111111";
const intent=Object.freeze({side:"BUY",market:"US",symbol:"AAPL",quantity:1});
const key="verified-order-key-0001";
const receipt={
 id:"internal-order-1",side:"BUY",market:"US",symbol:"AAPL",quantity:1,
 execution:"INTERNAL_ONLY",unitPriceCents:12345,fxUsdMicros:1000000,
 amountUsdCents:12345,cashDeltaCents:-12345,
 quoteSource:"licensed-provider",quoteTimestampMs:1700000000000,quoteCurrency:"USD"
};
const success={
 replayed:false,
 order:{id:receipt.id,side:receipt.side,market:receipt.market,symbol:receipt.symbol,
  quantity:receipt.quantity,execution:receipt.execution,priceCents:receipt.unitPriceCents,
  fxUsdMicros:receipt.fxUsdMicros,amountCents:receipt.amountUsdCents},
 receipt,
 quote:{priceCents:receipt.unitPriceCents,source:receipt.quoteSource,
  timestampMs:receipt.quoteTimestampMs,currency:receipt.quoteCurrency}
};
async function serverTest(options,run){
 const api=createApi({
  db:{},resolveSession:async token=>token==="customer"?{accountId:ACCOUNT_ID,userId:"u1"}:null,
  ...options
 });
 await new Promise(resolve=>api.listen(0,"127.0.0.1",resolve));
 try{await run("http://127.0.0.1:"+api.address().port);}
 finally{await new Promise(resolve=>api.close(resolve));}
}
function order(base,body=intent,token="customer"){
 return fetch(base+"/api/orders",{method:"POST",headers:{
  authorization:"Bearer "+token,"content-type":"application/json",
  "idempotency-key":key
 },body:JSON.stringify(body)});
}
test("verified route accepts authenticated intent and returns committed receipt",async()=>{
 let called=0;
 await serverTest({verifiedTrading:{
  tradingEnabled:true,
  // This is an isolated contract stub: it is NOT a licensed market quote.
  execute:async opts=>{
   called++;
   assert.equal(opts.accountId,ACCOUNT_ID);
   assert.equal(opts.key,key);
   assert.deepEqual(opts.request,intent);
   assert.equal(opts.tradingEnabled,true);
   return success;
  }
 }},async base=>{
  const res=await order(base);
  assert.equal(res.status,201);
  assert.equal((await res.json()).receipt.id,receipt.id);
 });
 assert.equal(called,1);
});
test("order authorization cannot be overwritten by injected configuration",async()=>{
 let called=0;
 await serverTest({verifiedTrading:{
  tradingEnabled:true,session:{accountId:"00000000-0000-4000-8000-000000000000"},
  body:{side:"SELL"},idempotencyKey:"other-injected-key",
  execute:async opts=>{
   called++;
   assert.equal(opts.accountId,ACCOUNT_ID);
   assert.equal(opts.key,key);
   assert.deepEqual(opts.request,intent);
   return success;
  }
 }},async base=>assert.equal((await order(base)).status,201));
 assert.equal(called,1);
});
test("verified route never executes when tradingEnabled is not explicitly true",async()=>{
 let called=false;
 await serverTest({verifiedTrading:{tradingEnabled:"true",execute:async()=>{called=true;return success;}}},async base=>{
  const res=await order(base);
  assert.equal(res.status,503);
  assert.equal((await res.json()).error,"Verified internal order unavailable");
 });
 assert.equal(called,false);
});
test("verified route does not accept browser price or account ID",async()=>{
 let called=false;
 await serverTest({verifiedTrading:{tradingEnabled:true,execute:async()=>{called=true;return success;}}},async base=>{
  const res=await order(base,{...intent,priceCents:1,accountId:ACCOUNT_ID});
  assert.equal(res.status,400);
 });
 assert.equal(called,false);
});
test("verified route rejects unverified account token",async()=>{
 let called=false;
 await serverTest({verifiedTrading:{tradingEnabled:true,execute:async()=>{called=true;return success;}}},async base=>{
  assert.equal((await order(base,intent,"bad-token")).status,401);
 });
 assert.equal(called,false);
});
test("unconfigured verified dependencies fail closed without legacy pricing",async()=>{
 await serverTest({verifiedTrading:{}},async base=>{
  const res=await order(base);
  assert.equal(res.status,503);
  assert.equal((await res.json()).error,"Verified internal order unavailable");
 });
});
