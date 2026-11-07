import test from "node:test";
import assert from "node:assert/strict";
import { MARKET_CODES, summarizeMarketHoldings } from "../web/market-allocation.mjs";

test("only US and CN market allocation models are exposed", () => {
  assert.deepEqual(MARKET_CODES, ["US","CN"]);
  const result=summarizeMarketHoldings(null);
  assert.equal(result.available,false);
  assert.equal(result.total,0);
  assert.deepEqual(Object.keys(result.markets),["US","CN"]);
});

test("counts only unique held US and CN instruments", () => {
  const result=summarizeMarketHoldings([
    {market:"US",symbol:"AAPL",quantity:"2"},
    {market:"US",symbol:"MSFT",quantity:4},
    {market:"CN",symbol:"600519",quantity:12},
    {market:"HK",symbol:"0700",quantity:12},
    {market:"MY",symbol:"1155",quantity:1}
  ]);
  assert.equal(result.available,true);
  assert.equal(result.total,3);
  assert.deepEqual(Object.fromEntries(Object.entries(result.markets).map(([key,value])=>[key,value.count])),{US:2,CN:1});
  assert.equal(result.markets.US.percent,66.7);
  assert.equal(result.markets.CN.percent,33.3);
  assert.equal(result.markets.HK,undefined);
  assert.equal(result.markets.MY,undefined);
});

test("ignores malformed, repeated, non-positive and unsupported positions",()=>{
  const result=summarizeMarketHoldings([
    {market:"US",symbol:"AAPL",quantity:2},
    {market:"US",symbol:"AAPL",quantity:2},
    {market:"US",symbol:"MSFT",quantity:0},
    {market:"HK",symbol:"0700",quantity:4},
    {market:"MY",symbol:"1155",quantity:4},
    {market:"EU",symbol:"ABC",quantity:4},
    {market:"CN",symbol:"600519",quantity:"3"},
    {market:"CN",symbol:"",quantity:2}
  ]);
  assert.equal(result.total,2);
  assert.equal(result.markets.US.count,1);
  assert.equal(result.markets.CN.count,1);
});

test("empty account remains distinct from a signed-out user",()=>{
  const result=summarizeMarketHoldings([]);
  assert.equal(result.available,true);
  assert.equal(result.total,0);
});
