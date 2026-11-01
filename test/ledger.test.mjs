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
test("cannot sell unowned shares", () => assert.throws(() => applyOrder(createAccount(), {side:"SELL",market:"HK",symbol:"0700",quantity:1,priceCents:100})));
test("market currency FX conversion", () => {
 const r = applyOrder(createAccount(10000), {side:"BUY",market:"MY",symbol:"1155",quantity:10,priceCents:100,fxUsdMicros:250000});
 assert.equal(r.cashCents,9750);
});
