import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";

test("first master setup uses independent backend auth and role-based admin dashboard",async()=>{
  const html=await readFile(new URL("../web/admin.html",import.meta.url),"utf8");
  const dom=new JSDOM(html,{url:"https://trade.maacropierce.com/admin.html"});
  const old={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
  const requests=[];
  const respond=(status,body)=>new Response(JSON.stringify(body),{
    status,headers:{"content-type":"application/json"}
  });
  try{
    globalThis.document=dom.window.document;
    globalThis.sessionStorage=dom.window.sessionStorage;
    globalThis.fetch=async(url,options={})=>{
      requests.push({url,method:options.method,headers:options.headers,body:options.body?JSON.parse(options.body):undefined});
      if(url==="/api/admin/bootstrap")return respond(201,{role:"MASTER",totpSecret:"A".repeat(32),setupUri:"otpauth://totp/test"});
      if(url==="/api/admin/activate")return respond(200,{activated:true,role:"MASTER"});
      if(url==="/api/admin/login")return respond(200,{token:"admin-token",role:"MASTER"});
      if(url==="/api/admin/me")return respond(200,{role:"MASTER",userId:"master-1"});
      if(["/api/admin/subaccounts","/api/admin/clients","/api/admin/listings"].includes(url))return respond(200,{items:[]});
      throw new Error("Unexpected URL "+url);
    };
    await import("../web/admin.mjs?admin-first-setup-test");
    const el=id=>dom.window.document.getElementById(id);
    assert.equal(el("adminWorkspace").hidden,true);
    assert.equal(el("bootstrapPanel").hidden,false);
    assert.equal(el("bootstrapEmail").value,"chennan05168@gmail.com");
    el("bootstrapPassword").value="testing-master-password";
    el("bootstrapKey").value="project-owner-initialization-proof";
    el("bootstrapForm").dispatchEvent(new dom.window.Event("submit",{cancelable:true,bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,40));
    assert.equal(requests[0].url,"/api/admin/bootstrap");
    assert.equal(requests[0].headers.authorization,undefined);
    assert.equal(requests[0].body.email,"chennan05168@gmail.com");
    assert.equal(requests[0].body.password,"testing-master-password");
    assert.equal(el("bootstrapResult").hidden,false);
    assert.equal(el("bootstrapPassword").value,"");
    assert.equal(el("bootstrapKey").value,"");
    el("activateEmail").value="chennan05168@gmail.com";
    el("activatePassword").value="testing-master-password";
    el("activateOtp").value="123456";
    el("activateForm").dispatchEvent(new dom.window.Event("submit",{cancelable:true,bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,40));
    assert.equal(requests[1].url,"/api/admin/activate");
    assert.equal(requests[1].headers.authorization,undefined);
    assert.equal(requests[1].body.otp,"123456");
    assert.equal(el("bootstrapResult").hidden,true);
    el("adminEmail").value="chennan05168@gmail.com";
    el("adminPassword").value="testing-master-password";
    el("adminOtp").value="123456";
    el("adminLoginForm").dispatchEvent(new dom.window.Event("submit",{cancelable:true,bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(requests[2].url,"/api/admin/login");
    assert.equal(requests[2].headers.authorization,undefined);
    assert.equal(el("adminWorkspace").hidden,false);
    assert.equal(el("adminRole").textContent,"主账户");
    assert.equal(el("subadminForm").hidden,false);
    assert.equal(el("listingForm").hidden,false);
    assert.equal(dom.window.sessionStorage.getItem("gsp_admin_token"),"admin-token");
    const adminGet=requests.find(x=>x.url==="/api/admin/me");
    assert.equal(adminGet.headers.authorization,"Bearer admin-token");
    el("adminLogout").click();
    assert.equal(dom.window.sessionStorage.getItem("gsp_admin_token"),null);
    assert.equal(el("adminWorkspace").hidden,true);
  }finally{
    globalThis.document=old.document;
    globalThis.sessionStorage=old.sessionStorage;
    globalThis.fetch=old.fetch;
    dom.window.close();
  }
});
