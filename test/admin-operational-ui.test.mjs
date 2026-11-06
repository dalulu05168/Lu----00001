import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const CLIENT="11111111-1111-4111-8111-111111111111";
const REQUEST="22222222-2222-4222-8222-222222222222";
test("master reviews an authorized funding request and sees non-settlement dashboard",async()=>{
 const html=await readFile(new URL("../web/admin.html",import.meta.url),"utf8");
 const dom=new JSDOM(html,{url:"https://qa.example/admin.html"});
 let lastScrolled=null;
 dom.window.HTMLElement.prototype.scrollIntoView=function(options){lastScrolled={id:this.id,options};};
 const old={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
 let fundingFailure=false;
 const calls=[],cases=[{id:REQUEST,clientId:CLIENT,category:"FUNDING",kind:"DEPOSIT",amountCents:12000,
  currency:"USD",status:"SUBMITTED",settlementStatus:"NOT_EXECUTED",createdAt:"2026-11-03T08:00:00Z"}];
 const json=(status,body)=>new Response(status===204?null:JSON.stringify(body),{
  status,headers:{"content-type":"application/json"}
 });
 try{
  globalThis.document=dom.window.document;
  globalThis.sessionStorage=dom.window.sessionStorage;
  globalThis.fetch=async(url,options={})=>{
   calls.push({url,options});
   if(url==="/api/admin/login")return json(200,{totpRequired:true,pendingToken:"pending-token",expiresAt:new Date(Date.now()+600000).toISOString()});
   if(url==="/api/admin/totp/verify")return json(200,{token:"master-token",role:"MASTER",expiresAt:new Date(Date.now()+1800000).toISOString()});
   if(url==="/api/admin/me")return json(200,{role:"MASTER",userId:"master-id"});
   if(url==="/api/admin/clients"||url==="/api/admin/subaccounts"||url==="/api/admin/listings")
    return json(200,{items:[]});
   if(url==="/api/admin/mirror-status")return json(200,{ready:true,mode:"READ_ONLY"});
   if(url==="/api/admin/workflow-requests?category=FUNDING")return fundingFailure?json(503,{error:'unavailable'}):json(200,{items:cases});
   if(url==="/api/admin/workflow-requests"&&options.method==="PATCH"){
    const body=JSON.parse(options.body);
    if(body.expectedStatus!==cases[0].status)return json(409,{error:"Version mismatch"});
    cases[0]={...cases[0],status:body.status};
    return json(200,{item:cases[0]});
   }
   if(url==="/api/admin/logout")return new Response(null,{status:204});
   throw Error("Unexpected request "+url);
  };
  await import("../web/admin.mjs?workflow-review-ui-test");
  const el=id=>dom.window.document.getElementById(id);
  el("adminEmail").value="master@example.test";el("adminPassword").value="master-password-2026";
  el("adminLoginForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
  await pause(85);
  el("totpCode").value="123456";
  el("adminTotpForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
  await pause(85);
  assert.equal(el('adminPageTitle').textContent,'全局运营总览');
  assert.equal(el('dashboardDepositAmount').textContent,'$120.00');
  assert.equal(el('dashboardWithdrawAmount').textContent,'$0.00');
  assert.equal(el('dashboardPendingCount').textContent,'1');
  assert.equal(el('dashboardDepositPosted').textContent,'$0.00');
  assert.equal(el('dashboardWithdrawPosted').textContent,'$0.00');
  assert.match(el('dashboardFundingRows').textContent,/120\.00/);
  assert.match(el('dashboardFundingStatus').textContent,/300/);
  dom.window.document.querySelector('[data-admin-page="approvals"]').click();
  await pause(60);
  assert.equal(el("workflowItems").querySelectorAll("button").length,1);
  assert.match(el("workflowItems").textContent,/120\.00 USD/);
  const reviewAction=el("workflowItems").querySelector("button");
  reviewAction.click();
  assert.equal(el("workflowReviewForm").hidden,false);
  assert.equal(el("workflowDecision").value,"APPROVED");
  assert.equal(lastScrolled?.id,"workflowReviewForm","the review form must scroll into view after selecting an application");
  assert.equal(dom.window.document.activeElement.id,"workflowDecision","focus must move to the review decision");
  assert.equal(reviewAction.getAttribute("aria-expanded"),"true");
  assert.ok(reviewAction.closest(".workflow-row").classList.contains("workflow-row-selected"));
  assert.match(el("workflowStatus").textContent,/审核表单已展开/);
  el("workflowCancel").click();
  assert.equal(el("workflowReviewForm").hidden,true);
  assert.equal(reviewAction.getAttribute("aria-expanded"),"false");
  assert.ok(!reviewAction.closest(".workflow-row").classList.contains("workflow-row-selected"));
  assert.equal(dom.window.document.activeElement,reviewAction,"cancel returns focus to the selected row action");
  reviewAction.click();
  assert.equal(el("workflowReviewForm").hidden,false);
  assert.equal(el("workflowDecision").value,"APPROVED");
  el("workflowDecision").value="UNDER_REVIEW";
  el("workflowDecision").dispatchEvent(new dom.window.Event('change'));
  el("workflowReason").value="Checked the funding application and supporting internal records";
  el("workflowConfirm").checked=true;
  el("workflowReviewForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
  await pause(60);
  assert.equal(cases[0].status,"UNDER_REVIEW");
  const patch=calls.find(x=>x.url==="/api/admin/workflow-requests"&&x.options.method==="PATCH");
  assert.equal(JSON.parse(patch.options.body).status,"UNDER_REVIEW");
  assert.equal(el("workflowReviewForm").hidden,true);
  el("workflowItems").querySelector("button").click();
  assert.equal(el("workflowDecision").value,"APPROVED");
  assert.equal(el("workflowReason").required,false);
  assert.equal(el("workflowReason").hasAttribute("minlength"),false);
  el("workflowReason").value="";
  el("workflowConfirm").checked=true;
  el("workflowReviewForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
  await pause(60);
  assert.equal(cases[0].status,"APPROVED");
  dom.window.document.querySelector('[data-admin-page="treasury"]').click();
  await pause(55);
  assert.equal(el("depositRequestTotal").textContent,"1");
  assert.equal(el("withdrawRequestTotal").textContent,"0");
  assert.equal(el("pendingRequestTotal").textContent,"0");
  assert.equal(el("approvedRequestTotal").textContent,"1");
  assert.match(el("fundingSummaryStatus").textContent,/未接入/);
  fundingFailure=true;el('refreshDashboardFunding').click();await pause(50);
  assert.equal(el('dashboardDepositAmount').textContent,'—');
  assert.equal(el('dashboardFundingRows').childElementCount,0);
  assert.match(el('dashboardFundingStatus').textContent,/失败/);
  el("adminLogout").click();
  assert.equal(el("fundingRequestRows").childElementCount,0);
  assert.equal(el("workflowItems").childElementCount,0);
  assert.equal(el("adminWorkspace").hidden,true);
  assert.equal(el('dashboardFundingRows').childElementCount,0);
  assert.equal(el('dashboardDepositAmount').textContent,'—');
 }finally{
  globalThis.document=old.document;globalThis.sessionStorage=old.sessionStorage;
  globalThis.fetch=old.fetch;dom.window.close();
 }
});
