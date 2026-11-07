import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";
import {createApi} from "../src/http-api.mjs";
import {request} from "node:http";

const get=path=>readFile(new URL("../"+path,import.meta.url),"utf8");
const ids=html=>[...new JSDOM(html).window.document.querySelectorAll("[id]")].map(el=>el.id);
test("restored customer workbench retains real app and original workflow elements",async()=>{
 const html=await get("web/index.html"),set=new Set(ids(html));
 const list=["entryGate","entryForm","entryEmail","entryPassword","overview","transactions-section",
  "transactionRows","orderForm","account-section","authForm","accountSummary","cash","stockChart",
  "watchlistToggle","fundingRequestForm","identityUploadForm","bankLinkRequestForm","customerSupportForm",
  "serviceRequestHistory","customerSupportMessages","adminLoginForm"].filter(x=>x!=="adminLoginForm");
 for(const id of list)assert.ok(set.has(id),"Missing original customer ID "+id);
 assert.equal(ids(html).length,set.size,"Duplicate IDs");
 assert.match(html,/src="\/app.mjs"/);
 assert.match(html,/src="\/mobile-entry.mjs"/);
 assert.doesNotMatch(html,/src="\/front-cn-v4\.mjs"/,"New desktop overlay is disabled");
 assert.match(html,/front-cn-v3\.css" media="\(max-width:900px\)"/);
 assert.match(html,/front-cn-v4\.css" media="\(max-width:900px\)"/);
 for(const name of ["cnMobileHeader","cnMobileHero","cnMobileTabs"])assert.ok(set.has(name),"Missing mobile hook "+name);
 assert.match(html,/portal-logo/,"Keep existing login logo");
 assert.match(html,/id="entryGate"/);
 assert.match(html,/id="overview" hidden/,"Do not display customer data without session");
});
test("restored admin sidebar keeps all approvals, API and 2FA hooks",async()=>{
 const html=await get("web/admin.html"),set=new Set(ids(html));
 const list=["adminLoginForm","adminTotpForm","adminEmail","adminPassword","totpCode","adminWorkspace",
 "adminTopbar","adminPages","adminMobileNavToggle","adminLogout","adminRole","adminPageTitle",
 "clientListView","refreshClients","adminMirrorResult","adminReadyResult","adminConnectionFeedback",
 "refreshAdminConnectionStatus","openFundingApprovals","commodityAuditPanel","adminClientCount",
 "dashboardFundingRows","dashboardOpenApprovals","productTermsDialog","privateDataDialog"];
 for(const id of list)assert.ok(set.has(id),"Missing required admin ID "+id);
 assert.equal(ids(html).length,set.size,"Duplicate admin IDs");
 assert.match(html,/class="admin-shell"/);
 assert.match(html,/class="admin-nav" id="adminTopbar"/);
 assert.match(html,/data-admin-page="approvals"/);
 assert.match(html,/data-admin-page="treasury"/);
 assert.match(html,/src="\/admin.mjs"/);
 assert.doesNotMatch(html,/admin-cn-v3\.css/);
 assert.match(html,/id="adminWorkspace" hidden/,"Do not reveal admin before TOTP auth");
});
test("isolated Node HTTP service serves restored customer, admin, and existing JS",async()=>{
 const server=createApi({db:{},resolveSession:async()=>null});
 await new Promise((resolve,reject)=>server.listen(0,"127.0.0.1",err=>err?reject(err):resolve()));
 const port=server.address().port;
 const http=(path,host)=>new Promise((resolve,reject)=>{
  const req=request({hostname:"127.0.0.1",port,path,headers:{Host:host}},res=>{
   const chunks=[];res.on("data",c=>chunks.push(c));res.on("error",reject);
   res.on("end",()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString("utf8")}));
  });req.on("error",reject);req.end();
 });
 try{
  const customer=await http("/","nuvexapro.com");
  const admin=await http("/","admin.nuvexapro.com");
  assert.equal(customer.status,200);
  assert.equal(admin.status,200);
  assert.match(customer.body,/id="transactionRows"/);
  assert.match(admin.body,/id="adminTotpForm"/);
  assert.match(admin.body,/class="admin-shell"/);
  assert.notEqual(customer.body,admin.body,"Both domains must not serve the same workbench");
  for(const asset of ["/app.mjs","/admin.mjs","/styles.css","/admin.css","/portal.mjs","/mobile-entry.mjs"]){
   const x=await http(asset,"nuvexapro.com");
   assert.equal(x.status,200,asset+" must be served");
   assert.ok(x.body.length>20,asset+" must have content");
  }
 }finally{
  server.closeAllConnections();
  await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
 }
});
