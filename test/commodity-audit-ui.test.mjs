import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const PRODUCT="11111111-1111-4111-8111-111111111111";
const audits=[
 {actor_user_id:"master-user",action:"UPDATE",previous_status:"DRAFT",new_status:"PUBLISHED",reason:"批准上架",recorded_at:"2026-11-07T00:00:00.000Z"},
 {actor_user_id:"master-user",action:"CREATE",previous_status:null,new_status:"DRAFT",reason:null,recorded_at:"2026-11-06T00:00:00.000Z"}
];

test("MASTER can open commodity audit history and stale audit content is cleared",async()=>{
 const dom=new JSDOM(await readFile(new URL("../web/admin.html",import.meta.url),"utf8"),{url:"https://qa.example/admin.html"});
 const old={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
 const calls=[];
 const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
 try{
  globalThis.document=dom.window.document;
  globalThis.sessionStorage=dom.window.sessionStorage;
  globalThis.fetch=async(url,options={})=>{
   calls.push({url,options});
   if(url==="/api/admin/login")return json(200,{totpRequired:true,pendingToken:"pending-token",expiresAt:new Date(Date.now()+600000).toISOString()});
   if(url==="/api/admin/totp/verify")return json(200,{token:"synthetic-master",role:"MASTER",expiresAt:new Date(Date.now()+1800000).toISOString()});
   if(url==="/api/admin/me")return json(200,{role:"MASTER",userId:"master-user"});
   if(url==="/api/admin/mirror-status")return json(200,{ready:true,mode:"READ_ONLY"});
   if(url==="/api/admin/commodities")return json(200,{items:[{id:PRODUCT,sku:"GOLD-OZ",name:"Gold directory",category:"PRECIOUS_METAL",unit:"ounce",minimumQuantity:1,indicativePriceCents:125500,status:"PUBLISHED"}]});
   if(url==="/api/admin/commodity-audit?id="+PRODUCT)return json(200,{items:audits});
   if(url==="/api/admin/logout")return new Response(null,{status:204});
   return json(200,{items:[]});
  };
  await import("../web/admin.mjs?commodity-audit-ui-test");
  const el=id=>dom.window.document.getElementById(id);
  el("adminEmail").value="master@example.test";el("adminPassword").value="synthetic-password-only";
  el("adminLoginForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));await pause(80);
  el("totpCode").value="123456";
  el("adminTotpForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));await pause(80);
  dom.window.document.querySelector('[data-admin-page="commodities"]').click();await pause(50);
  const auditButton=[...el("commodityItems").querySelectorAll("button")].find(button=>button.textContent==="查看审计");
  assert.ok(auditButton,"MASTER commodity rows should expose audit history");
  auditButton.click();await pause(50);
  assert.equal(el("commodityAuditPanel").hidden,false);
  assert.match(el("commodityAuditTitle").textContent,/GOLD-OZ/);
  assert.match(el("commodityAuditStatus").textContent,/2 条/);
  assert.match(el("commodityAuditItems").textContent,/更新/);
  assert.match(el("commodityAuditItems").textContent,/原状态：DRAFT/);
  assert.match(el("commodityAuditItems").textContent,/新状态：PUBLISHED/);
  assert.match(el("commodityAuditItems").textContent,/批准上架/);
  assert.ok(calls.some(call=>call.url==="/api/admin/commodity-audit?id="+PRODUCT));
  el("commodityAuditClose").click();
  assert.equal(el("commodityAuditPanel").hidden,true);
  assert.equal(el("commodityAuditItems").childElementCount,0);
  auditButton.click();await pause(50);
  el("adminLogout").click();
  assert.equal(el("commodityAuditPanel").hidden,true);
  assert.equal(el("commodityAuditItems").childElementCount,0);
 }finally{
  Object.assign(globalThis,old);dom.window.close();
 }
});
