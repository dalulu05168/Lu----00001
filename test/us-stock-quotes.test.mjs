import test from "node:test";
import assert from "node:assert/strict";
import {getUsStockHistory,getUsStockQuote} from "../src/us-stock-quotes.mjs";

const creds={keyId:"synthetic-id",secretKey:"synthetic-secret"};

test("historical prices require credentials and ordered bars for the requested stock",async()=>{
 const now=()=>1700000000000;
 const bars=[{t:new Date(now()-86400000).toISOString(),c:98.75},{t:new Date(now()).toISOString(),c:100.25}];
 const response=(symbol,body)=>async(url,opts)=>{
  assert.equal(url.pathname,"/v2/stocks/AAPL/bars");
  assert.equal(opts.headers["APCA-API-KEY-ID"],"synthetic-id");
  assert.equal(opts.headers["APCA-API-SECRET-KEY"],"synthetic-secret");
  return {ok:true,json:async()=>body};
 };
 const options={...creds,now,fetchImpl:response("AAPL",{symbol:"AAPL",bars})};
 assert.deepEqual((await getUsStockHistory("AAPL",options)).points,
  [{time:Date.parse(bars[0].t),price:98.75},{time:Date.parse(bars[1].t),price:100.25}]);
 await assert.rejects(getUsStockHistory("AAPL",{...options,keyId:undefined}),{statusCode:503});
 await assert.rejects(getUsStockHistory("AAPL",{...options,fetchImpl:response("AA",{symbol:"AA",bars})}),{statusCode:503});
 await assert.rejects(getUsStockHistory("AAPL",{...options,fetchImpl:response("AAPL",{symbol:"AAPL",bars:bars.toReversed()})}),{statusCode:503});
});

test("US quote requires credentials, matching symbol and a fresh trade",async()=>{
 const now=()=>1700000000000;
 const req={market:"US",symbol:"AA"};
 const response=body=>async()=>({ok:true,json:async()=>body});
 const fresh={symbol:"AA",trade:{p:102.12,t:new Date(now()-1000).toISOString()}};
 const options={...creds,now,fetchImpl:response(fresh)};
 assert.equal((await getUsStockQuote(req,options)).priceCents,10212);
 for(const settings of [{keyId:undefined},{fetchImpl:response({...fresh,symbol:"NEM"})},
   {fetchImpl:response({...fresh,trade:{...fresh.trade,t:new Date(now()-900000).toISOString()}})}]){
  await assert.rejects(getUsStockQuote(req,{...options,...settings}),error=>error.statusCode===503);
 }
 await assert.rejects(getUsStockQuote({...req,market:"HK"},options),error=>error.statusCode===503);
});
