import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";
const pause=ms=>new Promise(done=>setTimeout(done,ms));
const CLIENT="11111111-1111-4111-8111-111111111111";

test("master can modify client policy and review request without leaving the APP mirror",async()=>{
 const html=await readFile(new URL("../web/admin.html",import.meta.url),"utf8");
 const dom=new JSDOM(html,{url:"https://review.invalid/admin.html"});
 const prev={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
 const calls=[],audit=[],client={id:CLIENT,email:"mirror@example.test",subadmin_user_id:null};
 let policy={clientId:CLIENT,loginAllowed:true,withdrawalRequestsAllowed:true,
  loanRequestsAllowed:false,vipTier:"STANDARD",accountClass:"SIMULATED",version:0};
 let workflow={id:"case-101",clientId:CLIENT,category:"FUNDING",kind:"WITHDRAWAL",amountCents:2500,
  currency:"USD",status:"SUBMITTED",createdAt:"2026-11-03T09:00:00Z"};
 const send=(status,data)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
 try{
  globalThis.document=dom.window.document;globalThis.sessionStorage=dom.window.sessionStorage;
  globalThis.fetch=async(url,options={})=>{
   calls.push({url,options});
   if(url==="/api/admin/login")return send(200,{totpRequired:true,pendingToken:"pending-token",expiresAt:new Date(Date.now()+600000).toISOString()});
   if(url==="/api/admin/totp/verify")return send(200,{token:"admin-test-token",role:"MASTER",expiresAt:new Date(Date.now()+1800000).toISOString()});
   if(url==="/api/admin/me")return send(200,{role:"MASTER",userId:"master-user"});
   if(url==="/api/admin/clients")return send(200,{items:[client]});
   if(url==="/api/admin/subaccounts"||url==="/api/admin/listings")return send(200,{items:[]});
   if(url==="/api/admin/mirror-status")return send(200,{ready:true,mode:"READ_ONLY"});
   if(url==="/api/admin/mirror?clientId="+CLIENT)return send(200,{
    mode:"READ_ONLY",checkedAt:"2026-11-03T10:00:00Z",client,
    account:{id:"account-id",currency:"USD",cashCents:0},positions:[],orders:[],watchlist:[]
   });
   if(url==="/api/admin/client-controls?clientId="+CLIENT)return send(200,{policy:{...policy}});
   if(url==="/api/admin/client-control-audit?clientId="+CLIENT)return send(200,{items:[...audit]});
   if(url==="/api/admin/client-controls"&&options.method==="PATCH"){
    const data=JSON.parse(options.body);
    if(data.expectedVersion!==policy.version)return send(409,{error:"Stale policy"});
    if(data.confirmPassword!=="master-login-password-2026")return send(401,{error:"Invalid confirmation"});
    audit.unshift({field:data.field,previousValue:String(policy[data.field]),nextValue:String(data.value),
      reason:data.reason,recordedAt:"2026-11-03T10:00:00Z"});
    policy={...policy,[data.field]:data.value,version:policy.version+1};
    return send(200,{policy:{...policy}});
   }
   if(url==="/api/admin/workflow-requests?category=FUNDING&clientId="+CLIENT)
    return send(200,{items:[{...workflow}]});
   if(url==="/api/admin/workflow-requests"&&options.method==="PATCH"){
    const data=JSON.parse(options.body);
    if(data.expectedStatus!==workflow.status)return send(409,{error:"Stale workflow"});
    workflow={...workflow,status:data.status};return send(200,{item:{...workflow}});
   }
   if(url==="/api/admin/logout")return new Response(null,{status:204});
   throw Error("Unexpected URL "+url);
  };
  await import("../web/admin.mjs?mirror-writable-master");
  const el=id=>dom.window.document.getElementById(id);
  el("adminEmail").value="master@example.test";el("adminPassword").value="master-login-password-2026";
  el("adminLoginForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
  await pause(75);
  el("totpCode").value="123456";
  el("adminTotpForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
  await pause(75);
  el("mirrorClientList").querySelector(".mirror-open").click();await pause(85);
  assert.equal(el("mirrorOperations").hidden,false);
  assert.equal(el("mirrorControlRows").querySelectorAll(".mirror-control-row").length,5);
  assert.equal(el("mirrorControlRows").querySelectorAll("button").length,5);
  assert.equal(dom.window.document.querySelector('[data-pane="mirror"]').hidden,false);
  assert.equal(el("mirrorControlsPanel").hidden,false);
  el("mirrorControlRows").querySelector('[aria-label="修改 VIP 等级"]').click();
  assert.equal(el("mirrorPolicyForm").hidden,false);
  el("mirrorPolicyValue").value="GOLD";
  el("mirrorPolicyReason").value="Verified eligibility and permissions before change";
  el("mirrorPolicyPassword").value="master-login-password-2026";
  el("mirrorPolicyConfirm").checked=true;
  el("mirrorPolicyForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
  await pause(90);
  assert.equal(policy.vipTier,"GOLD");
  assert.equal(policy.version,1);
  assert.equal(el("mirrorPolicyForm").hidden,true);
  assert.equal(el("mirrorPolicyPassword").value,"");
  assert.match(el("mirrorControlRows").textContent,/黄金/);
  assert.match(el("mirrorPolicyAudit").textContent,/Verified eligibility/);
  assert.equal(dom.window.document.querySelector('[data-pane="mirror"]').hidden,false);
  el("mirrorControlRows").querySelector('[aria-label="修改 客户登录"]').click();
  el("mirrorPolicyValue").value="false";
  el("mirrorPolicyReason").value="Access restriction requested after account review";
  el("mirrorPolicyPassword").value="master-login-password-2026";
  el("mirrorPolicyConfirm").checked=true;
  el("mirrorPolicyForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
  await pause(85);
  assert.equal(policy.loginAllowed,false);
  assert.equal(policy.version,2);
  dom.window.document.querySelector('[data-mirror-operation-tab="requests"]').click();
  await pause(80);
  assert.equal(el("mirrorRequestsPanel").hidden,false);
  assert.match(el("mirrorRequestRows").textContent,/25\.00/);
  el("mirrorRequestRows").querySelector("button").click();
  assert.equal(el("mirrorReviewForm").hidden,false);
  assert.equal(el("mirrorReviewDecision").value,"APPROVED");
  el("mirrorReviewDecision").value="UNDER_REVIEW";
  el("mirrorReviewDecision").dispatchEvent(new dom.window.Event('change'));
  el("mirrorReviewReason").value="Reviewed withdrawal request against existing customer data";
  el("mirrorReviewConfirm").checked=true;
  el("mirrorReviewForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
  await pause(85);
  assert.equal(workflow.status,"UNDER_REVIEW");
  assert.match(el("mirrorRequestRows").textContent,/审核中/);
  assert.equal(dom.window.document.querySelector('[data-pane="mirror"]').hidden,false);
  const patches=calls.filter(x=>x.options.method==="PATCH");
  assert.equal(patches.length,3);
  assert.deepEqual(patches.map(x=>x.url),[
   "/api/admin/client-controls","/api/admin/client-controls","/api/admin/workflow-requests"
  ]);
  assert.equal(JSON.parse(patches[0].options.body).expectedVersion,0);
  assert.equal(JSON.parse(patches[1].options.body).expectedVersion,1);
  el("adminLogout").click();
  assert.equal(el("mirrorOperations").hidden,true);
  assert.equal(el("mirrorControlRows").childElementCount,0);
  assert.equal(el("mirrorPolicyPassword").value,"");
  assert.equal(el("mirrorRequestRows").childElementCount,0);
 }finally{
  globalThis.document=prev.document;globalThis.sessionStorage=prev.sessionStorage;
  globalThis.fetch=prev.fetch;dom.window.close();
 }
});

test("subadmin mirror is scoped read-only for policy changes; snapshot outage does not block policy view",async()=>{
 const html=await readFile(new URL("../web/admin.html",import.meta.url),"utf8");
 const dom=new JSDOM(html,{url:"https://review.invalid/admin.html"});
 const prev={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
 const calls=[];
 const send=(status,data)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
 try{
  globalThis.document=dom.window.document;globalThis.sessionStorage=dom.window.sessionStorage;
  globalThis.fetch=async(url,options={})=>{
   calls.push({url,options});
   if(url==="/api/admin/login")return send(200,{totpRequired:true,pendingToken:"pending-token",expiresAt:new Date(Date.now()+600000).toISOString()});
   if(url==="/api/admin/totp/verify")return send(200,{token:"sub-token",role:"SUBADMIN",expiresAt:new Date(Date.now()+1800000).toISOString()});
   if(url==="/api/admin/me")return send(200,{role:"SUBADMIN",userId:"sub-user"});
   if(url==="/api/admin/clients")return send(200,{items:[{id:CLIENT,email:"customer@example.test"}]});
   if(url==="/api/admin/subaccounts"||url==="/api/admin/listings")return send(200,{items:[]});
   if(url==="/api/admin/mirror-status")return send(200,{ready:false,mode:"READ_ONLY"});
   if(url==="/api/admin/mirror?clientId="+CLIENT)return send(503,{error:"Mirror unavailable"});
   if(url==="/api/admin/client-controls?clientId="+CLIENT)return send(200,{policy:{
    clientId:CLIENT,loginAllowed:true,withdrawalRequestsAllowed:false,loanRequestsAllowed:false,
    vipTier:"STANDARD",accountClass:"SIMULATED",version:0
   }});
   if(url==="/api/admin/client-control-audit?clientId="+CLIENT)return send(200,{items:[]});
   if(url==="/api/admin/workflow-requests?category=FUNDING&clientId="+CLIENT)return send(200,{items:[]});
   if(url==="/api/admin/logout")return new Response(null,{status:204});
   throw Error("Unexpected URL "+url);
  };
  await import("../web/admin.mjs?mirror-writable-sub");
  const el=id=>dom.window.document.getElementById(id);
  el("adminEmail").value="sub@example.test";el("adminPassword").value="sub-login-password-2026";
  dom.window.document.querySelector('[data-role-choice="SUBADMIN"]').click();
  el("adminLoginForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
  await pause(75);
  el("totpCode").value="123456";
  el("adminTotpForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
  await pause(75);
  const button=el("mirrorClientList").querySelector(".mirror-open");
  assert.equal(button.disabled,false);
  button.click();await pause(80);
  assert.equal(el("mirrorOperations").hidden,false);
  assert.equal(el("mirrorControlRows").querySelectorAll(".mirror-control-row").length,5);
  assert.equal(el("mirrorControlRows").querySelectorAll("button").length,0);
  assert.match(el("mirrorControlStatus").textContent,/只可查看/);
  assert.equal(el("mirrorPolicyForm").hidden,true);
  assert.match(el("mirrorStatus").textContent,/快照不可用/);
  assert.equal(calls.some(x=>x.options.method==="PATCH"),false);
 }finally{
  globalThis.document=prev.document;globalThis.sessionStorage=prev.sessionStorage;
  globalThis.fetch=prev.fetch;dom.window.close();
 }
});
