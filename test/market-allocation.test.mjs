import test from "node:test";
import assert from "node:assert/strict";
import { summarizeMarketHoldings } from "../web/market-allocation.mjs";

test("market distribution is not populated for a signed-out user", () => {
  const result = summarizeMarketHoldings(null);
  assert.equal(result.available, false);
  assert.equal(result.total, 0);
  assert.equal(result.markets.US.count, 0);
  assert.equal(result.markets.HK.percent, 0);
});

test("market distribution uses actual distinct held instruments, not invented market prices", () => {
  const result = summarizeMarketHoldings([
    { market:"US", symbol:"AAPL", quantity:"2" },
    { market:"US", symbol:"MSFT", quantity:4 },
    { market:"HK", symbol:"0700", quantity:"12" },
    { market:"MY", symbol:"1155", quantity:1 }
  ]);
  assert.equal(result.available, true);
  assert.equal(result.total, 4);
  assert.deepEqual(Object.fromEntries(Object.entries(result.markets).map(([key,item])=>[key,item.count])), {US:2,HK:1,CN:0,MY:1});
  assert.equal(result.markets.US.percent, 50);
  assert.equal(result.markets.HK.percent, 25);
  assert.equal(result.markets.CN.percent, 0);
});

test("market distribution excludes malformed, zero, negative, unsupported and duplicate position records", () => {
  const result = summarizeMarketHoldings([
    {market:"US",symbol:"AAPL",quantity:2},
    {market:"US",symbol:"AAPL",quantity:2},
    {market:"US",symbol:"MSFT",quantity:0},
    {market:"HK",symbol:"0700",quantity:-3},
    {market:"EU",symbol:"ABC",quantity:4},
    {market:"CN",symbol:"600519",quantity:"3"},
    {market:"MY",symbol:"",quantity:2}
  ]);
  assert.equal(result.total,2);
  assert.equal(result.markets.US.count,1);
  assert.equal(result.markets.CN.count,1);
  assert.equal(result.markets.HK.count,0);
});

test("empty account is visibly distinct from signed-out user", () => {
  const result = summarizeMarketHoldings([]);
  assert.equal(result.available,true);
  assert.equal(result.total,0);
});
