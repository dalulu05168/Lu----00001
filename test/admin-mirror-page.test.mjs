import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";

const pause=ms=>new Promise(done=>setTimeout(done,ms));
test("master can open a scoped client App mirror with account records and clear on logout",async()=>{
  const html=await readFile(new URL("../web/admin.html",import.meta.url),"utf8");
  const dom=new JSDOM(html,{url:"https://example.test/admin.html"});
  const old={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
  const clientId="11111111-1111-4111-8111-111111111111";
  const requests=[];
  const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
  try{
    globalThis.document=dom.window.document;
    globalThis.sessionStorage=dom.window.sessionStorage;
    globalThis.fetch=async (url,options={})=>{
      requests.push({url,options});
      if(url==="/api/admin/login")return reply(200,{totpRequired:true,pendingToken:"pending-token",expiresAt:new Date(Date.now()+600000).toISOString()});
      if(url==="/api/admin/totp/verify")return reply(200,{token:"admin-test-token",role:"MASTER",expiresAt:new Date(Date.now()+1800000).toISOString()});
      if(url==="/api/admin/me")return reply(200,{role:"MASTER",userId:"admin-id"});
      if(url==="/api/admin/clients")return reply(200,{items:[{id:clientId,email:"customer@example.test",subadmin_user_id:"sub-id"}]});
      if(url==="/api/admin/mirror-status")return reply(200,{ready:true,mode:"READ_ONLY"});
      if(url==="/api/admin/stock-history?symbol=AAPL")return reply(200,{symbol:"AAPL",points:[
        {time:Date.UTC(2026,9,1),price:98.75},{time:Date.UTC(2026,9,2),price:100.25}
      ]});
      if(url==="/api/admin/mirror-audit")return reply(200,{items:[{clientEmail:"customer@example.test",actorEmail:"master@example.test",viewedAt:"2026-11-03T00:00:00Z"}]});
      if(url==="/api/admin/subaccounts")return reply(200,{items:[]});
      if(url==="/api/admin/listings")return reply(200,{items:[]});
      if(url==="/api/admin/mirror-purchases"){
        if(options.method==="POST")return reply(201,{id:"test-purchase"});
        return reply(200,{items:[{code:"NEM",name:"Newmont",minimumQuantity:1,termsId:"test-terms",termsVersion:1,internalPriceCents:1000,discountBps:1000}]});
      }
      if(url==="/api/admin/mirror?clientId="+clientId)return reply(200,{
        mode:"READ_ONLY",checkedAt:"2026-11-03T00:00:00Z",
        client:{id:clientId,email:"customer@example.test"},
        account:{id:"acct-id",currency:"USD",cashCents:12900},
        positions:[{market:"US",symbol:"AAPL",quantity:"2"}],
        internalProducts:{positions:[{market:"US",symbol:"AA",name:"Alcoa",code:"AA",quantity:"10",cost_cents:"102080"}]},
        orders:[{id:"o1",market:"US",symbol:"AAPL",side:"BUY",quantity:"2",amount_usd_cents:10900}],
        watchlist:[{market:"US",symbol:"MSFT"}]
      });
      throw Error("Unexpected mocked URL: "+url);
    };
    await import("../web/admin.mjs?mirror-e2e");
    const el=id=>dom.window.document.getElementById(id);
    el("adminEmail").value="master@example.test";
    el("adminPassword").value="password-12345";
    assert.equal(el("admin-login").hidden,false);
    assert.equal(el("adminWorkspace").hidden,true);
    el("adminLoginForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
    await pause(55);
    el("totpCode").value="123456";
    el("adminTotpForm").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
    await pause(55);
    assert.equal(el("adminWorkspace").hidden,false);
    assert.equal(el("mirrorClientList").querySelectorAll(".mirror-open").length,1);
    assert.equal(el("mirrorClientList").querySelector(".mirror-open").disabled,false);
    el("mirrorClientSearch").value="does-not-exist";
    el("mirrorClientSearch").dispatchEvent(new dom.window.Event("input",{bubbles:true}));
    assert.equal(el("mirrorClientList").querySelectorAll(".mirror-open").length,0);
    assert.equal(el("clients").querySelectorAll(".mirror-open").length,1);
    el("mirrorClientSearch").value="CUSTOMER@";
    el("mirrorClientSearch").dispatchEvent(new dom.window.Event("input",{bubbles:true}));
    assert.equal(el("mirrorClientList").querySelectorAll(".mirror-open").length,1);
    el("mirrorClientList").querySelector(".mirror-open").click();
    await pause(55);
    assert.equal(el("mirrorDialog").open,true);
    assert.equal(dom.window.document.querySelector('[data-pane="mirror"]').hidden,false);
    assert.equal(el("mirrorEmail").textContent,"customer@example.test");
    assert.equal(el("mirrorCash").textContent,"129.00");
    assert.equal(el("mirrorPageTitle").textContent,"自选");
    assert.match(el("mirrorAppScreen").textContent,/MSFT/);
    el("mirrorAppScreen").querySelector(".mirror-quote-row").click();
    const chartScript=el("mirrorAppScreen").querySelector(".mirror-chart script");
    assert.match(chartScript.src,/embed-widget-advanced-chart\.js$/);
    const chartOptions=JSON.parse(chartScript.textContent);
    assert.equal(chartOptions.symbol,"NASDAQ:MSFT");
    assert.equal(chartOptions.style,"2");
    assert.equal(chartOptions.autosize,true);
    el("mirrorAppScreen").querySelector("select").value="NYSE:AA";
    el("mirrorAppScreen").querySelector("select").dispatchEvent(new dom.window.Event("change"));
    assert.match(el("mirrorStatus").textContent,/快照已读取/);
    dom.window.document.querySelector('[data-mirror-tab="market"]').click();
    assert.equal(el("mirrorPageTitle").textContent,"行情");
    assert.equal(el("mirrorAppScreen").parentElement.dataset.activePage,"market");
    const chartConfig=JSON.parse(el("mirrorAppScreen").querySelector("script").textContent);
    assert.equal(chartConfig.symbol,"NYSE:AA");
    assert.equal(chartConfig.locale,"zh_CN");
    assert.equal(el("mirrorAppScreen").querySelector(".phone-market-identity strong").textContent,"AA");
    const chartPicker=el("mirrorAppScreen").querySelector("select");
    chartPicker.value="NASDAQ:AAPL";
    chartPicker.dispatchEvent(new dom.window.Event("change"));
    assert.equal(JSON.parse(el("mirrorAppScreen").querySelector("script").textContent).symbol,"NASDAQ:AAPL");
    await pause(20);
    assert.match(el("mirrorAppScreen").querySelector(".history-cursor").textContent,/100\.25.*2026-10-02/);
    assert.match(el("mirrorClock").textContent,/^\d{2}:\d{2}$/);
    dom.window.document.querySelector('[data-mirror-tab="trade"]').click();
    await pause(40);
    const trade=el("mirrorAppScreen").querySelector("form");
    assert.match(el("mirrorAppScreen").querySelector(".phone-data-card").textContent,/Newmont.*优惠 10%/);
    assert.match(trade.textContent,/NEM.*实付 9\.00 USD/);
    const [pin,password]=trade.querySelectorAll('input[type="password"]');
    pin.value="001234";password.value="synthetic-admin-password";
    trade.querySelector('input[type="checkbox"]').checked=true;
    trade.dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
    await pause(40);
    const post=requests.find(x=>x.url==="/api/admin/mirror-purchases"&&x.options.method==="POST");
    assert.ok(post.options.headers["idempotency-key"]);
    assert.equal(JSON.parse(post.options.body).clientId,clientId);
    assert.match(el("mirrorStatus").textContent,/购买已记录/);
    dom.window.document.querySelector('[data-mirror-tab="positions"]').click();
    assert.match(el("mirrorAppScreen").textContent,/AAPL/);
    const cards=el("mirrorAppScreen").querySelectorAll(".phone-holding-card");
    assert.equal(cards.length,2);
    assert.match(cards[1].textContent,/Alcoa.*10 股.*1,020\.80/);
    dom.window.document.querySelector('[data-mirror-tab="orders"]').click();
    assert.match(el("mirrorAppScreen").textContent,/买入/);
    el("mirrorAppScreen").querySelector('[data-filter="卖出"]').click();
    assert.match(el("mirrorAppScreen").textContent,/当前筛选下暂无订单记录/);
    el("mirrorAppScreen").querySelector('[data-filter="买入"]').click();
    assert.equal(el("mirrorAppScreen").querySelectorAll(".phone-data-row").length,1);
    dom.window.document.querySelector('[data-mirror-tab="assets"]').click();
    assert.match(el("mirrorAppScreen").querySelector(".phone-account-grid").textContent,/USD.*129.00/);
    dom.window.document.querySelector('[data-mirror-tab="watchlist"]').click();
    assert.match(el("mirrorAppScreen").textContent,/MSFT/);
    assert.ok(requests.some(x=>x.url.includes("/api/admin/mirror?clientId=")&&x.options.headers.authorization==="Bearer admin-test-token"));
    dom.window.document.querySelector('[data-admin-page="audit"]').click();
    await pause(45);
    assert.match(el("mirrorAuditList").textContent,/customer@example.test/);
    assert.match(el("mirrorAuditStatus").textContent,/1 条/);
    assert.equal(el("mirrorDialog").open,false);
    el("mirrorClientList").querySelector(".mirror-open").click();
    await pause(40);
    assert.equal(el("mirrorDialog").open,true);
    el("mirrorDialogClose").click();
    assert.equal(el("mirrorDialog").open,false);
    el("adminLogout").click();
    assert.equal(el("adminWorkspace").hidden,true);
    assert.equal(el("mirrorCash").textContent,"—");
    assert.equal(el("mirrorClientList").childElementCount,0);
    assert.equal(el("mirrorClientSearch").value,"");
  }finally{
    globalThis.document=old.document;
    globalThis.sessionStorage=old.sessionStorage;
    globalThis.fetch=old.fetch;
    dom.window.close();
  }
});
