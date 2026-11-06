import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test("switching clients invalidates an in-flight history response and clears old details",async()=>{
 const html=await readFile(new URL("../web/admin.html",import.meta.url),"utf8");
 const dom=new JSDOM(html,{url:"https://review.invalid/admin.html"});
 const previous={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
 const firstId="11111111-1111-4111-8111-111111111111";
 const secondId="22222222-2222-4222-8222-222222222222";
 let releaseFirst;
 const blockedFirst=new Promise(resolve=>{releaseFirst=resolve;});
 const json=(status,data)=>new Response(status===204?null:JSON.stringify(data),
  {status,headers:{"content-type":"application/json"}});
 try{
  globalThis.document=dom.window.document;
  globalThis.sessionStorage=dom.window.sessionStorage;
  globalThis.fetch=async(url)=>{
   if(url==="/api/admin/login")return json(200,{totpRequired:true,pendingToken:"pending-token",expiresAt:new Date(Date.now()+600000).toISOString()});
   if(url==="/api/admin/totp/verify")return json(200,{token:"master-review-session",role:"MASTER",expiresAt:new Date(Date.now()+1800000).toISOString()});
   if(url==="/api/admin/me")return json(200,{role:"MASTER",userId:"master-id"});
   if(url==="/api/admin/subaccounts"||url==="/api/admin/listings")return json(200,{items:[]});
   if(url==="/api/admin/clients")return json(200,{items:[
    {id:firstId,email:"first@example.test",subadmin_user_id:null},
    {id:secondId,email:"second@example.test",subadmin_user_id:null}
   ]});
   if(url==="/api/admin/mirror-status")return json(200,{ready:true,mode:"READ_ONLY"});
   if(url.startsWith("/api/admin/client-controls?clientId="))return json(200,{policy:{
    clientId:url.split("=")[1],loginAllowed:true,withdrawalRequestsAllowed:true,
    loanRequestsAllowed:false,vipTier:"STANDARD",accountClass:"SIMULATED",version:0
   }});
   if(url.startsWith("/api/admin/client-control-audit?clientId="))return json(200,{items:[]});
   if(url==="/api/admin/client-history?clientId="+firstId)return blockedFirst;
   if(url==="/api/admin/client-history?clientId="+secondId)return json(200,{items:[{
    id:"case-2",clientId:secondId,category:"BANK_LINK",bankLabel:"Second Example Bank",
    accountLast4:"5678",status:"PENDING_VERIFICATION",createdAt:"2026-11-03T10:00:00Z"
   }],hasMore:false,nextCursor:null});
   if(url==="/api/admin/workflow-audit?clientId="+secondId)return json(200,{items:[]});
   if(url==="/api/admin/logout")return json(204,null);
   throw Error("Unexpected request "+url);
  };
  await import("../web/admin.mjs?history-switch-review");
  const el=id=>dom.window.document.getElementById(id);
  el("adminEmail").value="master@example.test";
  el("adminPassword").value="master-password-review-2026";
  el("adminLoginForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
  await delay(90);
  el("totpCode").value="123456";
  el("adminTotpForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
  await delay(90);
  const rows=el("clients").querySelectorAll(".record-detail-open");
  assert.equal(rows.length,2);
  rows[0].click();await delay(35);
  assert.match(el("clientDetailFields").textContent,/first@example.test/);
  rows[1].click();await delay(80);
  assert.match(el("clientDetailFields").textContent,/second@example.test/);
  assert.match(el("clientWorkflowHistory").textContent,/Second Example Bank/);
  releaseFirst(json(200,{items:[{
   id:"case-1",clientId:firstId,category:"BANK_LINK",bankLabel:"First Private Bank",
   accountLast4:"1234",status:"PENDING_VERIFICATION",createdAt:"2026-11-02T10:00:00Z"
  }],hasMore:false,nextCursor:null}));
  await delay(80);
  assert.doesNotMatch(el("clientWorkflowHistory").textContent,/First Private Bank/);
  assert.match(el("clientWorkflowHistory").textContent,/Second Example Bank/);
  el("closeClientDetail").click();
  assert.equal(el("clientWorkflowHistory").childElementCount,0);
  assert.equal(el("clientWorkflowMore").hidden,true);
 }finally{
  globalThis.document=previous.document;
  globalThis.sessionStorage=previous.sessionStorage;
  globalThis.fetch=previous.fetch;
  dom.window.close();
 }
});
