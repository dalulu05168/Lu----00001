// Read-only production smoke for the independent ADMIN hostname.
// No credentials, sessions, orders, or writes. Runs separately from frontend/mobile tests.
import assert from "node:assert/strict";
import {setTimeout as pause} from "node:timers/promises";

const origin="https://admin.nuvexapro.com";

async function get(path){
  const url=origin+path;
  let failure;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(url,{
        method:"GET",
        redirect:"follow",
        headers:{Accept:"text/html,text/css,text/javascript,image/svg+xml,application/json","Cache-Control":"no-cache"},
        signal:AbortSignal.timeout(20000)
      });
      const body=await response.text();
      assert.equal(response.status,200,"Live admin URL returned "+response.status+" at "+url);
      assert.equal(new URL(response.url).hostname,"admin.nuvexapro.com","Admin host redirected away unexpectedly");
      console.log("ADMIN_LIVE_HTTP "+JSON.stringify({path,status:response.status,bytes:body.length,type:response.headers.get("content-type"),cache:response.headers.get("cache-control")}));
      return {response,body};
    }catch(error){failure=error;if(attempt<2)await pause(1000)}
  }
  throw new Error("Live admin verification failed for "+url+": "+String(failure));
}

const login=await get("/");
assert.match(login.response.headers.get("content-type")||"",/text\/html/);
for(const id of ["adminLoginForm","adminTotpForm","adminWorkspace","adminPages","bootstrapForm","recoverForm"]){
  assert.ok(login.body.includes('id="'+id+'"'),"Missing functional admin element "+id);
}
assert.ok(login.body.includes('href="/admin-cn-v3.css"'),"New admin stylesheet is missing");
assert.ok(login.body.includes('src="/cn-login-logo.svg"'),"Animated CN logo is missing");
assert.ok(!login.body.includes('class="portal-subtitle"'),"Obsolete admin login subtitle is visible");
assert.ok(!login.body.includes('class="portal-foot"'),"Obsolete admin login footer is visible");
assert.equal((login.body.match(/data-admin-page=/g)||[]).length,10,"Expected all 10 management modules");
for(const id of ["dashboardFundingRows","fundingRequestRows","openFundingApprovals","refreshAdminConnectionStatus","adminReadyResult","adminMirrorResult","adminConnectionFeedback"])
  assert.ok(login.body.includes('id="'+id+'"'),"New admin operation missing on deployed page: "+id);
assert.match(login.body,/<th>操作<\/th>/,"Funding overview must expose the approval action column");

const css=await get("/admin-cn-v3.css");
assert.match(css.response.headers.get("content-type")||"",/text\/css/);
assert.match(css.body,/#adminWorkspace #adminTopbar/);
assert.match(css.body,/#adminWorkspace #adminPages/);
assert.match(css.body,/#adminWorkspace \.funding-review-link/);
assert.match(css.body,/#adminWorkspace \.admin-ops-toolbar/);
assert.ok(css.body.includes("display:block!important;min-height:38px"),"Production still serves the old hidden narrow-screen menu rule");

const logo=await get("/cn-login-logo.svg");
assert.match(logo.response.headers.get("content-type")||"",/image\/svg\+xml/);
assert.match(logo.body,/animation:cnRotateN 40s linear infinite/);
assert.match(logo.body,/transform:scale\(\.86\)/);
assert.ok(!logo.body.includes("rotateY("),"Admin logo must not flip around Y-axis");
assert.equal((logo.body.match(/class="cn-star"/g)||[]).length,12);

const app=await get("/admin.mjs");
assert.match(app.response.headers.get("content-type")||"",/javascript/);
assert.match(app.body,/adminLoginForm/);
assert.match(app.body,/adminTotpForm/);
assert.match(app.body,/function showFundingReview\(/,"Funding row drilldown handler missing");
assert.match(app.body,/function checkAdminConnections\(/,"Live status handler missing");
assert.match(app.body,/el\("refreshAdminConnectionStatus"\)\.addEventListener/);

const ready=await get("/ready");
assert.match(ready.response.headers.get("content-type")||"",/application\/json/);
assert.equal(JSON.parse(ready.body).status,"ready","Backend database is not ready");
console.log("ADMIN_LIVE_OK: admin hostname serves current login, CSS, 40s rotating N and 10 modules; database ready. Authenticated role workflows are not part of this public-only smoke.");


/* Issue #42 acceptance: verify the DEPLOYED admin control wiring, not just CSS.
 * Public GET requests only; never send a password, bearer token or mutate state. */
for(const id of ["refreshAdminConnectionStatus","adminReadyResult","adminMirrorResult",
  "openFundingApprovals","dashboardFundingRows","fundingRequestRows",
  "workflowReviewForm","workflowSubmit","adminLogout"]){
 assert.ok(login.body.includes('id="'+id+'"'),"Missing production admin control "+id);
}
for(const marker of ["checkAdminConnections","showFundingReview","fundingReviewTargetId",
  '"/admin/workflow-requests"',"adminConnectionSerial"]){
 assert.ok(app.body.includes(marker),"Production admin UI lacks functional event/API wiring: "+marker);
}
assert.ok(css.body.includes(".funding-review-link"),"Production funding buttons lack new admin styling");

const health=await get("/api/health");
assert.equal(JSON.parse(health.body).status,"alive","Public health endpoint is unavailable");

async function expectLoginRequired(path){
 const url=origin+path;
 const response=await fetch(url,{
  method:"GET",redirect:"manual",signal:AbortSignal.timeout(20000),
  headers:{Accept:"application/json","Cache-Control":"no-cache"}
 });
 assert.equal(response.status,401,"Endpoint must reject an unauthenticated GET: "+path);
 assert.match(response.headers.get("content-type")||"",/application\/json/);
 const payload=await response.json();
 assert.equal(payload.error,"Authentication required","Expected login gate on "+path);
 console.log("ADMIN_AUTH_BOUNDARY "+JSON.stringify({path,http:response.status,body:"Authentication required"}));
}
for(const path of ["/api/admin/me","/api/admin/clients","/api/admin/mirror-status",
 "/api/admin/workflow-requests?category=FUNDING","/api/account"]){
 await expectLoginRequired(path);
}
console.log("ADMIN_ISSUE42_LIVE_OK: 9 deployed controls, JS approval/health bindings and 5 unauthenticated access guards checked. No production credentials or writes.");
