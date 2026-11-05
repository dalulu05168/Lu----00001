import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

test("public trading pages avoid synthetic claims while administrative account classifications are explicit",async()=>{
  for(const file of ["index.html","app.mjs","admin.html"]){
    const source=await readFile(new URL("../web/"+file,import.meta.url),"utf8");
    assert.doesNotMatch(source,/模拟|虚拟|测试|simulation|mock|sandbox|demo/i,file);
  }
  const admin=await readFile(new URL("../web/admin.mjs",import.meta.url),"utf8");
  assert.match(admin,/模拟账户（无实盘）/);
  assert.match(admin,/真实账户（待接券商）/);
  assert.doesNotMatch(admin,/fixture only|mock_data|sandbox access/i);
});

test("trading terminal renders, switches markets, and handles account session without invented prices", async () => {
  const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /账户仅记录内部账面数据，不能代表真实证券或可提现资产。/);
  assert.doesNotMatch(html, /仅显示本账户数据库记录。未连接授权行情，不代表可提现资金或证券所有权。/);
  const dom = new JSDOM(html, { url: "https://platform.example/" });
  const old = { document: globalThis.document, sessionStorage: globalThis.sessionStorage, fetch: globalThis.fetch };
  const calls = [];
  const json = (status, body) => new Response(status === 204 ? null : JSON.stringify(body), {
    status, headers: { "content-type": "application/json" }
  });
  try {
    const savedItems = [];
    globalThis.document = dom.window.document;
    globalThis.sessionStorage = dom.window.sessionStorage;
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET", body: options.body });
      if (url === "/api/health") return json(200, { status: "alive", brokerConnected: false, pricingConnected: false });
      if (url === "/api/ready") return json(200, { status: "ready", database: "connected" });
      if (url === "/api/auth/login") return json(200, { token: "test-session-token" });
      if (url === "/api/watchlist") {
        const method=options.method||"GET";
        if(method==="GET")return json(200,{items:savedItems.map(item=>({...item}))});
        const item=JSON.parse(options.body);
        const index=savedItems.findIndex(x=>x.market===item.market&&x.symbol===item.symbol);
        if(method==="POST"&&index<0)savedItems.push(item);
        if(method==="DELETE"&&index>=0)savedItems.splice(index,1);
        return json(200,{item});
      }
      if (url === "/api/catalog") return json(200,{items:[{id:"test",itemType:"IPO",market:"US",symbol:"TESTIPO",name:"IPO资料"}]});
      if (url === "/api/internal-products") return json(200,{items:[]});
      if (url === "/api/internal-purchases") return json(200,{positions:[{code:"GOLD",name:"测试黄金",quantity:"3",cost_cents:"12300"}],purchases:[{product_code:"GOLD",product_name:"测试黄金",quantity:"3",unit_price_cents:"4100",total_cents:"12300",created_at:"2026-11-04T12:00:00Z"}]});
      if (url === "/api/account") return json(200, {
        account: { id: "account-1", cashCents: 125000, currency: "USD" },
        positions: [{ market: "US", symbol: "AAPL", quantity: "2" }],
        orders: []
      });
      if (url === "/api/auth/logout") return json(204);
      throw new Error("Unexpected URL: " + url);
    };
    await import("../web/app.mjs?dom-check");
    await new Promise(resolve => setTimeout(resolve, 10));
    const el = id => dom.window.document.getElementById(id);
    assert.equal(el("entryGate").hidden,false,"customer must see login first");
    assert.equal(el("overview").hidden,true,"workspace must be inaccessible before login");
    assert.match(el("entryGate").textContent,/CN Capital/);
    assert.equal(el("markets").querySelectorAll("button").length, 4);
    assert.equal(el("marketCards").querySelectorAll("button").length, 4);
    assert.equal(el("quotePrice").textContent, "—");
    assert.equal(el("performanceTitle").textContent,"Stock Chart / 股票走势");
    assert.equal(el("stockChart").querySelector("script"),null);
    assert.match(el("stockChart").textContent,/登录后查看公开走势图/);
    assert.doesNotMatch(html,/TradingView|tradingview|在数据源查看/);
    assert.doesNotMatch(html,/登录后可保存自选股票/);
    assert.equal(el("connectionText").textContent, "账户已连接 · 行情待接入");
    assert.equal(el("cash").textContent, "—");
    assert.equal(el("accountSummary").hidden, true);
    assert.equal(el("refreshAccountButton").hidden, true);
    assert.equal(el("orderForm").querySelector('button[type="submit"]').disabled, true);
    el("markets").querySelectorAll("button")[1].click();
    assert.equal(el("symbolTitle").textContent, "0700");
    el("symbols").querySelectorAll("button")[1].click();
    assert.equal(el("symbolTitle").textContent, "9988");
    assert.equal(el("stockChart").querySelector("script"),null);
    assert.equal(el("quotePrice").textContent,"—");
    assert.equal(el("orderSymbol").textContent, "HK · 9988");
    el("entryEmail").value = "user@example.com";
    el("entryPassword").value = "a-long-test-password";
    el("entryForm").dispatchEvent(new dom.window.SubmitEvent("submit", {
      bubbles: true, cancelable: true
    }));
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(el("entryGate").hidden,true,"signed-in user sees workspace");
    assert.equal(el("overview").hidden,false,"workspace requires verified account");
    assert.equal(el("cash").textContent, "1,250.00");
    assert.equal(el("positionCount").textContent, "2");
    assert.match(el("positions").textContent,/测试黄金.*GOLD.*123\.00.*3 份/);
    assert.match(el("transactionRows").textContent,/GOLD.*测试黄金.*\$41\.00.*\$123\.00.*已记录/);
    assert.equal(el("marketCards").querySelectorAll(".market-card-ratio")[0].textContent, "100%");
    assert.equal(el("marketCards").querySelectorAll(".market-card-detail")[0].textContent, "1 只标的");
    assert.equal(el("marketCards").querySelectorAll(".market-card-ratio")[1].textContent, "0%");
    assert.equal(el("positions").querySelectorAll(".holding-company").length, 2);
    assert.equal(el("positions").querySelector(".holding-name").textContent, "Apple Inc.");
    assert.equal(el("accountStatus").textContent, "已连接");
    assert.equal(el("watchlistToggle").disabled, false);
    assert.match(el("watchlistToggle").textContent, /加入自选/);
    el("watchlistToggle").click();
    await new Promise(resolve=>setTimeout(resolve,35));
    assert.equal(calls.some(call=>call.method==="POST"&&call.url==="/api/watchlist"),true);
    assert.match(el("watchlistToggle").textContent,/已加入自选/);
    assert.equal(el("savedWatchlistCount").textContent,"1");
    assert.equal(el("savedWatchlist").querySelectorAll(".saved-watchlist-row").length,1);
    assert.match(el("savedWatchlist").textContent,/9988/);
    el("markets").querySelectorAll("button")[0].click();
    assert.equal(el("symbolTitle").textContent,"AAPL");
    el("savedWatchlist").querySelector(".saved-watchlist-open").click();
    assert.equal(el("symbolTitle").textContent,"9988");
    assert.equal(JSON.parse(el("stockChart").querySelector("script").textContent).symbol,"HKEX:9988");
    el("refreshWatchlistButton").click();
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(el("savedWatchlistCount").textContent,"1");
    el("savedWatchlist").querySelector(".saved-watchlist-remove").click();
    await new Promise(resolve=>setTimeout(resolve,35));
    assert.equal(calls.some(call=>call.method==="DELETE"&&call.url==="/api/watchlist"),true);
    assert.equal(el("savedWatchlistCount").textContent,"0");
    assert.equal(el("savedWatchlist").querySelectorAll(".saved-watchlist-row").length,0);
    el("watchlistToggle").click();
    await new Promise(resolve=>setTimeout(resolve,35));
    assert.equal(el("savedWatchlistCount").textContent,"1");
    assert.equal(el("catalogItems").querySelectorAll(".catalog-row").length,1);
    assert.match(el("catalogItems").textContent,/IPO资料/);
    assert.doesNotMatch(el("catalogItems").textContent,/折扣|模拟|虚拟|测试/);
    assert.equal(el("accountSummary").hidden, false);
    assert.equal(el("accountIdLabel").textContent, "account-1");
    assert.equal(el("accountCashValue").textContent, "1,250.00");
    assert.equal(el("accountCurrency").textContent, "USD");
    assert.equal(el("accountSyncedAt").textContent.includes("同步"), true);
    const accountCallCount = calls.filter(call => call.url === "/api/account").length;
    el("refreshAccountButton").click();
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(calls.filter(call => call.url === "/api/account").length, accountCallCount + 1);
    assert.equal(el("accountCashValue").textContent, "1,250.00");
    assert.equal(el("accountSummary").hidden, false);
    assert.equal(el("quotePrice").textContent, "—");
    assert.equal(el("orderForm").querySelector('button[type="submit"]').disabled, true);
    assert.equal(calls.some(call => call.url === "/api/orders"), false);
    el("logout").click();
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(el("entryGate").hidden,false,"logout restores mandatory login");
    assert.equal(el("overview").hidden,true,"logout hides workspace");
    assert.equal(el("accountStatus").textContent, "未登录");
    assert.equal(el("cash").textContent, "—");
    assert.equal(el("watchlistToggle").disabled, true);
    assert.equal(el("catalogItems").querySelectorAll(".catalog-row").length,0);
    assert.equal(el("savedWatchlist").querySelectorAll(".saved-watchlist-row").length,0);
    assert.equal(el("savedWatchlistCount").textContent,"—");
    assert.equal(el("refreshWatchlistButton").hidden,true);
    assert.equal(el("accountSummary").hidden, true);
    assert.equal(el("refreshAccountButton").hidden, true);
    assert.equal(dom.window.sessionStorage.getItem("gsp_token"), null);
  } finally {
    globalThis.document = old.document;
    globalThis.sessionStorage = old.sessionStorage;
    globalThis.fetch = old.fetch;
    dom.window.close();
  }
});
