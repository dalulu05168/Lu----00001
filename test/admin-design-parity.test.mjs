import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";

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
  assert.match(css,/#adminWorkspace \.admin-nav #adminPages/);
  assert.match(css,/#adminWorkspace \.admin-main/);
  assert.match(css,/dialog\[open\]/);
  assert.match(css,/#d7ff00/);
  // The former public login page and its authentication form are intentionally untouched.
  assert.match(html,/class="portal"/);
});

test("mobile navigation and hidden role-specific controls are not overridden by styling",async()=>{
  const css=await file("web/admin-cn-v3.css");
  const js=await file("web/admin.mjs");
  assert.match(css,/#adminPages details\[hidden\] \{display:none!important\}/);
  assert.match(css,/data-mobile-open="true"/);
  assert.match(css,/#adminMobileNavToggle/);
  assert.match(js,/setMobileNavExpanded\(false\)/);
  assert.match(js,/\.dataset\.requiredRole!==role/);
});
