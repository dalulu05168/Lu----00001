import test from "node:test";
import assert from "node:assert/strict";
import {getUsStockQuote} from "../src/us-stock-quotes.mjs";

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
