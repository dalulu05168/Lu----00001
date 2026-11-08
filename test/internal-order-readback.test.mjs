import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {getVerifiedInternalOrderReceipt as read} from "../src/internal-order-readback.mjs";
const accountId=randomUUID(),orderId=randomUUID();
const createdAt=new Date("2026-11-08T01:00:02.000Z");
const quoteAt=new Date("2026-11-08T01:00:00.000Z");
const original={
 id:orderId,market:"US",symbol:"AAPL",side:"BUY",quantity:"2",
 price_cents:"10000",fx_usd_micros:"1000000",amount_usd_cents:"20000",
 execution_type:"INTERNAL_ONLY",created_at:createdAt,delta_cents:"-20000",
 balance_after_cents:"80000",quote_currency:"USD",quote_price_cents:"10000",
 quote_at:quoteAt,quote_source:"AUTHORIZED_TEST",quote_license_ref:"reviewed",
 evidenced_fx_usd_micros:"1000000",fx_at:null,fx_source:null,
 fx_license_ref:null,session_rule_ref:"trading-hours-rule"
};
function fixture(row=original){
 const queries=[];
 const client={async query(sql,params){
  queries.push({sql,params});
  if(sql.startsWith("SELECT o.id"))return {rows:row?[row]:[]};
  return {rows:[]};
 },release(){}};
 return {db:{connect:async()=>client},queries};
}
test("readback verifies exact committed cash delta and quote evidence in a read-only snapshot",async()=>{
 const {db,queries}=fixture();
 const r=await read(db,accountId,orderId);
 assert.equal(r.amountUsdCents,20000);
 assert.equal(r.balanceAfterCents,80000);
 assert.equal(r.cashDeltaCents,-20000);
 assert.equal(r.quoteTimestampMs,quoteAt.getTime());
 assert.match(queries[0].sql,/REPEATABLE READ READ ONLY/);
 const q=queries.find(x=>x.sql.startsWith("SELECT o.id"));
 assert.deepEqual(q.params,[accountId,orderId]);
 assert.equal(queries.at(-1).sql,"COMMIT");
});
test("CNY/USD evidence reconciles with the native quote and rounded USD fill",async()=>{
 const r=await read(fixture({
  ...original,market:"CN",symbol:"600519",side:"SELL",
  quantity:"2",price_cents:"20000",quote_price_cents:"20000",
  quote_currency:"CNY",fx_usd_micros:"140000",evidenced_fx_usd_micros:"140000",
  amount_usd_cents:"5600",delta_cents:"5600",fx_at:quoteAt,
  fx_source:"FX_TEST",fx_license_ref:"reviewed-fx"
 }).db,accountId,orderId);
 assert.equal(r.fxUsdMicros,140000);
 assert.equal(r.amountUsdCents,5600);
 assert.equal(r.execution,"INTERNAL_ONLY");
});
test("mismatched ledger, amount, source or missing records never become success",async()=>{
 for(const [row,reason] of [
  [null,"ORDER_NOT_FOUND"],
  [{...original,delta_cents:"-19999"},"CASH_LEDGER_MISMATCH"],
  [{...original,amount_usd_cents:"19999"},"ORDER_AMOUNT_MISMATCH"],
  [{...original,quote_source:null},"EVIDENCE_UNAVAILABLE"],
  [{...original,quote_price_cents:"9999"},"EVIDENCE_MISMATCH"],
  [{...original,quote_at:new Date("2026-11-07T00:00:00Z")},"QUOTE_TIMESTAMP_MISMATCH"]
 ]){
  const {db,queries}=fixture(row);
  await assert.rejects(read(db,accountId,orderId),e=>e.reason===reason);
  assert.equal(queries.at(-1).sql,"ROLLBACK");
 }
});
