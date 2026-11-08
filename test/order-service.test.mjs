import test from "node:test";
import assert from "node:assert/strict";
import { placeInternalOrder } from "../src/order-service.mjs";
function fixture({cash=100000,held=0,existing=[]}={}) {
 const calls=[];let released=false;
 const client={
  async query(sql,params=[]) {
   calls.push({sql,params});
   if(sql.startsWith("SELECT cash_cents"))return {rows:[{cash_cents:cash}]};
   if(sql.startsWith("SELECT * FROM orders"))return {rows:existing};
   if(sql.startsWith("SELECT market,symbol"))return {rows:held?[{market:"US",symbol:"AAPL",quantity:held}]:[]};
   return {rows:[]};
  },release(){released=true;}
 };
 return {db:{async connect(){return client}},calls,get released(){return released}};
}
const buy={side:"BUY",market:"US",symbol:"AAPL",quantity:2,priceCents:10000};
test("commits cash, position, order and ledger atomically",async()=>{
 const f=fixture();const r=await placeInternalOrder(f.db,"account","unique-key-123",buy,"order-1");
 assert.equal(r.cashCents,80000);assert.equal(r.position,2);assert.equal(r.order.execution,"INTERNAL_ONLY");
 assert.equal(f.calls.filter(c=>c.sql==="COMMIT").length,1);
 assert.equal(f.calls.filter(c=>c.sql.startsWith("INSERT INTO cash_ledger")).length,1);
 assert.equal(f.released,true);
});
test("idempotent replay does not create new order",async()=>{
 const f=fixture({existing:[{id:"existing",side:"BUY",market:"US",symbol:"AAPL",quantity:2,price_cents:"10000"}]});
 const r=await placeInternalOrder(f.db,"account","unique-key-123",buy,"new-id");
 assert.equal(r.replayed,true);assert.equal(r.order.id,"existing");
 assert.equal(f.calls.some(c=>c.sql.startsWith("INSERT INTO orders")),false);
});
test("invalid order rolls back and releases client",async()=>{
 const f=fixture({cash:100});
 await assert.rejects(placeInternalOrder(f.db,"account","unique-key-123",buy,"order-1"),/Insufficient funds/);
 assert.equal(f.calls.filter(c=>c.sql==="ROLLBACK").length,1);assert.equal(f.released,true);
});
test("cannot sell beyond position",async()=>{
 const f=fixture({held:1});
 await assert.rejects(placeInternalOrder(f.db,"account","unique-key-123",{...buy,side:"SELL"},"order-1"),/Insufficient position/);
 assert.equal(f.calls.some(c=>c.sql==="ROLLBACK"),true);
});

test("conflicting reuse of an order key is rejected without a second ledger write",async()=>{
 for(const changed of [
  {...buy,side:"SELL"}, {...buy,market:"CN"},
  {...buy,symbol:"MSFT"}, {...buy,quantity:3}
 ]){
  const f=fixture({existing:[{id:"existing",side:"BUY",market:"US",symbol:"AAPL",quantity:"2"}]});
  await assert.rejects(
   placeInternalOrder(f.db,"account","unique-key-123",changed,"new-order"),
   e=>e.statusCode===409 && /Idempotency key/.test(e.message)
  );
  assert.equal(f.calls.filter(c=>c.sql==="ROLLBACK").length,1);
  assert.equal(f.calls.some(c=>c.sql.startsWith("INSERT INTO orders")),false);
  assert.equal(f.calls.some(c=>c.sql.startsWith("INSERT INTO cash_ledger")),false);
  assert.equal(f.released,true);
 }
});
test("retry after a market price update replays original fill without altering cash",async()=>{
 const original={id:"original-id",side:"BUY",market:"US",symbol:"AAPL",quantity:"2",price_cents:"10000"};
 const f=fixture({existing:[original],cash:80000,held:2});
 const result=await placeInternalOrder(f.db,"account","unique-key-123",
  {...buy,priceCents:11500},"new-id");
 assert.equal(result.replayed,true);
 assert.deepEqual(result.order,original);
 assert.equal(f.calls.some(c=>c.sql.startsWith("UPDATE accounts")),false);
 assert.equal(f.calls.filter(c=>c.sql==="COMMIT").length,1);
});
