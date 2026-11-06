import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";

test("graphite terminal visual hierarchy preserves information architecture and responsive layout",async()=>{
 const html=await readFile(new URL("../web/admin.html",import.meta.url),"utf8");
 const css=await readFile(new URL("../web/admin.css",import.meta.url),"utf8");
 const dom=new JSDOM(html);
 const doc=dom.window.document;
 const groups=doc.querySelectorAll("#adminPages .admin-nav-group");
 assert.equal(groups.length,3);
 assert.equal(doc.querySelectorAll("#adminPages [data-admin-page]").length,10);
 assert.ok(doc.querySelector(".nav-brand-mark"));
 assert.ok(doc.querySelector(".nav-brand-copy"));
 const dashboard=doc.querySelector('[data-pane="dashboard"]');
 assert.ok(dashboard.querySelector(".dashboard-hero"));
 assert.ok(dashboard.querySelector(".dashboard-hero-art"));
 assert.deepEqual([...dashboard.querySelectorAll("[data-dashboard-open]")].map(x=>x.dataset.dashboardOpen),["clients","mirror"]);
 // The hero row (first .stats in document order) and the funding panel
 // below it both reuse the same .sc card style for their own metrics, so
 // scope to the hero row's own element rather than counting every .sc on
 // the page.
 assert.equal(dashboard.querySelector(".stats").querySelectorAll(".sc em").length,4);
 assert.ok(doc.querySelector("#clientDirectorySearch"));
 assert.ok(doc.querySelector("#clientDetailHeadline"));
 assert.ok(doc.querySelector("#mirrorOperations"));
 assert.ok(doc.querySelector("#mirrorPolicyForm"));
 assert.match(css, /Graphite 2\.0/);
 assert.match(css, /font-family:Inter/);
 assert.match(css, /--nx-blue:#8aaee0/);
 assert.match(css, /\.dashboard-hero-actions/);
 assert.match(css, /prefers-reduced-motion:reduce/);
 assert.match(css, /@media\(max-width:650px\)/);
 assert.match(css, /\.mirror-layout/);
 dom.window.close();
});

test("overview shortcuts open customer list and mirror workspaces without changing permissions",async()=>{
 const html=await readFile(new URL("../web/admin.html",import.meta.url),"utf8");
 const dom=new JSDOM(html,{url:"https://review.invalid/admin.html"});
 const before={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
 const reply=(status,data)=>new Response(status===204?null:JSON.stringify(data),
   {status,headers:{"content-type":"application/json"}});
 try{
  globalThis.document=dom.window.document;
  globalThis.sessionStorage=dom.window.sessionStorage;
  globalThis.fetch=async url=>{
   if(url==="/api/admin/login")return reply(200,{totpRequired:true,pendingToken:"pending-token",expiresAt:new Date(Date.now()+600000).toISOString()});
   if(url==="/api/admin/totp/verify")return reply(200,{token:"visual-qa-token",role:"MASTER",expiresAt:new Date(Date.now()+1800000).toISOString()});
   if(url==="/api/admin/me")return reply(200,{role:"MASTER",userId:"master-id"});
   if(["/api/admin/clients","/api/admin/subaccounts","/api/admin/listings"].includes(url))
    return reply(200,{items:[]});
   if(url==="/api/admin/mirror-status")return reply(200,{ready:true,mode:"READ_ONLY"});
   if(url==="/api/admin/logout")return reply(204,null);
   throw Error("Unexpected request "+url);
  };
  await import("../web/admin.mjs?visual-terminal-shortcuts");
  const el=id=>dom.window.document.getElementById(id);
  el("adminEmail").value="master@example.test";
  el("adminPassword").value="long-password-for-review";
  el("adminLoginForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,85));
  el("totpCode").value="123456";
  el("adminTotpForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,85));
  assert.equal(el("adminWorkspace").hidden,false);
  const client=dom.window.document.querySelector('[data-dashboard-open="clients"]');
  client.click();
  assert.equal(dom.window.document.querySelector('[data-pane="clients"]').hidden,false);
  assert.equal(dom.window.document.querySelector('[data-pane="dashboard"]').hidden,true);
  dom.window.document.querySelector('[data-admin-page="dashboard"]').click();
  const mirror=dom.window.document.querySelector('[data-dashboard-open="mirror"]');
  mirror.click();
  assert.equal(dom.window.document.querySelector('[data-pane="mirror"]').hidden,false);
  assert.equal(dom.window.document.querySelector('[data-admin-page="mirror"]').getAttribute("aria-current"),"page");
  el("adminLogout").click();
  assert.equal(el("adminWorkspace").hidden,true);
 }finally{
  globalThis.document=before.document;
  globalThis.sessionStorage=before.sessionStorage;
  globalThis.fetch=before.fetch;
  dom.window.close();
 }
});
