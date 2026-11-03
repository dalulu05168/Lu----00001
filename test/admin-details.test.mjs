import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";

const pause=ms=>new Promise(done=>setTimeout(done,ms));
test("authorized client and subadmin directories open detail workspaces, mirror and clear on logout",async()=>{
  const html=await readFile(new URL("../web/admin.html",import.meta.url),"utf8");
  const dom=new JSDOM(html,{url:"https://qa.invalid/admin.html"});
  const old={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
  const clientId="11111111-1111-4111-8111-111111111111";
  const subId="22222222-2222-4222-8222-222222222222";
  const respond=(status,body)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
  try{
    globalThis.document=dom.window.document;
    globalThis.sessionStorage=dom.window.sessionStorage;
    globalThis.fetch=async url=>{
      if(url==="/api/admin/login")return respond(200,{token:"test-token",role:"MASTER"});
      if(url==="/api/admin/me")return respond(200,{role:"MASTER",userId:"master"});
      if(url==="/api/admin/subaccounts")return respond(200,{items:[{user_id:subId,email:"sub@example.test",code:"123456",uses:1,max_uses:100}]});
      if(url==="/api/admin/clients")return respond(200,{items:[{id:clientId,email:"client@example.test",subadmin_user_id:subId}]});
      if(url==="/api/admin/mirror-status")return respond(200,{mode:"READ_ONLY",ready:true});
      if(url==="/api/admin/listings")return respond(200,{items:[]});
      if(url==="/api/admin/mirror?clientId="+clientId)return respond(200,{mode:"READ_ONLY",checkedAt:"2026-11-03T00:00:00Z",client:{id:clientId,email:"client@example.test"},account:{id:"demo-account",currency:"USD",cashCents:0},positions:[],orders:[],watchlist:[]});
      if(url==="/api/admin/logout")return new Response(null,{status:204});
      throw Error("Unexpected URL: "+url);
    };
    await import("../web/admin.mjs?detail-workspaces-test");
    const el=id=>dom.window.document.getElementById(id);
    el("adminEmail").value="master@example.test";el("adminPassword").value="test-password-123";
    el("adminLoginForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
    await pause(100);
    assert.equal(el("adminWorkspace").hidden,false);
    assert.equal(el("clients").querySelectorAll(".record-detail-open").length,1);
    el("clients").querySelector(".record-detail-open").click();
    assert.equal(el("clientDetail").hidden,false);
    assert.match(el("clientDetailFields").textContent,/client@example.test/);
    assert.match(el("clientDetailFields").textContent,/业务申请审核/);
    el("clientDetailMirror").click();await pause(50);
    assert.equal(el("mirrorEmail").textContent,"client@example.test");
    el("closeClientDetail").click();assert.equal(el("clientDetail").hidden,true);
    assert.equal(el("subadmins").querySelectorAll("button").length,1);
    el("subadmins").querySelector("button").click();
    assert.equal(el("subadminDetail").hidden,false);
    assert.match(el("subadminDetailFields").textContent,/sub@example.test/);
    el("adminLogout").click();
    assert.equal(el("subadminDetail").hidden,true);
    assert.equal(el("clientDetail").hidden,true);
    assert.equal(el("adminWorkspace").hidden,true);
  }finally{
    globalThis.document=old.document;globalThis.sessionStorage=old.sessionStorage;globalThis.fetch=old.fetch;dom.window.close();
  }
});
