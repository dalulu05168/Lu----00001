import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";
import {request} from "node:http";
import {createApi} from "../src/http-api.mjs";
const get=path=>readFile(new URL("../"+path,import.meta.url),"utf8");

test("independent mobile page fills browser and excludes all fake phone hardware",async()=>{
 const doc=new JSDOM(await get("web/mobile.html")).window.document;
 assert.equal(doc.querySelector('meta[name="viewport"]').content,"width=device-width,initial-scale=1,viewport-fit=cover");
 for(const id of ["mobileApp","mobileContent","mobileScreen","mobileNav","mobileSheet","mobileRefresh","mobileConnection"])assert.ok(doc.getElementById(id));
 assert.equal(doc.querySelectorAll("#mobileNav [data-tab]").length,5);
 assert.deepEqual([...doc.querySelectorAll("#mobileNav [data-tab]")].map(x=>x.dataset.tab),["home","market","trade","orders","account"]);
 assert.ok(!doc.querySelector(".sb,.isl,.status-bar,.dynamic-island,.phone-frame,.mock-phone"));
 assert.ok(!/fake battery|status.?bar|仿真手机|手机外壳/i.test(doc.body.textContent));
 assert.equal(doc.querySelector('script[type="module"]').getAttribute("src"),"/mobile.mjs");
});

test("mobile visual styles use full viewport safe area, no fixed phone size or device border",async()=>{
 const css=await get("web/mobile.css");
 assert.match(css,/min-height:100dvh/);
 assert.match(css,/safe-area-inset-bottom/);
 assert.match(css,/safe-area-inset-top/);
 assert.match(css,/--lime:#d7ff00/);
 assert.match(css,/--green:#34d17a/);
 assert.match(css,/--red:#ff6b5a/);
 assert.doesNotMatch(css,/(?:\.app|\.mobile-app)\s*\{[^}]*width:390px/s);
 assert.doesNotMatch(css,/(?:dynamic-island|phone-bezel|simulated-battery|statusbar)/i);
});

test("phone selection requires successful original login before redirect",async()=>{
 const html=await get("web/index.html");
 const source=await get("web/mobile-entry.mjs");
 assert.match(html,/src="\/mobile-entry\.mjs"/);
 assert.match(source,/sessionStorage\.getItem\("gsp_token"\)/);
 assert.match(source,/!desktop\.hidden&&gate\.hidden/);
 assert.match(source,/location\.replace\("\/mobile\.html"\)/);
 assert.match(source,/cn_view_mode/);
 assert.match(source,/matchMedia/);
});

test("mobile data and actions call live protected APIs, never use demo balances, orders or fabricated quotes",async()=>{
 const s=await get("web/mobile.mjs");
 for(const p of [
  'api("/account")','api("/watchlist")','"/account/analytics"','"/internal-products"',
  '"/internal-purchases"','"/requests?category=FUNDING"','["support","/support"]',
  'api("/stock-quote?market=US&symbol="','api("/orders"'
 ])assert.ok(s.includes(p),"Missing real endpoint "+p);
 assert.match(s,/stockQuoteConfigured/);
 assert.match(s,/pricingConnected/);
 assert.match(s,/idempotency-key/);
 assert.match(s,/Number\.isSafeInteger/);
 assert.match(s,/from "\.\/stock-chart\.mjs"/);
 assert.doesNotMatch(s,/(?:cash\s*:\s*998937|price\s*:\s*38\.53|orderCount\s*:\s*10)/);
 assert.match(s,/const esc=v=>/);
});

test("Render gateway routes frontend mobile static assets and keeps admin landing on separate host",async()=>{
 const server=createApi({db:{},resolveSession:async()=>null});
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const fetchHost=(path,host)=>new Promise((resolve,reject)=>{
  const req=request({hostname:"127.0.0.1",port:server.address().port,path,headers:{Host:host}},res=>{
   const a=[];res.on("data",x=>a.push(x));res.on("end",()=>resolve({status:res.statusCode,type:res.headers["content-type"],text:Buffer.concat(a).toString("utf8")}));
  });req.on("error",reject);req.end();
 });
 try{
  for(const [path,type] of [["/mobile.html","text/html"],["/mobile.css","text/css"],["/mobile.mjs","text/javascript"],["/mobile-entry.mjs","text/javascript"]]){
   const r=await fetchHost(path,"nuvexapro.com");
   assert.equal(r.status,200,path);
   assert.match(r.type,new RegExp(type));
   assert.ok(r.text.length>500);
  }
  const front=await fetchHost("/","nuvexapro.com");
  const admin=await fetchHost("/","admin.nuvexapro.com");
  assert.equal(front.status,200);assert.match(front.text,/id="entryGate"/);
  assert.equal(admin.status,200);assert.match(admin.text,/id="adminLoginForm"/);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(()=>resolve()));}
});
