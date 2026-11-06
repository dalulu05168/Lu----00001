import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";

test("subaccount views only own details, cannot edit controls, and mobile menu closes after navigation", async()=>{
  const html=await readFile(new URL("../web/admin.html",import.meta.url),"utf8");
  const dom=new JSDOM(html,{url:"https://review.invalid/admin.html"});
  const previous={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
  const subId="22222222-2222-4222-8222-222222222222";
  const send=(status,data)=>new Response(status===204?null:JSON.stringify(data),
    {status,headers:{"content-type":"application/json"}});
  try{
    globalThis.document=dom.window.document;
    globalThis.sessionStorage=dom.window.sessionStorage;
    globalThis.fetch=async url=>{
      if(url==="/api/admin/login")return send(200,{totpRequired:true,pendingToken:"pending-token",expiresAt:new Date(Date.now()+600000).toISOString()});
      if(url==="/api/admin/totp/verify")return send(200,{token:"review-session",role:"SUBADMIN",expiresAt:new Date(Date.now()+1800000).toISOString()});
      if(url==="/api/admin/me")return send(200,{role:"SUBADMIN",userId:subId});
      if(url==="/api/admin/subaccounts")return send(200,{items:[
        {user_id:subId,email:"owner@example.test",uses:1,max_uses:100}
      ]});
      if(url==="/api/admin/clients"||url==="/api/admin/listings")return send(200,{items:[]});
      if(url==="/api/admin/mirror-status")return send(200,{ready:true,mode:"READ_ONLY"});
      if(url==="/api/admin/subaccount-controls?userId="+subId)
        return send(200,{policy:{userId:subId,loginAllowed:true,version:0,
          clientCount:2,requestCount:3,pendingRequestCount:1}});
      if(url==="/api/admin/subaccount-control-audit?userId="+subId)return send(200,{items:[]});
      if(url==="/api/admin/logout")return send(204,null);
      throw Error("Unexpected endpoint: "+url);
    };
    await import("../web/admin.mjs?subadmin-self-nav");
    const el=id=>dom.window.document.getElementById(id);
    el("adminEmail").value="owner@example.test";
    el("adminPassword").value="review-only-value";
    dom.window.document.querySelector('[data-role-choice="SUBADMIN"]').click();
    el("adminLoginForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
    await new Promise(done=>setTimeout(done,100));
    el("totpCode").value="123456";
    el("adminTotpForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
    await new Promise(done=>setTimeout(done,100));
    assert.equal(el("adminWorkspace").hidden,false);
    assert.equal(dom.window.document.querySelector('[data-admin-page="accounts"]').hidden,false);
    assert.equal(el("subadminForm").hidden,true);
    assert.equal(el("subadmins").querySelectorAll("button").length,1);
    el("adminMobileNavToggle").click();
    assert.equal(el("adminMobileNavToggle").getAttribute("aria-expanded"),"true");
    assert.equal(dom.window.document.querySelector(".admin-nav").dataset.mobileOpen,"true");
    dom.window.document.querySelector('[data-admin-page="accounts"]').click();
    assert.equal(el("adminMobileNavToggle").getAttribute("aria-expanded"),"false");
    assert.equal(dom.window.document.querySelector('[data-pane="accounts"]').hidden,false);
    el("subadmins").querySelector("button").click();
    await new Promise(done=>setTimeout(done,60));
    assert.equal(el("subadminPolicyArea").hidden,false);
    assert.equal(el("subadminPolicyForm").hidden,true);
    assert.match(el("subadminPolicyFields").textContent,/2 人/);
    assert.match(el("subadminPolicyFields").textContent,/3 笔/);
    el("adminLogout").click();
    assert.equal(el("subadminDetail").hidden,true);
    assert.equal(el("subadminPolicyArea").hidden,true);
    assert.equal(el("adminWorkspace").hidden,true);
  }finally{
    globalThis.document=previous.document;
    globalThis.sessionStorage=previous.sessionStorage;
    globalThis.fetch=previous.fetch;
    dom.window.close();
  }
});