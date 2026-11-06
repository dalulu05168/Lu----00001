import test from "node:test";
import assert from "node:assert/strict";
import {getUsStockHistory,getUsStockQuote,resolveOrderExecutionPrice} from "../src/us-stock-quotes.mjs";

test("historical prices require a key and come back sorted ascending regardless of provider order",async()=>{
 const now=()=>1700000000000;
 const day0="2023-11-13",day1="2023-11-14"; // two days before `now` (2023-11-15T06:13:20Z)
 // Twelve Data's own ordering isn't relied on: feed it newest-first and expect ascending output.
 const values=[{datetime:day1,close:"100.25"},{datetime:day0,close:"98.75"}];
 const response=body=>async url=>{
  assert.equal(url.searchParams.get("symbol"),"AAPL");
  assert.equal(url.searchParams.get("interval"),"1day");
  return {ok:true,json:async()=>body};
 };
 const options={apiKey:"synthetic",now,fetchImpl:response({status:"ok",values})};
 assert.deepEqual((await getUsStockHistory("AAPL",options)).points,
  [{time:Date.parse(day0+"T00:00:00Z"),price:98.75},{time:Date.parse(day1+"T00:00:00Z"),price:100.25}]);
 await assert.rejects(getUsStockHistory("AAPL",{...options,apiKey:undefined}),{statusCode:503});
 // Error responses (bad key, rate limit, unknown symbol) come back as status!=="ok".
 await assert.rejects(getUsStockHistory("AAPL",{...options,fetchImpl:response({status:"error",code:401,message:"bad key"})}),{statusCode:503});
 await assert.rejects(getUsStockHistory("AAPL",{...options,fetchImpl:response({status:"ok",values:[{datetime:day0,close:"1"}]})}),{statusCode:503});
 // A future-dated bar (clock skew or bad data) is rejected.
 await assert.rejects(getUsStockHistory("AAPL",{...options,fetchImpl:response({status:"ok",values:[
  {datetime:day0,close:"1"},{datetime:"2099-01-01",close:"2"}]})}),{statusCode:503});
});

test("US quote requires a key, US market and a price inside the staleness window",async()=>{
 const now=()=>1700000000000;
 const req={market:"US",symbol:"AA"};
 const response=body=>async()=>({ok:true,json:async()=>body});
 const quote={c:102.12,pc:101.0,t:now()/1000-5};
 const options={apiKey:"synthetic",now,fetchImpl:response(quote)};
 assert.equal((await getUsStockQuote(req,options)).priceCents,10212);
 // Finnhub's free /quote is a single-venue last-trade price that stops moving
 // outside market hours: a 15-minute-old trade (still well inside the trading
 // session) must be accepted, not treated as stale.
 const stillFresh=await getUsStockQuote(req,{...options,fetchImpl:response({...quote,t:now()/1000-900})});
 assert.equal(stillFresh.priceCents,10212);
 // Friday's close carried through a weekend must still be usable Monday.
 const overWeekend=await getUsStockQuote(req,{...options,fetchImpl:response({...quote,t:now()/1000-3*86400})});
 assert.equal(overWeekend.priceCents,10212);
 for(const settings of [{apiKey:undefined},{fetchImpl:response({...quote,c:0})},
   // Genuinely stale (older than any holiday weekend) is still rejected.
   {fetchImpl:response({...quote,t:now()/1000-9*86400})}]){
  await assert.rejects(getUsStockQuote(req,{...options,...settings}),error=>error.statusCode===503);
 }
 await assert.rejects(getUsStockQuote({...req,market:"HK"},options),error=>error.statusCode===503);
});

test("order execution price adapter returns the shape http-api.mjs expects and never contacts a broker",async()=>{
 const now=()=>1700000000000;
 const response=body=>async()=>({ok:true,json:async()=>body});
 const quote={c:55.25,pc:55.0,t:now()/1000-10};
 const options={apiKey:"synthetic",now,fetchImpl:response(quote)};
 const result=await resolveOrderExecutionPrice({market:"US",symbol:"MSFT"},options);
 assert.deepEqual(result,{priceCents:5525,fxUsdMicros:1000000,timestampMs:Math.floor(quote.t*1000)});
 // Unsupported markets surface as unavailable, not a fabricated price.
 await assert.rejects(resolveOrderExecutionPrice({market:"HK",symbol:"0700"},options),error=>error.statusCode===503);
});
