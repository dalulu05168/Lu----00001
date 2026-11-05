import test from "node:test";
import assert from "node:assert/strict";
import {getUsStockHistory,getUsStockQuote} from "../src/us-stock-quotes.mjs";

test("historical prices require a key and ordered candles for the requested stock",async()=>{
 const now=()=>1700000000000;
 const sec=now()/1000;
 const candles={s:"ok",t:[Math.floor(sec-86400),Math.floor(sec)],c:[98.75,100.25]};
 const response=body=>async url=>{
  assert.equal(url.searchParams.get("symbol"),"AAPL");
  return {ok:true,json:async()=>body};
 };
 const options={apiKey:"synthetic",now,fetchImpl:response(candles)};
 assert.deepEqual((await getUsStockHistory("AAPL",options)).points,
  [{time:candles.t[0]*1000,price:98.75},{time:candles.t[1]*1000,price:100.25}]);
 await assert.rejects(getUsStockHistory("AAPL",{...options,apiKey:undefined}),{statusCode:503});
 // Free keys return no_data for candles; that degrades to unavailable.
 await assert.rejects(getUsStockHistory("AAPL",{...options,fetchImpl:response({s:"no_data"})}),{statusCode:503});
 await assert.rejects(getUsStockHistory("AAPL",{...options,fetchImpl:response({s:"ok",t:[candles.t[1],candles.t[0]],c:[1,2]})}),{statusCode:503});
});

test("US quote requires a key, US market and a fresh price",async()=>{
 const now=()=>1700000000000;
 const req={market:"US",symbol:"AA"};
 const response=body=>async()=>({ok:true,json:async()=>body});
 const quote={c:102.12,pc:101.0,t:now()/1000-5};
 const options={apiKey:"synthetic",now,fetchImpl:response(quote)};
 assert.equal((await getUsStockQuote(req,options)).priceCents,10212);
 for(const settings of [{apiKey:undefined},{fetchImpl:response({...quote,c:0})},
   {fetchImpl:response({...quote,t:now()/1000-900})}]){
  await assert.rejects(getUsStockQuote(req,{...options,...settings}),error=>error.statusCode===503);
 }
 await assert.rejects(getUsStockQuote({...req,market:"HK"},options),error=>error.statusCode===503);
});
