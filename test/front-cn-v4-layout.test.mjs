import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";
const get=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("original desktop business workspace is visible on wide screens; new shell disabled",async()=>{
 const html=await get("web/index.html");
 const doc=new JSDOM(html).window.document;
 assert.ok(doc.querySelector("#overview .sidebar .sidebar-logo"));
 assert.ok(doc.getElementById("transactions-section"));
 assert.ok(doc.getElementById("stockChart"));
 assert.ok(doc.getElementById("orderForm"));
 assert.ok(doc.getElementById("fundingRequestForm"));
 assert.ok(doc.getElementById("identityUploadForm"));
 assert.ok(doc.getElementById("bankLinkRequestForm"));
 assert.ok(doc.getElementById("customerSupportForm"));
 assert.ok(doc.getElementById("cnMobileHeader"),"Separate mobile navigation must be retained");
 assert.ok(doc.querySelector('link[href="/front-cn-v4.css"][media="(max-width:900px)"]'));
 assert.equal(doc.querySelector('script[src="/front-cn-v4.mjs"]'),null,"Do not re-enable replaced two-tab desktop shell");
 const ids=[...doc.querySelectorAll("[id]")].map(x=>x.id);
 assert.equal(new Set(ids).size,ids.length);
 assert.equal(doc.getElementById("overview").hidden,true,"Auth required to reveal old workspace");
});
test("Render static handler serves the new desktop UI bridge without changing API routing",async()=>{
 const server=await get("src/http-api.mjs");
 for(const asset of ["/front-cn-v4.css","/front-cn-v4.mjs"])
  assert.ok(server.includes('"'+asset+'"'),"Static allowlist missing "+asset);
 const app=await get("web/app.mjs");
 assert.match(app,/\/stock-quote/);
 assert.match(app,/\/internal-purchases/);
 assert.match(app,/\/account/);
});
