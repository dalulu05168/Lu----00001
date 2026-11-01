import test from "node:test";
import assert from "node:assert/strict";
import {validateQuote,createReadOnlyPricingGateway} from "../src/market-data.mjs";
const now=1_800_000_000_000;
const quote={market:"US",symbol:"AAPL",priceCents:10000,fxUsdMicros:1000000,timestampMs:now,source:"licensed-feed",entitled:true};
test("valid licensed fresh quote accepted",()=>assert.equal(validateQuote(quote,{now}).priceCents,10000));
test("stale quote rejected",()=>assert.throws(()=>validateQuote({...quote,timestampMs:now-61000},{now}),/Stale quote/));
test("missing entitlement rejected",()=>assert.throws(()=>validateQuote({...quote,entitled:false},{now}),/entitlement/));
test("quote provenance required",()=>assert.throws(()=>validateQuote({...quote,source:""},{now}),/provenance/));
test("gateway rejects instrument mismatch",async()=>{
 const gateway=createReadOnlyPricingGateway({provider:{getQuote:async()=>quote},now:()=>now});
 await assert.rejects(gateway({market:"US",symbol:"MSFT"}),/mismatch/);
});
