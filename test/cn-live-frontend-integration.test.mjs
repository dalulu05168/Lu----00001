import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";
import {createApi} from "../src/http-api.mjs";
import {request} from "node:http";
const source=path=>readFile(new URL("../"+path,import.meta.url),"utf8");
const originalIds=[
 "entryGate","entryForm","entryEmail","entryPassword","entryInvite","entryMode",
 "overview","transactionSearch","transactions-section","transactionRows",
 "terminal-section","markets","stockChart","quotePrice","watchlistToggle",
 "holdings-section","positions","internalProductsPanel","internalProductsItems",
 "orderForm","side","quantity","orderSymbol","feedback",
 "markets-section","savedWatchlist","savedWatchlistFeedback",
 "overview-metrics","portfolioValue","cash","orderCount",
 "account-section","authForm","accountSummary","accountCashValue",
 "serviceRequestsPanel","fundingRequestForm","fundingRequestKind",
 "identityUploadForm","identityFront","identityBack","startKycRequest",
 "bankLinkRequestForm","bankRequestName","bankRequestLast4","bankRequestNumber",
 "serviceRequestHistory","customerSupportForm","customerSupportMessages",
 "catalog-section","catalogItems","records-section","orders"
];
test("CN front design retains all original customer, quote, transaction, and workflow hooks",async()=>{
 const html=await source("web/index.html");
 const doc=new JSDOM(html).window.document;
 for(const id of originalIds)assert.ok(doc.getElementById(id),"Original functional hook #"+id+" is missing");
 const all=[...doc.querySelectorAll("[id]")].map(e=>e.id);
 assert.equal(new Set(all).size,all.length,"Duplicate ids would break app.mjs event handlers");
 assert.equal(doc.getElementById("overview").hidden,true,"Login gate must remain");
 assert.equal(doc.querySelectorAll("#entryForm input").length>=2,true);
 assert.ok(html.includes('src="/app.mjs"'),"Original client API implementation must remain loaded");
 assert.ok(html.includes('src="/cn-terminal-ui.mjs"'),"New UI modal bridge should load separately");
 assert.equal(doc.querySelector("#entryGate .portal-logo img")?.getAttribute("src"),"/cn-login-logo.svg");
 assert.equal(doc.querySelector(".sidebar-logo .cn-capital-mark")?.getAttribute("src"),"/cn-logo.svg");
});
test("actual old customer forms move into CN dialogs and keep their attached submit listeners",async()=>{
 const html=await source("web/index.html");
 const dom=new JSDOM(html,{url:"https://review.invalid/"});
 const saved={document:globalThis.document,MutationObserver:globalThis.MutationObserver};
 const doc=dom.window.document;
 const formIds=["fundingRequestForm","identityUploadForm","bankLinkRequestForm"];
 const forms=formIds.map(id=>doc.getElementById(id));
 let calls=0;
 for(const form of forms) form.addEventListener("submit",event=>{event.preventDefault();calls++});
 try{
  globalThis.document=doc;globalThis.MutationObserver=dom.window.MutationObserver;
  await import("../web/cn-terminal-ui.mjs?cn-live-test");
  assert.equal(doc.querySelectorAll(".cn-live-dialog").length,3);
  assert.equal(doc.querySelectorAll(".cn-quick-actions button").length,3);
  for(let i=0;i<formIds.length;i++){
   const id=formIds[i];
   const found=doc.getElementById(id);
   assert.equal(found,forms[i],"Existing live form must not be cloned: "+id);
   assert.equal(found.closest("dialog")?.dataset.cnDialog,["funding","identity","bank"][i]);
   const button=doc.querySelector('[data-cn-action="'+["funding","identity","bank"][i]+'"]');
   button.click();
   assert.equal(found.closest("dialog")?.hasAttribute("open"),true,"Native dialog must open");
   found.dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
   found.closest("dialog")?.querySelector(".cn-dialog-close").click();
   assert.equal(found.closest("dialog")?.hasAttribute("open"),false);
  }
  assert.equal(calls,3,"Existing form submit event handlers must remain functional");
  assert.ok(doc.getElementById("serviceRequestHistory"),"Original request status/history must remain");
 }finally{
  for(const [k,v] of Object.entries(saved)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}
  dom.window.close();
 }
});
test("market feed and internal ledger scripts are not replaced by demo data",async()=>{
 const sourceHtml=await source("web/index.html");
 const app=await source("web/app.mjs");
 const server=await source("src/server.mjs");
 const design=await source("web/cn-terminal-v4.css");
 assert.ok(app.includes('request("/account"'),"Original account API must remain connected");
 assert.ok(app.includes('request("/watchlist"'),"Original watchlist API must remain connected");
 assert.match(server,/us-stock-quotes\.mjs/);
 assert.match(design,/#overview \.sidebar/);
 assert.match(design,/#overview #stockChart/);
 assert.doesNotMatch(sourceHtml,/CN_SYNC_ACCOUNT|DATA\.cashOverride|TRADING_ENABLED=false/);
});
test("live HTTP server serves customer frontend, new design assets and keeps admin domain isolated",async()=>{
 const server=createApi({db:{},resolveSession:async()=>null});
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const get=(path,host)=>new Promise((resolve,reject)=>{
  const req=request({hostname:"127.0.0.1",port:server.address().port,
   headers:{Host:host},path},res=>{
    const chunks=[];res.on("data",x=>chunks.push(x));res.on("error",reject);
    res.on("end",()=>resolve({status:res.statusCode,type:res.headers["content-type"],body:Buffer.concat(chunks).toString("utf8")}));
  });req.on("error",reject);req.end();
 });
 try{
  const front=await get("/","nuvexapro.com");
  assert.equal(front.status,200);
  assert.match(front.body,/cn-terminal-v4\.css/);
  assert.match(front.body,/id="entryForm"/);
  const admin=await get("/","admin.nuvexapro.com");
  assert.equal(admin.status,200);
  assert.match(admin.body,/id="adminLoginForm"/);
  assert.doesNotMatch(admin.body,/cn-terminal-v4\.css/);
  for(const path of ["/cn-terminal-v4.css","/cn-terminal-ui.mjs","/cn-logo.svg","/cn-login-logo.svg"]){
   const asset=await get(path,"nuvexapro.com");
   assert.equal(asset.status,200,path);
   assert.ok(asset.body.length>50,path);
  }
 }finally{
  server.closeAllConnections();
  await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 }
});
