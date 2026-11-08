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
 // Conversion is explicitly applied to a CNY-priced mainland share.
 const r = applyOrder(createAccount(10000), {side:"BUY",market:"CN",symbol:"600519",quantity:10,priceCents:100,fxUsdMicros:250000});
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
test("HK/MY remain unsupported while CN is ledger-eligible behind server quote policy",()=>{
 for(const market of ["HK","MY","RO"])
  assert.throws(()=>applyOrder(createAccount(100000),{side:"BUY",market,symbol:"X",quantity:1,priceCents:100}),/Invalid market/);
 const accepted=applyOrder(createAccount(100000),{side:"BUY",market:"CN",symbol:"600519",quantity:1,priceCents:100,fxUsdMicros:140000});
 assert.equal(accepted.positions["CN:600519"],1);
 assert.equal(accepted.orders[0].amountCents,14);
});
