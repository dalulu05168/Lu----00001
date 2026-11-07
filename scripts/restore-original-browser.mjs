import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import {chromium} from "playwright";
import {createApi} from "../src/http-api.mjs";
const output="artifacts/original-ui-restore";
await mkdir(output,{recursive:true});
const app=createApi({db:{},resolveSession:async()=>null});
await new Promise((res,rej)=>app.listen(0,"127.0.0.1",e=>e?rej(e):res()));
const address="http://127.0.0.1:"+app.address().port;
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const errors=[];const browserEvidence={revision:process.env.GITHUB_SHA||"local",isolated:true,authenticated:false,mutations:false};
try{
 const desktop=await browser.newPage({viewport:{width:1440,height:900}});
 desktop.on("pageerror",err=>errors.push("customer "+err.message));
 const first=await desktop.goto(address+"/",{waitUntil:"domcontentloaded"});
 assert.equal(first.status(),200);
 await desktop.locator("#entryForm").waitFor({state:"visible",timeout:12000});
 assert.equal(await desktop.locator("#overview").isVisible(),false,"A logged-out user must not see private workspace");
 assert.equal(await desktop.locator("#transactionRows").count(),1);
 assert.equal(await desktop.locator("#serviceRequestsPanel").count(),1);
 assert.equal(await desktop.locator("link[href='/front-cn-v4.css']").getAttribute("media"),"(max-width:900px)");
 assert.equal(await desktop.locator("script[src='/front-cn-v4.mjs']").count(),0);
 browserEvidence.customerLoginLoaded=true;
 // Snapshot of the old workspace structure only, not authenticated account data.
 await desktop.evaluate(()=>{document.getElementById("entryGate").hidden=true;document.getElementById("overview").hidden=false;});
 await desktop.screenshot({path:output+"/customer-original-workbench-1440.png",fullPage:true});
 browserEvidence.customerOldWorkspace=(await desktop.locator(".sidebar-logo").count()===1&&await desktop.locator("#transactions-section").count()===1);
 assert.equal(browserEvidence.customerOldWorkspace,true);
 const admin=await browser.newPage({viewport:{width:1440,height:900}});
 admin.on("pageerror",err=>errors.push("admin "+err.message));
 const second=await admin.goto(address+"/admin.html",{waitUntil:"domcontentloaded"});
 assert.equal(second.status(),200);
 await admin.locator("#adminLoginForm").waitFor({state:"visible",timeout:12000});
 assert.equal(await admin.locator("#adminTotpForm").count(),1);
 assert.equal(await admin.locator("#adminWorkspace").isVisible(),false,"Admin TOTP login required before workspace");
 await admin.evaluate(()=>{document.getElementById("admin-login").hidden=true;document.getElementById("adminWorkspace").hidden=false;document.getElementById("adminTopbar").hidden=false;});
 const state=await admin.evaluate(()=>({
  nav:getComputedStyle(document.querySelector("#adminPages")).display,
  sidebar:getComputedStyle(document.querySelector("#adminTopbar")).display,
  newCSS:!!document.querySelector("link[href='/admin-cn-v3.css']"),
  realTabs:document.querySelectorAll("[data-admin-page]").length,
  approvals:!!document.getElementById("openFundingApprovals"),
  connections:!!document.getElementById("refreshAdminConnectionStatus")
 }));
 assert.equal(state.newCSS,false);
 assert.notEqual(state.nav,"none");
 assert.notEqual(state.sidebar,"none");
 assert.equal(state.realTabs,10);
 assert.equal(state.approvals,true);
 assert.equal(state.connections,true);
 await admin.screenshot({path:output+"/admin-original-workbench-1440.png",fullPage:true});
 browserEvidence.admin=state;
 assert.deepEqual(errors,[],"No uncaught browser Javascript exceptions");
 browserEvidence.pageErrors=errors;
 await writeFile(output+"/evidence.json",JSON.stringify(browserEvidence,null,2));
 console.log("RESTORE_ORIGINAL_WORKSPACES_BROWSER_OK "+JSON.stringify(browserEvidence));
}finally{
 await browser.close();
 app.closeAllConnections();
 await new Promise((res,rej)=>app.close(e=>e?rej(e):res()));
}
