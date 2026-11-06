import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";
import {createApi} from "../src/http-api.mjs";
import {request} from "node:http";

const get=path=>readFile(new URL("../"+path,import.meta.url),"utf8");
test("real front keeps login/register/account controls, order actions and underlying data containers",async()=>{
 const doc=new JSDOM(await get("web/index.html")).window.document;
 const ids=["entryGate","entryForm","entryEmail","entryPassword","entryInvite","authForm","authPanel",
   "accountSummary","accountCashValue","entryFeedback","overview","railLogout","orderForm",
   "stockChart","quotePrice","orderQuoteStatus","transactionRows","positions","orders",
   "savedWatchlist","watchlistToggle","catalogItems","serviceRequestsPanel",
   "fundingRequestForm","bankLinkRequestForm","startKycRequest","customerSupportForm","customerCommodityItems",
   "internalProductsPanel","accountAnalyticsStatus","transactionPageSummary"];
 for(const id of ids)assert.ok(doc.getElementById(id),"Missing live user control "+id);
 assert.equal([...doc.querySelectorAll("[id]")].length,new Set([...doc.querySelectorAll("[id]")].map(x=>x.id)).size);
 assert.equal(doc.querySelector("#entryGate .portal-logo img")?.getAttribute("src"),"/cn-login-logo.svg");
 assert.equal(doc.querySelector("#overview .sidebar-logo img")?.getAttribute("src"),"/cn-logo.svg");
 assert.equal(doc.querySelector("#overview #terminal-section")?.id,"terminal-section");
 assert.match(doc.querySelector("#entryGate").textContent,/模拟交易/);
});
test("actual frontend script still binds live APIs and market chart, not demo fixture data",async()=>{
 const js=await get("web/app.mjs");
 assert.match(js,/sessionStorage\.getItem\("gsp_token"\)/);
 assert.match(js,/request\("\/account"\)/);
 assert.match(js,/request\("\/watchlist"/);
 assert.match(js,/request\("\/orders"/);
 assert.match(js,/mountStockChart/);
 assert.match(await get("web/stock-chart.mjs"),/tradingview/i);
 assert.doesNotMatch(await get("web/index.html"),/\$256,430\.80|\$998,937\.60/);
});
test("CN front stylesheet uses the approved charcoal/lime design without hiding real data modules",async()=>{
 const [html,css]=await Promise.all([get("web/index.html"),get("web/front-cn-v3.css")]);
 assert.match(html,/href="\/front-cn-v3\.css"/);
 assert.match(css,/--cn-bg:#060705/);
 assert.match(css,/--cn-lime:#d7ff00/);
 assert.match(css,/--cn-up:#4fdd8f/);
 assert.match(css,/--cn-down:#ff5b50/);
 assert.match(css,/#transactions-section > \.primary-grid\{order:1/);
 assert.match(css,/#overview \.trade-board-side > \.order-panel\{order:1/);
 for(const id of ["account-section","serviceRequestsPanel","commodityCatalogPanel","customerSupportPanel"])
   assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(css,/prefers-reduced-motion:reduce/);
});
test("Render gateway exposes front CSS and logo without changing admin host routing",async()=>{
 const server=createApi({db:{},resolveSession:async()=>null});
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const fetchPath=(path,host)=>new Promise((resolve,reject)=>{
 const req=request({hostname:"127.0.0.1",port:server.address().port,path,method:"GET",headers:{Host:host}},res=>{
 const chunks=[];res.on("data",b=>chunks.push(b));
 res.on("end",()=>resolve({status:res.statusCode,type:res.headers["content-type"],body:Buffer.concat(chunks).toString("utf8")}));
 res.on("error",reject);
 });req.on("error",reject);req.end();
 });
 try{
  for(const path of ["/front-cn-v3.css","/cn-logo.svg","/cn-login-logo.svg"]){
    const response=await fetchPath(path,"nuvexapro.com");
    assert.equal(response.status,200,path);
    assert.match(response.type,path.endsWith(".css")?/text\/css/:/image\/svg\+xml/);
  }
  const front=await fetchPath("/","nuvexapro.com");
  assert.equal(front.status,200);
  assert.match(front.body,/id="entryForm"/);
  const admin=await fetchPath("/","admin.nuvexapro.com");
  assert.equal(admin.status,200);
  assert.match(admin.body,/id="adminLoginForm"/);
 }finally{
  server.closeAllConnections();
  await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
 }
});
