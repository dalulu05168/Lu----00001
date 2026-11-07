import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";

test("home watchlist card trades the advertised symbol, not a stale default", async () => {
 const html=await readFile(new URL("../web/mobile.html",import.meta.url),"utf8");
 const dom=new JSDOM(html,{url:"https://nuvexapro.com/mobile.html"});
 const names=["window","document","sessionStorage","fetch","location"];
 const previous=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const inject=(name,value)=>Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
 const requests=[];
 const responses={
  "/api/account":{account:{id:"test-account",currency:"USD",cashCents:1234500},positions:[],orders:[]},
  "/api/watchlist":{items:[{market:"US",symbol:"MSFT",name:"Microsoft"}]},
  "/api/catalog":{items:[{market:"US",symbol:"AAPL",name:"Apple",itemType:"STOCK"},{market:"US",symbol:"MSFT",name:"Microsoft",itemType:"STOCK"}]},
  "/api/internal-products":{items:[],stockQuotesConfigured:false},
  "/api/internal-purchases":{positions:[],purchases:[],sales:[]},
  "/api/health":{pricingConnected:false,brokerConnected:false}
 };
 try{
  dom.window.scrollTo=()=>{};
  dom.window.sessionStorage.setItem("gsp_token","mobile-local-test-token");
  inject("window",dom.window);
  inject("document",dom.window.document);
  inject("sessionStorage",dom.window.sessionStorage);
  inject("location",{replace:()=>{throw Error("An authenticated local mobile test must not redirect")}});
  inject("fetch",async(url,options={})=>{
   requests.push({url,authorization:options.headers?.authorization});
   return new Response(JSON.stringify(responses[url]??{items:[]}),{status:200,headers:{"content-type":"application/json"}});
  });
  await import("../web/mobile.mjs?home-symbol-selection");
  let card;
  for(let i=0;i<80;i++){
   card=document.querySelector('.card[data-action="go-trade"][data-symbol="MSFT"]');
   if(card)break;
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.ok(card,"The home card should advertise the API watchlist symbol MSFT");
  assert.equal(card.dataset.market,"US");
  assert.equal(document.querySelector('#mobileNav [data-tab="home"] span:last-child').textContent,"首页");
  card.click();
  assert.ok(document.getElementById("mobileOrderForm"),"The home card should open the trade form");
  assert.equal(document.querySelector("#mobileScreen .hero-title strong").textContent,"MSFT","Trading must target the same instrument as the card");
  assert.ok(requests.some(r=>r.url==="/api/account"&&r.authorization==="Bearer mobile-local-test-token"),"Account is loaded using original session authorization");
  assert.equal(requests.some(r=>r.url==="/api/orders"),false,"Navigation alone must never create an order");
 }finally{
  for(const name of names){
   if(previous[name])Object.defineProperty(globalThis,name,previous[name]);
   else Reflect.deleteProperty(globalThis,name);
  }
  dom.window.close();
 }
});
