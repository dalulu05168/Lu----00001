import test from "node:test";
import assert from "node:assert/strict";
import { createAccount, applyOrder } from "../src/ledger.mjs";
test("internal buy updates cash and position", () => {
  const result = applyOrder(createAccount(100000), { side:"BUY", market:"US", symbol:"AAPL", quantity:2, priceCents:10000 });
  assert.equal(result.cashCents,80000);
  assert.equal(result.positions["US:AAPL"],2);
  assert.equal(result.orders[0].execution,"INTERNAL_ONLY");
});
test("insufficient cash rejects order", () => assert.throws(() => applyOrder(createAccount(100), {side:"BUY",market:"US",symbol:"AAPL",quantity:1,priceCents:10000})));
test("cannot sell unowned shares", () => assert.throws(() => applyOrder(createAccount(), {side:"SELL",market:"US",symbol:"AAPL",quantity:1,priceCents:100}),/Insufficient position/));
test("market currency FX conversion", () => {
 // HK/CN/MY were withdrawn as supported markets; the FX arithmetic under
 // test is market-agnostic, so this exercises it against the only (US)
 // market applyOrder accepts today.
 const r = applyOrder(createAccount(10000), {side:"BUY",market:"US",symbol:"AAPL",quantity:10,priceCents:100,fxUsdMicros:250000});
 assert.equal(r.cashCents,9750);
});

test("uses exact integer arithmetic for multi-currency order totals",()=>{
 const initial=createAccount(10_000);
 const result=applyOrder(initial,{side:"BUY",market:"US",symbol:"AAPL",quantity:3,priceCents:101,fxUsdMicros:125_000});
 assert.equal(result.orders[0].amountCents,38);
 assert.equal(result.cashCents,9962);
});
test("rejects multiplication overflow before amount enters account",()=>{
 const initial=createAccount(Number.MAX_SAFE_INTEGER);
 assert.throws(()=>applyOrder(initial,{side:"BUY",market:"US",symbol:"AAPL",quantity:Number.MAX_SAFE_INTEGER,priceCents:Number.MAX_SAFE_INTEGER,fxUsdMicros:Number.MAX_SAFE_INTEGER}),/Amount overflow/);
});
test("HK/CN/MY are withdrawn: no working free quote source was found for them",()=>{
 for(const market of ["HK","CN","MY"])
  assert.throws(()=>applyOrder(createAccount(100000),{side:"BUY",market,symbol:"X",quantity:1,priceCents:100}),/Invalid market/);
});
