import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";

const first="11111111-1111-4111-8111-111111111111";
const second="22222222-2222-4222-8222-222222222222";
const json=(status,data)=>new Response(status===204?null:JSON.stringify(data),{status});
const flush=async()=>{for(let n=0;n<12;n++)await new Promise(resolve=>setImmediate(resolve));};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
async function withAdmin(name,run){
 const dom=new JSDOM(await readFile(new URL("../web/admin.html",import.meta.url),"utf8"),{url:"https://local.invalid/admin.html"});
 const old={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
 const state={token:"session-A",role:"MASTER",override:()=>undefined};
 const el=id=>dom.window.document.getElementById(id);
 globalThis.document=dom.window.document;globalThis.sessionStorage=dom.window.sessionStorage;
 globalThis.fetch=async(url,options={})=>{
  const overridden=state.override(url,options);if(overridden!==undefined)return overridden;
  if(url==="/api/admin/login")return json(200,{totpRequired:true,pendingToken:"pending-"+state.token,expiresAt:new Date(Date.now()+600000).toISOString()});
  if(url==="/api/admin/totp/verify")return json(200,{token:state.token,role:state.role,expiresAt:new Date(Date.now()+1800000).toISOString()});
  if(url==="/api/admin/me")return json(200,{role:state.role,userId:second});
  if(url==="/api/admin/logout")return json(204);
  if(url==="/api/admin/mirror-status")return json(200,{ready:true,mode:"READ_ONLY"});
  if(url==="/api/admin/clients")return json(200,{items:[{id:first,email:"first-private@example.test"},{id:second,email:"second@example.test"}]});
  if(url==="/api/admin/subaccounts")return json(200,{items:[{user_id:first,email:"sub-first@example.test"},{user_id:second,email:"sub-second@example.test"}]});
  if(url.startsWith("/api/admin/client-controls?"))return json(200,{policy:{clientId:first,loginAllowed:true,withdrawalRequestsAllowed:true,loanRequestsAllowed:false,vipTier:"GOLD",accountClass:"INTERNAL",version:1}});
  if(url.startsWith("/api/admin/subaccount-controls?"))return json(200,{policy:{userId:first,email:"sub-first@example.test",loginAllowed:true,version:1,clientCount:73,requestCount:0,pendingRequestCount:0}});
  if(url==="/api/admin/audit-events?limit=100")return json(200,{items:[{eventType:"CLIENT_POLICY",action:"vipTier",description:"first-private-audit",clientId:first}]});
  if(url==="/api/admin/mirror-audit")return json(200,{items:[{clientEmail:"first-private@example.test",actorEmail:"admin@example.test",viewedAt:"2026-11-04T00:00:00Z"}]});
  return json(200,{items:[]});
 };
 const login=async()=>{
  dom.window.document.querySelector(`[data-role-choice="${state.role}"]`).click();
  el("adminEmail").value="admin@example.test";el("adminPassword").value="test-password-2026";
  el("adminLoginForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));await flush();
  el("totpCode").value="123456";
  el("adminTotpForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));await flush();
 };
 try{await import(`../web/admin.mjs?session-isolation-${name}`);await login();await run({dom,el,state,login});}
 finally{Object.assign(globalThis,old);dom.window.close();}
}

test("late directory responses cannot replace another administrator's customers",()=>withAdmin("directory",async({el,state,login})=>{
 const pending=deferred();
 state.override=url=>url==="/api/admin/clients"?pending.promise:undefined;
 el("refreshClients").click();await flush();el("adminLogout").click();
 state.override=()=>undefined;state.token="session-B";state.role="SUBADMIN";
 await login();
 pending.resolve(json(200,{items:[{id:first,email:"LEAKED-OLD-CUSTOMER@example.test"}]}));await flush();
 assert.doesNotMatch(el("clients").textContent,/LEAKED-OLD-CUSTOMER/);
 assert.match(el("clients").textContent,/second@example.test/);
}));

test("logout clears audit data and late audit responses cannot repopulate it",()=>withAdmin("audit",async({dom,el,state})=>{
 dom.window.document.querySelector('[data-admin-page="audit"]').click();await flush();
 assert.match(el("unifiedAuditList").textContent,/first-private-audit/);
 const pending=deferred();state.override=url=>url==="/api/admin/mirror-audit"?pending.promise:undefined;
 el("refreshMirrorAudit").click();await flush();el("adminLogout").click();
 assert.equal(el("unifiedAuditList").textContent,"");
 pending.resolve(json(200,{items:[{clientEmail:"LEAKED-AUDIT@example.test",actorEmail:"old-admin",viewedAt:"2026-11-04T00:00:00Z"}]}));await flush();
 assert.equal(el("mirrorAuditList").textContent,"");
 assert.equal(el("clients").textContent,"");
 assert.equal(el("subadmins").textContent,"");
}));

test("revoked administrator session clears the privileged workspace",()=>withAdmin("expired",async({el,state})=>{
 state.override=url=>url==="/api/admin/clients"?json(401,{error:"Authentication required"}):undefined;
 el("refreshClients").click();await flush();
 assert.equal(el("adminWorkspace").hidden,true);
 assert.equal(el("admin-login").hidden,false);
 assert.equal(sessionStorage.getItem("gsp_admin_token"),null);
 assert.equal(el("clients").textContent,"");
}));

test("switching customers clears the previous policy while the new request is pending or fails",()=>withAdmin("policy",async({el,state})=>{
 el("clients").querySelectorAll(".record-detail-open")[0].click();await flush();
 assert.match(el("clientPolicyReadout").textContent,/黄金/);
 const pending=deferred();state.override=url=>url==="/api/admin/client-controls?clientId="+second?pending.promise:undefined;
 el("clients").querySelectorAll(".record-detail-open")[1].click();await flush();
 assert.equal(el("clientPolicyReadout").textContent,"");
 pending.resolve(json(503,{error:"Account policies unavailable"}));await flush();
 assert.equal(el("clientPolicyReadout").textContent,"");
 assert.equal(el("clientPolicyForm").hidden,true);
}));

test("switching subadmins clears the previous permission readout",()=>withAdmin("subpolicy",async({el,state})=>{
 el("subadmins").querySelectorAll("button")[0].click();await flush();
 assert.match(el("subadminPolicyFields").textContent,/73 人/);
 const pending=deferred();state.override=url=>url==="/api/admin/subaccount-controls?userId="+second?pending.promise:undefined;
 el("subadmins").querySelectorAll("button")[1].click();await flush();
 assert.equal(el("subadminPolicyFields").textContent,"");
 pending.resolve(json(503,{error:"Account policies unavailable"}));await flush();
 assert.equal(el("subadminPolicyFields").textContent,"");
}));

test("a failed password confirmation does not discard a valid administrator session",()=>withAdmin("confirmation",async({dom,el,state})=>{
 el("clients").querySelector(".record-detail-open").click();await flush();
 state.override=(url,options)=>url==="/api/admin/client-controls"&&options.method==="PATCH"
  ?json(401,{error:"Invalid admin credentials"}):undefined;
 el("clientPolicyField").value="loginAllowed";
 el("clientPolicyField").dispatchEvent(new dom.window.Event("change"));
 el("clientPolicyValue").value="false";
 el("clientPolicyReason").value="Local test account confirmation";
 el("clientPolicyPassword").value="wrong-password-confirmation";el("clientPolicyConfirm").checked=true;
 el("clientPolicyForm").dispatchEvent(new dom.window.Event("submit",{cancelable:true,bubbles:true}));await flush();
 assert.equal(el("adminWorkspace").hidden,false);
 assert.equal(sessionStorage.getItem("gsp_admin_token"),"session-A");
 assert.match(el("clientPolicyStatus").textContent,/未保存/);
}));

test("late login verification cannot reopen a workspace after logout",()=>withAdmin("late-me",async({el,state,login})=>{
 el("adminLogout").click();
 const pending=deferred();state.override=url=>url==="/api/admin/me"?pending.promise:undefined;
 await login();el("adminLogout").click();
 pending.resolve(json(200,{role:"MASTER",userId:first}));await flush();
 assert.equal(el("adminWorkspace").hidden,true);
 assert.equal(el("adminTopbar").hidden,true);
 assert.equal(el("clients").textContent,"");
}));

test("APP mirror rejects a snapshot for a different selected customer",()=>withAdmin("mirror-id",async({el,state})=>{
 state.override=url=>url==="/api/admin/mirror?clientId="+first?json(200,{
  mode:"READ_ONLY",checkedAt:"2026-11-04T00:00:00Z",client:{id:second,email:"WRONG-CUSTOMER@example.test"},
  account:{id:"wrong-account",cashCents:98765,currency:"USD"},positions:[],orders:[],watchlist:[]
 }):undefined;
 el("clients").querySelector(".mirror-open").click();await flush();
 assert.doesNotMatch(el("mirrorEmail").textContent,/WRONG-CUSTOMER/);
 assert.equal(el("mirrorCash").textContent,"—");
 assert.match(el("mirrorStatus").textContent,/快照不可用/);
}));
