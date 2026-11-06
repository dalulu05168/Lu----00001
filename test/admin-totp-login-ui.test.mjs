import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";
const pause=ms=>new Promise(done=>setTimeout(done,ms));

test("admin login shows the TOTP setup secret on first enrollment, then only asks for a code afterward",async()=>{
  const html=await readFile(new URL("../web/admin.html",import.meta.url),"utf8");
  const dom=new JSDOM(html,{url:"https://qa.example/admin.html"});
  const old={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
  const respond=(status,body)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
  const requests=[];
  try{
    globalThis.document=dom.window.document;
    globalThis.sessionStorage=dom.window.sessionStorage;
    globalThis.fetch=async(url,options={})=>{
      requests.push({url,body:options.body?JSON.parse(options.body):undefined});
      if(url==="/api/admin/login")return respond(200,{
        totpSetupRequired:true,secret:"GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
        otpauthUri:"otpauth://totp/CN%20Capital%20Admin:admin%40example.test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=CN%20Capital%20Admin&algorithm=SHA1&digits=6&period=30",
        pendingToken:"pending-setup-token",expiresAt:new Date(Date.now()+600000).toISOString()
      });
      if(url==="/api/admin/totp/verify")return respond(200,{token:"admin-token",role:"MASTER",expiresAt:new Date(Date.now()+1800000).toISOString()});
      if(url==="/api/admin/me")return respond(200,{role:"MASTER",userId:"master-id"});
      if(url==="/api/admin/mirror-status")return respond(200,{ready:true,mode:"READ_ONLY"});
      if(["/api/admin/clients","/api/admin/subaccounts","/api/admin/listings"].includes(url))return respond(200,{items:[]});
      if(url==="/api/admin/logout")return new Response(null,{status:204});
      throw Error("Unexpected URL "+url);
    };
    await import("../web/admin.mjs?admin-totp-setup-ui-test");
    const el=id=>dom.window.document.getElementById(id);
    el("adminEmail").value="admin@example.test";
    el("adminPassword").value="testing-master-password";
    el("adminLoginForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
    await pause(80);
    assert.equal(el("adminLoginForm").hidden,true);
    assert.equal(el("adminTotpForm").hidden,false);
    assert.equal(el("totpSetupInfo").hidden,false);
    assert.match(el("totpSecretText").textContent,/GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ/);
    const login=requests.find(x=>x.url==="/api/admin/login");
    assert.deepEqual(Object.keys(login.body).sort(),["email","password"]);

    el("totpCode").value="123456";
    el("adminTotpForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
    await pause(80);
    const verify=requests.find(x=>x.url==="/api/admin/totp/verify");
    assert.deepEqual(verify.body,{pendingToken:"pending-setup-token",code:"123456"});
    assert.equal(el("adminWorkspace").hidden,false);
    assert.equal(dom.window.sessionStorage.getItem("gsp_admin_token"),"admin-token");

    el("adminLogout").click();
    assert.equal(el("admin-login").hidden,false);
    assert.equal(el("adminLoginForm").hidden,false);
    assert.equal(el("adminTotpForm").hidden,true);
    assert.equal(el("totpCode").value,"");
  }finally{
    globalThis.document=old.document;
    globalThis.sessionStorage=old.sessionStorage;
    globalThis.fetch=old.fetch;
    dom.window.close();
  }
});

test("admin login that is already enrolled only shows the code field, with no setup secret",async()=>{
  const html=await readFile(new URL("../web/admin.html",import.meta.url),"utf8");
  const dom=new JSDOM(html,{url:"https://qa.example/admin.html"});
  const old={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
  const respond=(status,body)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
  try{
    globalThis.document=dom.window.document;
    globalThis.sessionStorage=dom.window.sessionStorage;
    globalThis.fetch=async(url)=>{
      if(url==="/api/admin/login")return respond(200,{totpRequired:true,pendingToken:"pending-token",expiresAt:new Date(Date.now()+600000).toISOString()});
      if(url==="/api/admin/totp/verify")return respond(401,{error:"Invalid 2FA code"});
      throw Error("Unexpected URL "+url);
    };
    await import("../web/admin.mjs?admin-totp-enrolled-ui-test");
    const el=id=>dom.window.document.getElementById(id);
    el("adminEmail").value="admin@example.test";
    el("adminPassword").value="testing-master-password";
    el("adminLoginForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
    await pause(80);
    assert.equal(el("totpSetupInfo").hidden,true);
    el("totpCode").value="000000";
    el("adminTotpForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
    await pause(80);
    assert.match(el("loginFeedback").textContent,/Invalid 2FA code/);
    assert.equal(el("adminWorkspace").hidden,true);

    el("totpBack").click();
    assert.equal(el("adminLoginForm").hidden,false);
    assert.equal(el("adminTotpForm").hidden,true);
  }finally{
    globalThis.document=old.document;
    globalThis.sessionStorage=old.sessionStorage;
    globalThis.fetch=old.fetch;
    dom.window.close();
  }
});
