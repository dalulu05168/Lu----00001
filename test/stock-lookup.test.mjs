import test from "node:test";
import assert from "node:assert/strict";
import {lookupStocks} from "../src/stock-lookup.mjs";

const emptyCatalog={query:async()=>({rows:[]})};
test("reference lookup covers each supported market and preserves numeric codes",async()=>{
  for(const [code,market,symbol] of [["aapl","US","AAPL"],["700","HK","0700"],["000001","CN","000001"],["1155","MY","1155"],["brd","RO","BRD"]]){
    const result=await lookupStocks(emptyCatalog,code,{apiKey:""});
    assert.equal(result.provider,"unconfigured");
    assert.ok(result.items.some(item=>item.market===market&&item.symbol===symbol&&item.exchange));
  }
  await assert.rejects(lookupStocks(emptyCatalog,"%_"),error=>error.statusCode===400);
});

test("directory lookup filters market and asset type and retains local results on failure",async()=>{
  const stock={symbol:"700",instrument_name:"Tencent Holdings",exchange:"HKEX",mic_code:"XHKG",instrument_type:"Common Stock"};
  const result=await lookupStocks(emptyCatalog,"0700",{apiKey:"synthetic-key",fetchImpl:async(url,options)=>{
    assert.equal(url.searchParams.get("symbol"),"0700");
    assert.equal(url.searchParams.get("apikey"),"synthetic-key");
    assert.equal(options.redirect,"error");
    return {ok:true,json:async()=>({data:[stock,{...stock,mic_code:"XTKS"},{...stock,symbol:"07001",instrument_type:"ETF"}]})};
  }});
  assert.equal(result.provider,"available");
  assert.deepEqual(result.items,[{market:"HK",symbol:"0700",name:"Tencent Holdings",exchange:"HKEX",source:"provider"}]);
  const fallback=await lookupStocks(emptyCatalog,"0700",{apiKey:"synthetic-key",fetchImpl:async()=>({ok:false,json:async()=>({})})});
  assert.equal(fallback.provider,"unavailable");
  assert.equal(fallback.items[0].source,"reference");
});
