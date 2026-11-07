import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";
const get=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("new real desktop shell replaces visible old navigation while retaining original API-bound DOM",async()=>{
 const html=await get("web/index.html");
 const js=await get("web/front-cn-v4.mjs");
 const css=await get("web/front-cn-v4.css");
 const doc=new JSDOM(html,{url:"https://nuvexapro.com/",runScripts:"outside-only"});
 const win=doc.window;
 win.matchMedia=()=>({matches:true});
 win.scrollTo=()=>{};
 const ids=[...win.document.querySelectorAll("[id]")].map(x=>x.id);
 win.eval(js);
 const v=win.document;
 assert.equal(v.getElementById("overview").dataset.cnV4Ready,"true");
 assert.equal(v.getElementById("overview").dataset.cnV4Tab,"trade");
 assert.ok(v.getElementById("cnV4Header"),"Actual new header not mounted");
 assert.equal(v.querySelectorAll("#cnV4Header [data-cn-v4-tab]").length,2);
 assert.equal(v.getElementById("transactionSearch").closest("#cnV4Header")?.id,"cnV4Header","Original live search was not reused");
 assert.equal(v.getElementById("exportHistoryButton").closest(".transaction-list-panel")?.classList.contains("transaction-list-panel"),true,"Original export button lost");
 for(const id of ["entryForm","stockChart","orderForm","holdings-section","transactionRows","savedWatchlist",
  "account-section","fundingRequestForm","bankLinkRequestForm","customerSupportForm",
  "identityUploadForm","internalProductsPanel","catalogItems","logout"])
  assert.ok(v.getElementById(id),"Existing connected functionality missing: "+id);
 const newIds=[...v.querySelectorAll("[id]")].map(x=>x.id);
 for(const id of ids)assert.ok(newIds.includes(id),"Removed legacy control ID "+id);
 assert.equal(new Set(newIds).size,newIds.length,"No duplicate IDs allowed");
 v.querySelector('[data-cn-v4-tab="account"]').click();
 assert.equal(v.getElementById("overview").dataset.cnV4Tab,"account");
 v.getElementById("cnV4Support").click();
 assert.equal(v.getElementById("overview").dataset.cnV4Tab,"account");
 v.querySelector('[data-cn-v4-tab="trade"]').click();
 assert.equal(v.getElementById("overview").dataset.cnV4Tab,"trade");
 v.getElementById("cnV4Hide").click();
 assert.ok(v.getElementById("overview").classList.contains("cn-v4-private"));
 const cash=v.getElementById("cash");
 cash.textContent="1,234.56";
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(v.getElementById("cnV4Cash").textContent,"$1,234.56","New cash label must mirror original live value");
 assert.match(html,/href="\/front-cn-v4\.css"/);
 assert.match(html,/src="\/front-cn-v4\.mjs"/);
 assert.match(css,/data-cn-v4-ready/);
 assert.match(css,/data-cn-v4-tab="account"/);
 assert.match(css,/data-cn-mode="mobile"/);
 win.close();
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
