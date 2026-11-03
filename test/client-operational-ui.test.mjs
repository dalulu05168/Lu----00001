import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const USER="11111111-1111-4111-8111-111111111111";
test("signed-in customer submits scoped requests and sees no invented payout",async()=>{
 const html=await readFile(new URL("../web/index.html",import.meta.url),"utf8");
 const dom=new JSDOM(html,{url:"https://qa.example/"});
 const old={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
 const calls=[],recorded={FUNDING:[],KYC:[],BANK_LINK:[]};
 const json=(status,body)=>new Response(status===204?null:JSON.stringify(body),{
  status,headers:{"content-type":"application/json"}
 });
 try{
  globalThis.document=dom.window.document;
  globalThis.sessionStorage=dom.window.sessionStorage;
  globalThis.fetch=async(url,options={})=>{
   calls.push({url,options});
   if(url==="/api/health")return json(200,{status:"alive",brokerConnected:false,pricingConnected:false});
   if(url==="/api/ready")return json(200,{status:"ready",database:"connected"});
   if(url==="/api/auth/login")return json(200,{token:"client-token"});
   if(url==="/api/account")return json(200,{account:{id:USER,currency:"USD",cashCents:0},positions:[],orders:[]});
   if(url==="/api/watchlist")return json(200,{items:[]});
   if(url==="/api/catalog")return json(200,{items:[]});
   if(url==="/api/auth/logout")return new Response(null,{status:204});
   if(url.startsWith("/api/requests?category=")){
    const category=url.split("=")[1];
    if(!Object.hasOwn(recorded,category))throw Error("Invalid category "+category);
    if(options.method==="POST"){
     const body=JSON.parse(options.body),item={
      id:category+"-"+(recorded[category].length+1),clientId:USER,category,
      status:category==="FUNDING"?"SUBMITTED":category==="KYC"?"AWAITING_EVIDENCE":"PENDING_VERIFICATION",
      createdAt:"2026-11-03T12:00:00Z",...body,
      ...(category==="FUNDING"?{currency:"USD",settlementStatus:"NOT_EXECUTED"}:{}),
      ...(category==="KYC"?{identityVerified:false,documentsStored:false}:{}),
      ...(category==="BANK_LINK"?{verified:false}:{})
     };
     recorded[category].push(item);return json(201,{item});
    }
    return json(200,{items:recorded[category]});
   }
   throw Error("Unexpected request "+url);
  };
  await import("../web/app.mjs?service-request-ui-test");
  const el=id=>dom.window.document.getElementById(id);
  assert.equal(el("serviceRequestsPanel").hidden,true);
  el("entryEmail").value="customer@example.test";el("entryPassword").value="a-valid-long-password";
  el("entryForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
  await pause(110);
  assert.equal(el("entryGate").hidden,true);
  assert.equal(el("serviceRequestsPanel").hidden,false);
  el("fundingRequestKind").value="DEPOSIT";el("fundingRequestAmount").value="12.34";
  el("fundingRequestForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
  await pause(75);
  assert.equal(recorded.FUNDING.length,1);
  assert.equal(recorded.FUNDING[0].amountCents,1234);
  assert.equal(recorded.FUNDING[0].settlementStatus,"NOT_EXECUTED");
  assert.match(el("serviceRequestHistory").textContent,/12\.34 USD/);
  el("bankRequestName").value="Example Bank";el("bankRequestLast4").value="1234";
  el("bankLinkRequestForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
  await pause(75);
  assert.equal(recorded.BANK_LINK.length,1);
  assert.equal(recorded.BANK_LINK[0].accountLast4,"1234");
  assert.match(el("serviceRequestHistory").textContent,/尾号 1234/);
  el("startKycRequest").click();await pause(75);
  assert.equal(recorded.KYC.length,1);
  assert.equal(recorded.KYC[0].identityVerified,false);
  assert.equal(el("accountCashValue").textContent,"0.00");
  el("logout").click();await pause(45);
  assert.equal(el("serviceRequestsPanel").hidden,true);
  assert.equal(el("serviceRequestHistory").childElementCount,0);
  assert.ok(calls.every(call=>!call.url.includes("/api/orders")));
 }finally{
  globalThis.document=old.document;globalThis.sessionStorage=old.sessionStorage;
  globalThis.fetch=old.fetch;dom.window.close();
 }
});
