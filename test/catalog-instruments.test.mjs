import test from "node:test";
import assert from "node:assert/strict";
import { mergePublishedInstruments } from "../web/catalog-instruments.mjs";

const examples=[{market:"US",symbol:"AAPL",name:"Apple Inc."},{market:"CN",symbol:"600519",name:"贵州茅台"}];
const catalogue=[
  {market:"US",symbol:"AAPL",itemType:"STOCK",name:"Apple verified directory"},
  {market:"US",symbol:"NVDA",itemType:"STOCK",name:"NVIDIA"},
  {market:"CN",symbol:"000001",itemType:"FUND",name:"平安银行"},
  {market:"HK",symbol:"0700",itemType:"STOCK",name:"Unsupported market"},
  {market:"MY",symbol:"1155",itemType:"FUND",name:"Unsupported market"},
  {market:"US",symbol:"IPO1",itemType:"IPO",name:"Public offering"},
  {market:"RO",symbol:"BRD",itemType:"STOCK",name:"Unsupported market"}
];
test("only US/CN published stock and fund items appear",()=>{
 const result=mergePublishedInstruments(examples,catalogue,{authenticated:true,catalogLoaded:true,markets:["US","CN","HK","MY"]});
 assert.deepEqual(result.slice(0,3).map(x=>x.market+":"+x.symbol),["US:AAPL","US:NVDA","CN:000001"]);
 assert.equal(result[0].name,"Apple verified directory");
 assert.equal(result.filter(x=>x.symbol==="AAPL").length,1);
 assert.equal(result.some(x=>["HK","MY","RO"].includes(x.market)),false);
 assert.equal(result.some(x=>x.symbol==="IPO1"),false);
 assert.equal(result.at(-1).name,"贵州茅台（示例）");
});
test("uninitialized catalog preserves only supported fallback instruments",()=>{
 const anon=mergePublishedInstruments([...examples,{market:"HK",symbol:"0700",name:"Old stock"}],catalogue,{authenticated:false,catalogLoaded:true,markets:["US","CN","HK"]});
 assert.equal(anon.length,2);
 assert.equal(anon[0].published,false);
 const loading=mergePublishedInstruments(examples,catalogue,{authenticated:true,catalogLoaded:false,markets:["US","CN"]});
 assert.equal(loading.length,2);
});
test("duplicate and malformed entries cannot poison the picker",()=>{
 const result=mergePublishedInstruments(examples,[null,{market:"US",symbol:"",itemType:"STOCK",name:"none"},{market:"US",symbol:"NVDA",itemType:"STOCK",name:"Nvidia"},{market:"US",symbol:"NVDA",itemType:"STOCK",name:"Another"}],{authenticated:true,catalogLoaded:true,markets:["US","CN"]});
 assert.equal(result.filter(x=>x.symbol==="NVDA").length,1);
 assert.equal(result[0].name,"Nvidia");
});
