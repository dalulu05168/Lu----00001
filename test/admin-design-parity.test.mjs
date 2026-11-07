import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";
import {createApi} from "../src/http-api.mjs";
import {request} from "node:http";

const file=async path=>readFile(new URL("../"+path,import.meta.url),"utf8");
const requiredPages=[
  "dashboard","accounts","clients","mirror","catalog",
  "commodities","approvals","treasury","support","audit"
];
const coreControls=[
  "adminLoginForm","adminEmail","adminPassword",
  "adminTotpForm","totpCode","bootstrapForm","recoverForm",
  "adminWorkspace","adminPages","adminRole","adminMobileNavToggle","adminLogout",
  "adminClientCount","adminSubadminCount","adminListingCount",
  "subadminForm","subadminDetail","subadminPolicyForm",
  "clientDetail","clientPolicyForm","clientWorkflowPanel",
  "mirrorDialog","mirrorPolicyForm","mirrorReviewForm",
  "listingForm","listingLookup","commodityForm","workflowReviewForm",
  "fundingRequestRows","supportReplyForm","supportStatusForm",
  "unifiedAuditList","productTermsDialog","privateDataDialog"
];

test("backend keeps all ten live management pages and matching navigation entries",async()=>{
  const source=await file("web/admin.html");
  const document=new JSDOM(source).window.document;
  const panes=[...document.querySelectorAll("[data-pane]")].map(x=>x.dataset.pane);
  const tabs=[...document.querySelectorAll("[data-admin-page]")].map(x=>x.dataset.adminPage);
  assert.deepEqual(panes,requiredPages);
  assert.deepEqual(tabs,requiredPages);
  assert.equal(document.querySelectorAll("#adminPages details").length,3);
  for(const id of coreControls)assert.ok(document.getElementById(id),"Missing existing production control #"+id);
  const all=[...document.querySelectorAll("[id]")].map(x=>x.id);
  assert.equal(new Set(all).size,all.length,"Duplicate HTML id breaks existing event handlers");
});

test("original login, role security and live admin API logic stay in place",async()=>{
  const html=await file("web/admin.html");
  const js=await file("web/admin.mjs");
  assert.match(html,/id="adminLoginForm"/);
  assert.match(html,/id="adminTotpForm"/);
  assert.match(html,/src="\/admin\.mjs"/);
  assert.match(js,/api\("\/admin\/me"\)/);
  assert.match(js,/\[data-required-role\]/);
  assert.match(html,/id="adminPages"/);
  assert.match(js,/data-admin-page/);
});

test("new charcoal/lime admin design is served and does not replace login page",async()=>{
  const html=await file("web/admin.html");
  const css=await file("web/admin-cn-v3.css");
  const gateway=await file("src/http-api.mjs");
  const document=new JSDOM(html).window.document;
  const links=[...document.querySelectorAll('link[rel="stylesheet"]')].map(x=>x.getAttribute("href"));
  assert.deepEqual(links,["/admin.css","/portal.css","/admin-cn-v3.css"]);
  assert.match(gateway,/"\/admin-cn-v3\.css"/);
  assert.ok(document.querySelector("#adminWorkspace #adminPages.admin-nav"),"The live nav uses #adminPages itself as .admin-nav");
  assert.match(css,/#adminWorkspace\s+#adminTopbar\s*\{[^}]*margin-left:\s*0/);
  assert.match(css,/#adminWorkspace\s+#adminPages\s*\{/);
  assert.match(css,/#adminWorkspace\s+#adminPages\s*\{\s*position:\s*static;[^}]*min-height:\s*0;[^}]*flex-direction:\s*row/);
  assert.match(css,/#adminWorkspace\s+#adminPages summary\s*\{display:none!important\}/);
  assert.match(css,/#adminWorkspace \.admin-main/);
  assert.match(css,/dialog\[open\]/);
  assert.match(css,/#d7ff00/);
  const loginLogo=document.querySelector("#admin-login .portal-logo img");
  assert.equal(loginLogo?.getAttribute("src"),"/cn-login-logo.svg");
  assert.match(css,/#admin-login\.portal\s*\{[^}]*#090c09/);
  assert.match(css,/#admin-login \.portal-primary\s*\{[^}]*#d7ff00/);
  // The admin login keeps its existing markup/auth forms; only its scoped visual skin changes.
  assert.match(html,/class="portal"/);
  assert.match(html,/id="adminTotpForm"/);
});

test("mobile navigation and hidden role-specific controls are not overridden by styling",async()=>{
  const html=await file("web/admin.html");
  const css=await file("web/admin-cn-v3.css");
  const js=await file("web/admin.mjs");
  const document=new JSDOM(html).window.document;
  const menu=document.getElementById("adminMobileNavToggle");
  const audit=document.querySelector('[data-admin-page="audit"]');
  assert.ok(menu,"Mobile menu toggle remains present");
  assert.equal(menu.getAttribute("aria-controls"),"adminPages");
  assert.ok(audit?.closest('details[data-required-role="MASTER"]'),"Audit remains restricted to MASTER in the nav");
  assert.match(css,/#adminWorkspace\s+#adminPages\s+button\[hidden\],\s*#adminWorkspace\s+#adminPages\s+details\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  assert.match(css,/#adminWorkspace\s+#adminPages\[data-mobile-open="true"\]\s*\{\s*display:\s*flex\s*!important;?\s*\}/);
  assert.match(css,/#adminWorkspace\s+#adminPages\s*\{\s*display:\s*none\s*!important;/);
  assert.match(css,/#adminWorkspace\s+#adminTopbar\s+#adminMobileNavToggle\s*\{\s*display:\s*block/);
  assert.match(js,/setMobileNavExpanded\(false\)/);
  assert.match(js,/\.dataset\.requiredRole!==role/);
});

test("Render HTTP gateway serves admin-only design CSS and preserves split domain landing",async()=>{
  const server=createApi({db:{},resolveSession:async()=>null});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  // The Fetch API can normalize the Host header; use a raw Node HTTP request
  // to accurately exercise the domain-routing rule deployed behind Render.
  const get=(path,host)=>new Promise((resolve,reject)=>{
    const req=request({
      hostname:"127.0.0.1",port:server.address().port,path,method:"GET",
      headers:{Host:host}
    },response=>{
      const chunks=[];
      response.on("data",x=>chunks.push(x));
      response.on("end",()=>resolve({
        status:response.statusCode,type:response.headers["content-type"],
        body:Buffer.concat(chunks).toString("utf8")
      }));
      response.on("error",reject);
    });
    req.on("error",reject);req.end();
  });
  try{
    const css=await get("/admin-cn-v3.css","admin.nuvexapro.com");
    assert.equal(css.status,200);
    assert.match(css.type||"",/text\/css/);
    assert.match(css.body,/#adminWorkspace \.admin-shell/);
    const admin=await get("/","admin.nuvexapro.com");
    assert.equal(admin.status,200);
    assert.match(admin.body,/id="adminLoginForm"/);
    const customer=await get("/","nuvexapro.com");
    assert.equal(customer.status,200);
    assert.doesNotMatch(customer.body,/id="adminLoginForm"/);
  }finally{
    server.closeAllConnections();
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
