import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";

test("master and subadmin login gates, password-only setup and role-based admin workspace",async()=>{
  const html=await readFile(new URL("../web/admin.html",import.meta.url),"utf8");
  const dom=new JSDOM(html,{url:"https://preview.example/admin.html"});
  const old={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
  const requests=[];
  const respond=(status,body)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
  try{
    globalThis.document=dom.window.document;
    globalThis.sessionStorage=dom.window.sessionStorage;
    globalThis.fetch=async(url,options={})=>{
      requests.push({url,method:options.method,headers:options.headers,body:options.body?JSON.parse(options.body):undefined});
      if(url==="/api/admin/bootstrap"||url==="/api/admin/recover-pending-master")return respond(200,{role:"MASTER",ready:true});
      if(url==="/api/admin/login")return respond(200,{token:"admin-token",role:"MASTER"});
      if(url==="/api/admin/logout")return new Response(null,{status:204});
      if(url==="/api/admin/me")return respond(200,{role:"MASTER",userId:"master-1"});
      if(url==="/api/admin/mirror-status")return respond(200,{ready:true,mode:"READ_ONLY"});
      if(["/api/admin/subaccounts","/api/admin/clients","/api/admin/listings"].includes(url))return respond(200,{items:[]});
      throw Error("Unexpected URL "+url);
    };
    await import("../web/admin.mjs?admin-password-entry-test");
    const el=id=>dom.window.document.getElementById(id);
    assert.equal(el("adminWorkspace").hidden,true);
    assert.equal(el("adminTopbar").hidden,true);
    assert.equal(el("admin-login").hidden,false);
    assert.equal(el("bootstrapPanel").hidden,true);
    assert.doesNotMatch(html,/6 位动态验证码|adminOtp|activateForm|TOTP/);
    assert.equal(el("bootstrapEmail").value,"");
    assert.equal(el("recoverEmail").value,"");

    el("showAdminSetup").click();
    assert.equal(el("admin-login").hidden,true);
    assert.equal(el("bootstrapPanel").hidden,false);
    el("bootstrapEmail").value="chennan05168@gmail.com";
    el("bootstrapPassword").value="testing-master-password";
    el("bootstrapKey").value="owner-initialization-proof";
    el("bootstrapForm").dispatchEvent(new dom.window.Event("submit",{cancelable:true,bubbles:true}));
    await new Promise(done=>setTimeout(done,35));
    const setup=requests.find(x=>x.url==="/api/admin/bootstrap");
    assert.ok(setup);
    assert.equal(setup.body.email,"chennan05168@gmail.com");
    assert.deepEqual(Object.keys(setup.body).sort(),["email","password","setupKey"]);
    assert.match(el("bootstrapFeedback").textContent,/创建成功/);

    el("recoverEmail").value="chennan05168@gmail.com";
    el("recoverPassword").value="replacement-admin-password";
    el("recoverKey").value="owner-initialization-proof";
    el("recoverForm").dispatchEvent(new dom.window.Event("submit",{cancelable:true,bubbles:true}));
    await new Promise(done=>setTimeout(done,35));
    assert.ok(requests.some(x=>x.url==="/api/admin/recover-pending-master"));
    el("closeAdminSetup").click();
    assert.equal(el("admin-login").hidden,false);

    el("adminEmail").value="chennan05168@gmail.com";
    el("adminPassword").value="testing-master-password";
    el("adminLoginForm").dispatchEvent(new dom.window.Event("submit",{cancelable:true,bubbles:true}));
    await new Promise(done=>setTimeout(done,80));
    const login=requests.find(x=>x.url==="/api/admin/login");
    assert.deepEqual(Object.keys(login.body).sort(),["email","password"]);
    assert.equal(el("adminWorkspace").hidden,false);
    assert.equal(el("adminTopbar").hidden,false);
    assert.equal(el("admin-login").hidden,true);
    assert.equal(el("adminRole").textContent,"主账户");
    assert.equal(dom.window.sessionStorage.getItem("gsp_admin_token"),"admin-token");
    el("adminLogout").click();
    assert.equal(el("adminWorkspace").hidden,true);
    assert.equal(el("admin-login").hidden,false);
    assert.equal(dom.window.sessionStorage.getItem("gsp_admin_token"),null);
    dom.window.document.querySelector('[data-role-choice="SUBADMIN"]').click();
    el("adminEmail").value="chennan05168@gmail.com";
    el("adminPassword").value="testing-master-password";
    el("adminLoginForm").dispatchEvent(new dom.window.Event("submit",{cancelable:true,bubbles:true}));
    await new Promise(done=>setTimeout(done,45));
    assert.match(el("loginFeedback").textContent,/不属于所选角色/);
    assert.equal(el("adminWorkspace").hidden,true);
  }finally{
    globalThis.document=old.document;
    globalThis.sessionStorage=old.sessionStorage;
    globalThis.fetch=old.fetch;
    dom.window.close();
  }
});
