import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {postVerifiedInternalOrder} from "../src/internal-order-http-adapter.mjs";

const accountId=randomUUID(),id=randomUUID();
const body={side:"BUY",market:"US",symbol:"AAPL",quantity:2};
const receipt={
 id,side:"BUY",market:"US",symbol:"AAPL",quantity:2,
 unitPriceCents:10000,fxUsdMicros:1000000,amountUsdCents:20000,
 execution:"INTERNAL_ONLY",cashDeltaCents:-20000,
 quoteSource:"SERVER_TEST",quoteTimestampMs:Date.parse("2026-11-08T01:00:00Z"),
 quoteCurrency:"USD"
};
const confirmed={
 replayed:false,order:{
  id,...body,priceCents:10000,fxUsdMicros:1000000,
  amountCents:20000,execution:"INTERNAL_ONLY"
 },receipt,quote:{priceCents:10000,currency:"USD",source:"SERVER_TEST",
 timestampMs:receipt.quoteTimestampMs}
};
function call(overrides={}){
 return postVerifiedInternalOrder({
  db:{},session:{accountId},idempotencyKey:"test-unique-key",body,
  tradingEnabled:true,
  execute:async options=>{assert.equal(options.accountId,accountId);return confirmed;},
  ...overrides
 });
}
test("valid server-owned trade result maps to existing order HTTP shape and 201/200",async()=>{
 const first=await call();
 assert.equal(first.status,201);
 assert.equal(first.body.order.id,id);
 const replay=await call({execute:async()=>({...confirmed,replayed:true})});
 assert.equal(replay.status,200);
 assert.equal(replay.body.receipt.id,id);
});
test("account ID is solely inherited from authenticated session, not request JSON",async()=>{
 let invoked=0;
 await assert.rejects(call({body:{...body,accountId:randomUUID()},
  execute:async()=>{invoked++;return confirmed;}}),
  e=>e.statusCode===400);
 await assert.rejects(call({session:{adminVerified:true,accountId},
  execute:async()=>{invoked++;return confirmed;}}),
  e=>e.statusCode===403);
 await assert.rejects(call({session:{accountId:"nonsense"},
  execute:async()=>{invoked++;return confirmed;}}),
  e=>e.statusCode===401);
 await assert.rejects(call({session:undefined,
  execute:async()=>{invoked++;return confirmed;}}),
  e=>e.statusCode===401);
 assert.equal(invoked,0);
});
test("browser cannot submit client price, FX, source, or unexpected fields",async()=>{
 for(const field of ["priceCents","fxUsdMicros","quoteSource","marketPrice","brokerOrderId"]){
  await assert.rejects(call({body:{...body,[field]:100}}),e=>e.statusCode===400);
 }
 await assert.rejects(call({idempotencyKey:"short"}),e=>e.statusCode===400);
 await assert.rejects(call({body:[]}),e=>e.statusCode===400);
});
test("response is never successful without verified matching committed order and receipt",async()=>{
 const corrupt=[
  null,
  {...confirmed,order:{...confirmed.order,id:""}},
  {...confirmed,order:{...confirmed.order,side:"SELL"}},
  {...confirmed,order:{...confirmed.order,quantity:3}},
  {...confirmed,order:{...confirmed.order,execution:"BROKER"}},
  {...confirmed,order:{...confirmed.order,amountCents:19999}},
  {...confirmed,receipt:undefined},
  {...confirmed,receipt:{...receipt,id:randomUUID()}},
  {...confirmed,receipt:{...receipt,amountUsdCents:19999}},
  {...confirmed,receipt:{...receipt,cashDeltaCents:-19999}},
  {...confirmed,receipt:{...receipt,side:"SELL"}},
  {...confirmed,receipt:{...receipt,fxUsdMicros:500000}},
  {...confirmed,receipt:{...receipt,unitPriceCents:9999}},
  {...confirmed,receipt:{...receipt,quoteSource:"OTHER"}},
  {...confirmed,quote:{...confirmed.quote,priceCents:9999}},
  {...confirmed,quote:{...confirmed.quote,currency:"CNY"}},
 ];
 for(const response of corrupt)
  await assert.rejects(call({execute:async()=>response}),
   e=>e.statusCode===503 && /readback unavailable/.test(e.message));
});
test("server-side execution failures propagate with their status; no success shape is synthesized",async()=>{
 for(const statusCode of [400,403,409,503]){
  const error=Object.assign(new Error("trade denied"),{statusCode});
  await assert.rejects(call({execute:async()=>{throw error;}}),e=>e===error);
 }
});

test("explicit server kill switch blocks an injected executor before any write",async()=>{
 for(const tradingEnabled of [undefined,null,false,"true",1,0]){
  let invoked=0;
  await assert.rejects(call({tradingEnabled,execute:async()=>{invoked++;return confirmed;}}),
    e=>e.statusCode===503);
  assert.equal(invoked,0);
 }
});
