import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test("master client detail reads current policy, re-confirms and logs changes; mirror returns to management",async()=>{
  const html=await readFile(new URL("../web/admin.html",import.meta.url),"utf8");
  const dom=new JSDOM(html,{url:"https://staging.example/admin.html"});
  const old={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
  const clientId="11111111-1111-4111-8111-111111111111";
  let policy={clientId,loginAllowed:true,withdrawalRequestsAllowed:true,loanRequestsAllowed:false,
    vipTier:"STANDARD",accountClass:"SIMULATED",version:0,updatedAt:null};
  const audits=[],changes=[];
  const reply=(status,data)=>new Response(status===204?null:JSON.stringify(data),{
    status,headers:{"content-type":"application/json"}
  });
  try{
    globalThis.document=dom.window.document;
    globalThis.sessionStorage=dom.window.sessionStorage;
    globalThis.fetch=async(url,options={})=>{
      if(url==="/api/admin/login")return reply(200,{token:"master-token",role:"MASTER"});
      if(url==="/api/admin/me")return reply(200,{role:"MASTER",userId:"master-user"});
      if(url==="/api/admin/subaccounts"||url==="/api/admin/listings")return reply(200,{items:[]});
      if(url==="/api/admin/clients")return reply(200,{items:[{id:clientId,email:"customer@example.test",subadmin_user_id:null}]});
      if(url==="/api/admin/mirror-status")return reply(200,{ready:true,mode:"READ_ONLY"});
      if(url==="/api/admin/workflow-requests?category=FUNDING")return reply(200,{items:[
        {id:"case-a",clientId,category:"FUNDING",kind:"DEPOSIT",amountCents:5000,currency:"USD",status:"SUBMITTED",
          createdAt:"2026-11-03T10:00:00Z"},
        {id:"case-other",clientId:"99999999-9999-4999-8999-999999999999",
          category:"FUNDING",kind:"DEPOSIT",amountCents:15000,currency:"USD",status:"SUBMITTED"}
      ]});
      if(url==="/api/admin/workflow-requests?category=KYC")return reply(200,{items:[
        {id:"case-kyc",clientId,category:"KYC",status:"AWAITING_EVIDENCE",createdAt:"2026-11-03T11:00:00Z"}
      ]});
      if(url==="/api/admin/workflow-requests?category=BANK_LINK")return reply(200,{items:[]});
      if(url==="/api/admin/client-controls?clientId="+clientId)return reply(200,{policy:{...policy}});
      if(url==="/api/admin/client-control-audit?clientId="+clientId)return reply(200,{items:audits});
      if(url==="/api/admin/client-controls"&&options.method==="PATCH"){
        const body=JSON.parse(options.body);changes.push(body);
        if(body.expectedVersion!==policy.version)return reply(409,{error:"Stale update"});
        audits.push({field:body.field,previousValue:String(policy[body.field]),nextValue:String(body.value),reason:body.reason,recordedAt:"2026-11-03T00:00:00Z"});
        policy={...policy,[body.field]:body.value,version:policy.version+1};
        return reply(200,{policy:{...policy}});
      }
      if(url==="/api/admin/mirror?clientId="+clientId)return reply(200,{
        mode:"READ_ONLY",checkedAt:"2026-11-03T00:00:00Z",
        client:{id:clientId,email:"customer@example.test"},
        account:{id:"account-id",currency:"USD",cashCents:0},positions:[],orders:[],watchlist:[]
      });
      if(url==="/api/admin/logout")return new Response(null,{status:204});
      throw Error("Unexpected URL "+url);
    };
    await import("../web/admin.mjs?policy-ui-integration");
    const el=id=>dom.window.document.getElementById(id);
    el("adminEmail").value="master@example.test";el("adminPassword").value="master-password-2026";
    el("adminLoginForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
    await pause(65);
    assert.equal(el("clients").querySelectorAll(".record-detail-open").length,1);
    el("clients").querySelector(".record-detail-open").click();
    await pause(75);
    assert.equal(el("clientPolicyArea").hidden,false);
    assert.equal(el("clientWorkflowPanel").hidden,false);
    assert.equal(el("clientWorkflowHistory").querySelectorAll(".admin-list-row").length,2);
    assert.match(el("clientWorkflowHistory").textContent,/50\.00 USD/);
    assert.doesNotMatch(el("clientWorkflowHistory").textContent,/150\.00 USD/);
    assert.match(el("clientWorkflowStatus").textContent,/2 条/);
    assert.equal(el("clientPolicyForm").hidden,false);
    assert.match(el("clientPolicyReadout").textContent,/允许登录/);
    assert.match(el("clientPolicyReadout").textContent,/普通/);
    el("clientPolicyField").value="vipTier";
    el("clientPolicyField").dispatchEvent(new dom.window.Event("change",{bubbles:true}));
    el("clientPolicyValue").value="GOLD";
    el("clientPolicyReason").value="Verified customer eligibility and compliance review";
    el("clientPolicyPassword").value="master-password-2026";
    el("clientPolicyConfirm").checked=true;
    el("clientPolicyForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
    await pause(75);
    assert.equal(changes.length,1);
    assert.deepEqual({field:changes[0].field,value:changes[0].value,expectedVersion:changes[0].expectedVersion},
      {field:"vipTier",value:"GOLD",expectedVersion:0});
    assert.equal(changes[0].confirmPassword,"master-password-2026");
    assert.equal(policy.version,1);
    assert.match(el("clientPolicyReadout").textContent,/黄金/);
    assert.match(el("clientPolicyAudit").textContent,/Verified customer eligibility/);
    assert.equal(el("clientPolicyPassword").value,"");
    el("clientDetailMirror").click();await pause(45);
    assert.equal(el("mirrorManageClient").disabled,false);
    el("mirrorManageClient").click();await pause(45);
    assert.equal(el("clientDetail").hidden,false);
    assert.match(el("clientDetailFields").textContent,/customer@example.test/);
    el("adminLogout").click();
    assert.equal(el("clientDetail").hidden,true);
    assert.equal(el("clientPolicyArea").hidden,true);
    assert.equal(el("clientWorkflowPanel").hidden,true);
    assert.equal(el("clientWorkflowHistory").childElementCount,0);
    assert.equal(el("clientPolicyPassword").value,"");
  }finally{
    globalThis.document=old.document;globalThis.sessionStorage=old.sessionStorage;
    globalThis.fetch=old.fetch;dom.window.close();
  }
});