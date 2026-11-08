import test from "node:test";
import assert from "node:assert/strict";
import {valueInternalStockPortfolio as value} from "../src/internal-stock-portfolio-valuation.mjs";

const now=Date.parse("2026-11-08T01:00:00Z");
const authorizeUsage=({market,source,currency})=>({
 market,source,currency,customerDisplayAllowed:true,internalPricingAllowed:true,
 validUntilMs:now+60000,reviewReference:"EQUITY-REVIEW-TEST"
});
const authorizeFxUsage=({base,quote,source})=>({
 base,quote,source,internalPricingAllowed:true,validUntilMs:now+60000,
 reviewReference:"FX-REVIEW-TEST"
});
const snapshot=(positions=[{market:"US",symbol:"AAPL",quantity:"3"}],cashCents=10000)=>({
 account:{currency:"USD",cashCents},positions
});
const analytics=(positionCostCents=24000,holdingCount=1)=>({
 method:"FIFO",currency:"USD",historyAvailable:true,reason:null,
 realizedPnlCents:5000,positionCostCents,holdingCount
});
const provider=async({market,symbol})=>({market,symbol,
 currency:market==="CN"?"CNY":"USD",priceCents:10000,
 timestampMs:now-2000,source:"TEST_AUTHORIZED_FEED"});
const input=(more={})=>({
 accountSnapshot:snapshot(),analytics:analytics(),resolveQuote:provider,authorizeUsage,now,...more
});

test("FIFO realized P/L comes from committed analytics; unrealized uses actual licensed price",async()=>{
 const r=await value(input());
 assert.equal(r.valuationAvailable,true);
 assert.equal(r.realizedPnlCents,5000);
 assert.equal(r.marketValueCents,30000);
 assert.equal(r.unrealizedPnlCents,6000);
 assert.equal(r.portfolioValueCents,40000);
 assert.equal(r.quotes.length,1);
 assert.equal(r.quotes[0].quoteTimestampMs,now-2000);
});
test("a genuine empty position page returns real cash rather than invented market value",async()=>{
 const r=await value(input({
  accountSnapshot:snapshot([],12345),analytics:analytics(0,0),
  resolveQuote:undefined,authorizeUsage:undefined
 }));
 assert.equal(r.valuationAvailable,true);
 assert.equal(r.marketValueCents,0);
 assert.equal(r.portfolioValueCents,12345);
 assert.equal(r.unrealizedPnlCents,0);
});
test("stale price, disabled license or quote failure makes all valuation numbers unknown",async()=>{
 for(const opts of [
  {resolveQuote:async x=>({...await provider(x),timestampMs:now-62000})},
  {authorizeUsage:()=>({entitled:true})},
  {resolveQuote:async()=>{throw Error("offline");}},
  {resolveQuote:undefined}
 ]){
  const r=await value(input(opts));
  assert.equal(r.valuationAvailable,false);
  assert.equal(r.reason,"QUOTE_UNAVAILABLE");
  assert.equal(r.unrealizedPnlCents,null);
  assert.equal(r.portfolioValueCents,null);
  assert.equal(r.marketValueCents,null);
  assert.equal(r.realizedPnlCents,5000);
 }
});
test("unreconciled history and stale snapshot must not return a plausible portfolio",async()=>{
 for(const opts of [
  {analytics:{...analytics(),historyAvailable:false}},
  {analytics:{...analytics(),method:"UNKNOWN"}},
  {accountSnapshot:snapshot([{market:"US",symbol:"AAPL",quantity:"2"},
   {market:"US",symbol:"MSFT",quantity:"1"}])},
  {accountSnapshot:snapshot([{market:"US",symbol:"AAPL",quantity:"3"},
   {market:"US",symbol:"AAPL",quantity:"1"}])},
  {accountSnapshot:snapshot([{market:"PRODUCT",symbol:"fund-1",quantity:"1"}])},
  {accountSnapshot:snapshot([{market:"US",symbol:"AAPL",quantity:"invalid"}])}
 ]){
  const r=await value(input(opts));
  assert.equal(r.valuationAvailable,false);
  assert.equal(r.portfolioValueCents,null);
 }
});
test("multiple US/CN holdings are valued in USD using verified CNY/USD conversion",async()=>{
 const rows=[{market:"US",symbol:"AAPL",quantity:"1"},{market:"CN",symbol:"600519",quantity:"2"}];
 const r=await value(input({
  accountSnapshot:snapshot(rows,10000),
  analytics:analytics(12000,2),
  authorizeFxUsage,resolveFxQuote:async()=>({base:"CNY",quote:"USD",usdMicros:140000,
   timestampMs:now-2000,source:"TEST_FX"}),
 }));
 // US: $100, CN: 2*100 CNY @ $0.14 = $28
 assert.equal(r.valuationAvailable,true);
 assert.equal(r.marketValueCents,12800);
 assert.equal(r.unrealizedPnlCents,800);
 assert.equal(r.portfolioValueCents,22800);
});
