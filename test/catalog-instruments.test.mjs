import test from "node:test";
import assert from "node:assert/strict";
import { mergePublishedInstruments } from "../web/catalog-instruments.mjs";

const examples=[{market:"US",symbol:"AAPL",name:"Apple Inc."},{market:"HK",symbol:"0700",name:"Tencent"}];
const catalogue=[
 {market:"US",symbol:"AAPL",itemType:"STOCK",name:"Apple verified directory"},
 {market:"US",symbol:"NVDA",itemType:"STOCK",name:"NVIDIA"},
 {market:"HK",symbol:"2800",itemType:"FUND",name:"Tracker Fund"},
 {market:"US",symbol:"IPO1",itemType:"IPO",name:"Public offering"},
 {market:"RO",symbol:"BRD",itemType:"STOCK",name:"Unsupported market"}
];
test("published backend stock/fund items appear in the frontend selection",()=>{
 const result=mergePublishedInstruments(examples,catalogue,{authenticated:true,catalogLoaded:true,markets:["US","HK"]});
 assert.deepEqual(result.slice(0,3).map(x=>x.market+":"+x.symbol),["US:AAPL","US:NVDA","HK:2800"]);
 assert.equal(result[0].name,"Apple verified directory");
 assert.equal(result.filter(x=>x.symbol==="AAPL").length,1);
 assert.equal(result.some(x=>x.symbol==="IPO1"),false);
 assert.equal(result.some(x=>x.symbol==="BRD"),false);
 assert.equal(result.at(-1).name,"Tencent（示例）");
});
test("no session or uninitialized catalog preserves unverified examples",()=>{
 const anon=mergePublishedInstruments(examples,catalogue,{authenticated:false,catalogLoaded:true,markets:["US","HK"]});
 assert.equal(anon.length,2);
 assert.equal(anon[0].published,false);
 const loading=mergePublishedInstruments(examples,catalogue,{authenticated:true,catalogLoaded:false,markets:["US","HK"]});
 assert.equal(loading.length,2);
});
test("invalid and duplicate directory entries cannot poison frontend list",()=>{
 const result=mergePublishedInstruments(examples,[null,{market:"US",symbol:"",itemType:"STOCK",name:"none"},{market:"US",symbol:"NVDA",itemType:"STOCK",name:"Nvidia"},{market:"US",symbol:"NVDA",itemType:"STOCK",name:"Another"}],{authenticated:true,catalogLoaded:true,markets:["US"]});
 assert.equal(result.filter(x=>x.symbol==="NVDA").length,1);
 assert.equal(result[0].name,"Nvidia");
});
