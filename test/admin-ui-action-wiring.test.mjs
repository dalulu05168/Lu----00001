import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";

const file=path=>readFile(new URL("../"+path,import.meta.url),"utf8");
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(fn,message){
  for(let tries=0;tries<90;tries++){
    const result=fn();
    if(result)return result;
    await pause(15);
  }
  throw new Error("Timed out waiting for "+message);
}

test("all static admin buttons and forms map to their preserved handlers and API allowlist",async()=>{
  const [html,js,router]=await Promise.all([
    file("web/admin.html"),file("web/admin.mjs"),file("src/admin-http.mjs")
  ]);
  const dom=new JSDOM(html);
  try{
    const doc=dom.window.document;
    const buttons=[...doc.querySelectorAll("button[id]")];
    const forms=[...doc.querySelectorAll("form[id]")];
    assert.ok(buttons.length>=52,"All current backend controls must be checked");
    assert.ok(forms.length>=15,"Existing authentication and module forms must survive");
    for(const form of forms){
      assert.ok(
        js.includes('el("'+form.id+'").addEventListener("submit"')||
        js.includes("el('"+form.id+"').addEventListener('submit'")||
        js.includes('el("'+form.id+'").addEventListener(\'submit\'')||
        js.includes("el('"+form.id+"').addEventListener(\"submit\""),
        "Missing submit handler for #"+form.id
      );
    }
    for(const button of buttons){
      if(button.type==="submit"){
        assert.ok(button.closest("form[id]"),"Submit button is orphaned: #"+button.id);
      }else{
        const hook='el("'+button.id+'").addEventListener("click"';
        const hookSingle="el('"+button.id+"').addEventListener('click'";
        const hookMixed="el('"+button.id+"').addEventListener(\"click\"";
        const hookOther='el("'+button.id+'").addEventListener(\'click\'';
        assert.ok([hook,hookSingle,hookMixed,hookOther].some(token=>js.includes(token)),
          "Static button is inert: #"+button.id);
      }
    }
    for(const attribute of ["data-role-choice","data-admin-page","data-dashboard-open",
      "data-client-tab","data-mirror-tab","data-mirror-operation-tab"]){
      assert.ok(doc.querySelector("button["+attribute+"]"),"Missing navigation group "+attribute);
      assert.ok(js.includes('querySelectorAll("['+attribute+']")'),"Missing delegated navigation handler "+attribute);
    }
    const allowed=[...router.matchAll(/"(\/api\/admin\/[a-z/-]+)":\[/g)].map(m=>m[1]);
    const routes=[...new Set([...js.matchAll(/api\(["'](\/admin\/[a-z/-]+)/g)].map(m=>"/api"+m[1]))];
    for(const route of routes)assert.ok(allowed.includes(route),"Admin UI calls a missing server route: "+route);
  }finally{dom.window.close();}
});

const FUND1="11111111-1111-4111-8111-111111111111";
const FUND2="22222222-2222-4222-8222-222222222222";
const CLIENT="33333333-3333-4333-8333-333333333333";

async function withAdminFixture(role,caseRows,run){
  const html=await file("web/admin.html");
  const dom=new JSDOM(html,{url:"https://admin.nuvexapro.com/"});
  const old={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
  const calls=[];
  const json=(body,status=200)=>new Response(JSON.stringify(body),{
    status,headers:{"content-type":"application/json"}
  });
  try{
    dom.window.HTMLElement.prototype.scrollIntoView=function(){};
    globalThis.document=dom.window.document;
    globalThis.sessionStorage=dom.window.sessionStorage;
    sessionStorage.setItem("gsp_admin_token","qa-admin-token");
    globalThis.fetch=async(url,options={})=>{
      calls.push({url,options});
      if(url==="/api/admin/me")return json({role,userId:"master-qa-user"});
      if(url==="/api/admin/clients"||url==="/api/admin/subaccounts"||url==="/api/admin/listings")
        return json({items:[]});
      if(url==="/api/admin/mirror-status")return json({ready:false});
      if(url==="/api/admin/workflow-requests?category=FUNDING")return json({items:caseRows});
      if(url==="/api/admin/workflow-requests"&&options.method==="PATCH")
        return json({item:{...caseRows.find(x=>x.id===JSON.parse(options.body).id),status:JSON.parse(options.body).status}});
      throw Error("Unmocked admin API request: "+url);
    };
    await import("../web/admin.mjs?admin-ui-action-wiring-"+role);
    const el=id=>dom.window.document.getElementById(id);
    await waitFor(()=>!el("adminWorkspace").hidden&&el("dashboardFundingRows").querySelector("button.funding-review-link"),"funding dashboard");
    await run({el,doc:dom.window.document,window:dom.window,calls});
  }finally{
    globalThis.document=old.document;globalThis.sessionStorage=old.sessionStorage;
    globalThis.fetch=old.fetch;dom.window.close();
  }
}

test("master can open exact funding record from dashboard or treasury and use existing approval API",async()=>{
  const rows=[
    {id:FUND1,clientId:CLIENT,category:"FUNDING",kind:"DEPOSIT",amountCents:12000,
      currency:"USD",status:"SUBMITTED",settlementStatus:"NOT_EXECUTED",createdAt:"2026-11-06T12:00:00Z"},
    {id:FUND2,clientId:CLIENT,category:"FUNDING",kind:"WITHDRAWAL",amountCents:2500,
      currency:"USD",status:"APPROVED",settlementStatus:"INTERNAL_POSTED",createdAt:"2026-11-05T12:00:00Z"}
  ];
  await withAdminFixture("MASTER",rows,async({el,doc,window,calls})=>{
    assert.equal(el("dashboardFundingRows").querySelectorAll("button.funding-review-link").length,2);
    const dashboardButton=el("dashboardFundingRows").querySelector("button.funding-review-link");
    dashboardButton.click();
    await waitFor(()=>!doc.querySelector('[data-pane="approvals"]').hidden&&!el("workflowReviewForm").hidden,
      "focused approval form");
    assert.equal(el("workflowCategory").value,"FUNDING");
    assert.equal(el("workflowItems").querySelector(".workflow-row-selected")?.dataset.workflowRequestId,FUND1);
    assert.equal(el("workflowDecision").value,"APPROVED");
    assert.equal(el("workflowReviewForm").hidden,false);
    assert.equal(calls.filter(x=>x.url==="/api/admin/workflow-requests"&&x.options.method==="PATCH").length,0,
      "Navigation must never approve automatically");
    el("workflowDecision").value="UNDER_REVIEW";
    el("workflowConfirm").checked=true;
    el("workflowReviewForm").dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true}));
    await waitFor(()=>calls.some(x=>x.url==="/api/admin/workflow-requests"&&x.options.method==="PATCH"),
      "approval API PATCH after explicit confirmation");
    const patch=calls.find(x=>x.url==="/api/admin/workflow-requests"&&x.options.method==="PATCH");
    assert.deepEqual(JSON.parse(patch.options.body),{
      category:"FUNDING",id:FUND1,expectedStatus:"SUBMITTED",status:"UNDER_REVIEW",reason:""
    });
    doc.querySelector('[data-admin-page="treasury"]').click();
    await waitFor(()=>el("fundingRequestRows").querySelectorAll("button.funding-review-link").length===2,
      "treasury action rows");
    const treasuryButtons=[...el("fundingRequestRows").querySelectorAll("button.funding-review-link")];
    treasuryButtons[1].click();
    await waitFor(()=>el("workflowItems").querySelector(".workflow-row-selected")?.dataset.workflowRequestId===FUND2,
      "read-only approved funding case");
    assert.equal(el("workflowReviewForm").hidden,true,"Approved requests cannot be reviewed again");
    assert.match(el("workflowStatus").textContent,/没有可执行的审核操作/);
    doc.querySelector('[data-admin-page="treasury"]').click();
    await waitFor(()=>!doc.querySelector('[data-pane="treasury"]').hidden,"treasury pane");
    el("openFundingApprovals").click();
    await waitFor(()=>!doc.querySelector('[data-pane="approvals"]').hidden,"treasury approval shortcut");
    assert.equal(el("workflowCategory").value,"FUNDING");
  });
});

test("subadmin can inspect own funding record without receiving master settlement option",async()=>{
  const rows=[{id:FUND1,clientId:CLIENT,category:"FUNDING",kind:"DEPOSIT",amountCents:12000,
    currency:"USD",status:"UNDER_REVIEW",settlementStatus:"NOT_EXECUTED",createdAt:"2026-11-06T12:00:00Z"}];
  await withAdminFixture("SUBADMIN",rows,async({el,doc,calls})=>{
    doc.querySelector('[data-admin-page="treasury"]').click();
    await waitFor(()=>el("fundingRequestRows").querySelector("button.funding-review-link"),"subadmin funding row");
    el("fundingRequestRows").querySelector("button.funding-review-link").click();
    await waitFor(()=>el("workflowItems").querySelector(".workflow-row-selected"),"subadmin inspected case");
    assert.equal(el("workflowReviewForm").hidden,true);
    assert.match(el("workflowStatus").textContent,/没有可执行的审核操作/);
    assert.ok(calls.every(x=>x.options.method!=="PATCH"),"Browsing must be read-only for subadmins");
  });
});
