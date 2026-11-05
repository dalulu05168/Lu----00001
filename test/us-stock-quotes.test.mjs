import test from "node:test";
import assert from "node:assert/strict";
import {getUsStockHistory,getUsStockQuote} from "../src/us-stock-quotes.mjs";

test("historical prices require display entitlement and ordered bars for the requested stock",async()=>{
 const now=()=>1700000000000;
 const results=[{t:now()-86400000,c:98.75},{t:now(),c:100.25}];
 const response=(ticker,bars)=>async url=>{
  assert.match(url.pathname,/\/AAPL\/range\/1\/day\//);
  return {ok:true,json:async()=>({status:"OK",ticker,results:bars})};
 };
 const options={apiKey:"synthetic",displayEntitled:true,now,fetchImpl:response("AAPL",results)};
 assert.deepEqual((await getUsStockHistory("AAPL",options)).points,
  [{time:results[0].t,price:98.75},{time:results[1].t,price:100.25}]);
 await assert.rejects(getUsStockHistory("AAPL",{...options,displayEntitled:false}),{statusCode:503});
 await assert.rejects(getUsStockHistory("AAPL",{...options,fetchImpl:response("AA",results)}),{statusCode:503});
 await assert.rejects(getUsStockHistory("AAPL",{...options,fetchImpl:response("AAPL",results.toReversed())}),{statusCode:503});
});

test("US quote requires entitlement, matching symbol and a fresh trade",async()=>{
 const now=()=>1700000000000;
 const req={market:"US",symbol:"AA"};
 const response=results=>async()=>({ok:true,json:async()=>({status:"OK",results})});
 const trade={T:"AA",p:102.12,t:now()*1e6,y:(now()-1000)*1e6};
 const options={apiKey:"synthetic",licensed:true,now,fetchImpl:response(trade)};
 assert.equal((await getUsStockQuote(req,options)).priceCents,10212);
 for(const settings of [{licensed:false},{fetchImpl:response({...trade,T:"NEM"})},
   {fetchImpl:response({...trade,y:(now()-900000)*1e6})}]){
  await assert.rejects(getUsStockQuote(req,{...options,...settings}),error=>error.statusCode===503);
 }
 await assert.rejects(getUsStockQuote({...req,market:"HK"},options),error=>error.statusCode===503);
});
