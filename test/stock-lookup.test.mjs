import test from "node:test";
import assert from "node:assert/strict";
import {lookupStocks} from "../src/stock-lookup.mjs";

const emptyCatalog={query:async()=>({rows:[]})};
test("reference lookup covers each supported market (HK/CN/MY withdrawn)",async()=>{
  for(const [code,market,symbol] of [["aapl","US","AAPL"],["nem","US","NEM"],["brd","RO","BRD"]]){
    const result=await lookupStocks(emptyCatalog,code,{apiKey:""});
    assert.equal(result.provider,"unconfigured");
    assert.ok(result.items.some(item=>item.market===market&&item.symbol===symbol&&item.exchange));
  }
  // Withdrawn markets have no local reference entry to find at all.
  for(const code of ["700","000001","1155"]){
    const result=await lookupStocks(emptyCatalog,code,{apiKey:""});
    assert.ok(!result.items.some(item=>["HK","CN","MY"].includes(item.market)));
  }
  await assert.rejects(lookupStocks(emptyCatalog,"%_"),error=>error.statusCode===400);
});

test("reference lookup still handles a leading-zero numeric code via the catalog path",async()=>{
  const catalog={query:async()=>({rows:[{market:"US",symbol:"000123",display_name:"Zero-padded Test Co"}]})};
  const result=await lookupStocks(catalog,"123",{apiKey:""});
  assert.ok(result.items.some(item=>item.market==="US"&&item.symbol==="000123"&&item.source==="catalog"));
});

test("directory lookup filters market, asset type and withdrawn exchanges, retains local results on failure",async()=>{
  // TSLA doesn't prefix-match anything in the (now smaller) local reference list.
  const stock={symbol:"TSLA",instrument_name:"Tesla, Inc.",exchange:"NASDAQ",mic_code:"XNAS",instrument_type:"Common Stock"};
  const result=await lookupStocks(emptyCatalog,"TSLA",{apiKey:"synthetic-key",fetchImpl:async(url,options)=>{
    assert.equal(url.searchParams.get("symbol"),"TSLA");
    assert.equal(url.searchParams.get("apikey"),"synthetic-key");
    assert.equal(options.redirect,"error");
    // XHKG (HK) is a withdrawn exchange: this result must be filtered out
    // the same way an unmapped mic_code or a non-stock instrument_type is.
    return {ok:true,json:async()=>({data:[stock,{...stock,mic_code:"XHKG",symbol:"0700"},{...stock,symbol:"TSLAX",instrument_type:"ETF"}]})};
  }});
  assert.equal(result.provider,"available");
  assert.deepEqual(result.items,[{market:"US",symbol:"TSLA",name:"Tesla, Inc.",exchange:"NASDAQ",source:"provider"}]);
  const fallback=await lookupStocks(emptyCatalog,"TSLA",{apiKey:"synthetic-key",fetchImpl:async()=>({ok:false,json:async()=>({})})});
  assert.equal(fallback.provider,"unavailable");
  assert.deepEqual(fallback.items,[]);
});
