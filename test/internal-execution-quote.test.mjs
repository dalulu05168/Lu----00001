import test from "node:test";
import assert from "node:assert/strict";
import {assertInternalExecutionQuote as validate} from "../src/internal-execution-quote.mjs";

const now=Date.parse("2026-11-08T01:00:00.000Z");
const buy={side:"BUY",market:"US",symbol:"AAPL",quantity:2};
const usQuote={market:"US",symbol:"AAPL",currency:"USD",priceCents:10125,
 timestampMs:now-2000,source:"LICENSED_TEST_FEED",entitled:true};
const authorizeUsage=({source,market,currency})=>({
 source,market,currency,customerDisplayAllowed:true,internalPricingAllowed:true,
 validUntilMs:now+600_000
});
const check=(extra={})=>validate({request:buy,quote:usQuote,authorizeUsage,now,...extra});
function rejected(input,reason) {
 assert.throws(()=>check(input),e=>e.statusCode===503&&e.reason===reason);
}

test("valid, licensed US quote produces precise server-side USD amount",()=>{
 const result=check();
 assert.equal(result.amountUsdCents,20250);
 assert.equal(result.fxUsdMicros,1000000);
 assert.equal(result.quoteTimestampMs,usQuote.timestampMs);
 assert.equal(result.side,"BUY");
 assert.equal(Object.isFrozen(result),true);
});
test("untrusted entitled flag cannot replace a reviewed usage license",()=>{
 rejected({authorizeUsage:undefined},"LICENSE_UNVERIFIED");
 rejected({authorizeUsage:()=>({entitled:true})},"LICENSE_UNVERIFIED");
 rejected({authorizeUsage:()=>({
  ...authorizeUsage({source:"LICENSED_TEST_FEED",market:"US",currency:"USD"}),
  internalPricingAllowed:false
 })},"LICENSE_UNVERIFIED");
 rejected({authorizeUsage:()=>({
  ...authorizeUsage({source:"ANOTHER_SOURCE",market:"US",currency:"USD"})
 })},"LICENSE_UNVERIFIED");
 rejected({authorizeUsage:()=>({
  ...authorizeUsage({source:"LICENSED_TEST_FEED",market:"US",currency:"USD"}),
  validUntilMs:now-1
 })},"LICENSE_UNVERIFIED");
});
test("stale, future, mismatched and nonpositive quotes fail before execution",()=>{
 rejected({quote:{...usQuote,timestampMs:now-61000}},"QUOTE_STALE");
 rejected({quote:{...usQuote,timestampMs:now+5001}},"QUOTE_STALE");
 rejected({quote:{...usQuote,symbol:"MSFT"}},"INSTRUMENT_OR_CURRENCY_MISMATCH");
 rejected({quote:{...usQuote,currency:"CNY"}},"INSTRUMENT_OR_CURRENCY_MISMATCH");
 rejected({quote:{...usQuote,priceCents:0}},"INVALID_PRICE");
 rejected({quote:{...usQuote,source:""}},"SOURCE_MISSING");
});
test("US/CN market constraint rejects unsupported symbols and malformed intent",()=>{
 for(const request of [
  {...buy,market:"HK"}, {...buy,symbol:"BAD SYMBOL"},
  {...buy,quantity:0},{...buy,side:"HOLD"},{...buy,quantity:2.5}
 ])assert.throws(()=>check({request}),e=>e.statusCode===400);
});
test("CNY internal execution requires a recent, explicit CNY/USD FX quote",()=>{
 const request={side:"SELL",market:"CN",symbol:"600519",quantity:3};
 const quote={...usQuote,market:"CN",symbol:"600519",currency:"CNY",priceCents:12345};
 const fxQuote={base:"CNY",quote:"USD",usdMicros:140_000,
  timestampMs:now-1000,source:"LICENSED_FX_TEST"};
 const result=check({request,quote,fxQuote});
 assert.equal(result.amountUsdCents,5185); // 12345 * 3 * 0.14 rounded once
 assert.equal(result.fxUsdMicros,140000);
 rejected({request,quote,fxQuote:undefined},"FX_UNAVAILABLE");
 rejected({request,quote,fxQuote:{...fxQuote,usdMicros:0}},"FX_UNAVAILABLE");
 rejected({request,quote,fxQuote:{...fxQuote,timestampMs:now-61000}},"FX_UNAVAILABLE");
});
test("BigInt not floating point computes and rejects overflow",()=>{
 const quote={...usQuote,priceCents:4};
 const result=check({request:{...buy,quantity:3},quote});
 assert.equal(result.amountUsdCents,12);
 rejected({request:{...buy,quantity:Number.MAX_SAFE_INTEGER}},"AMOUNT_OVERFLOW");
});
