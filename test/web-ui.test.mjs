import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

test("public trading pages disclose the simulation plainly to customers",async()=>{
  const index=await readFile(new URL("../web/index.html",import.meta.url),"utf8");
  // Customer must be told inside the authenticated app, not in the login footer, that this is a
  // simulation: no real money, no real securities, no broker/exchange order routing.
  const parsed=new JSDOM(index).window.document;
  assert.doesNotMatch(parsed.getElementById("entryGate").textContent,/模拟交易平台/);
  const disclosed=parsed.getElementById("overview").textContent;
  assert.match(disclosed,/模拟交易平台/,"authenticated account app must disclose simulated orders");
  assert.match(disclosed,/不涉及真实资金/);
  assert.match(disclosed,/不向(任何)?(交易所|券商)/);
  const admin=await readFile(new URL("../web/admin.mjs",import.meta.url),"utf8");
  assert.match(admin,/模拟账户（无实盘）/);
  assert.match(admin,/真实账户（待接券商）/);
  assert.doesNotMatch(admin,/fixture only|mock_data|sandbox access/i);
});

test("trading terminal renders, switches markets, and handles account session without invented prices", async () => {
  const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
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
      if (url === "/api/internal-products") return json(200,{items:[
        {itemType:"FUND",name:"测试基金",code:"FUND30",internalPriceCents:10000,discountBps:1000,minimumQuantity:1,
          unit:"份",fundDays:30,fundReturnBps:500,fundImageUrl:"https://example.test/fund.jpg"}
      ]});
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
    assert.equal(el("markets").querySelectorAll("button").length, 5);
    assert.equal(el("marketCards").querySelectorAll("button").length, 2);
    assert.equal(el("quotePrice").textContent, "—");
    assert.equal(el("performanceTitle").textContent,"股票走势");
    assert.equal(el("stockChart").querySelector("script"),null);
    assert.match(el("stockChart").textContent,/登录后查看公开走势图/);
    assert.doesNotMatch(html,/TradingView|tradingview|在数据源查看/);
    assert.doesNotMatch(html,/登录后可保存自选股票/);
    assert.equal(el("connectionText").textContent, "账户已连接 · 行情待接入");
    assert.equal(el("cash").textContent, "—");
    assert.equal(el("accountSummary").hidden, true);
    assert.equal(el("refreshAccountButton").hidden, true);
    assert.equal(el("orderForm").querySelector('button[type="submit"]').disabled, true);
    // This also exercises
    // cross-market switching via RO, then within-market switching via US's
    // two instruments.
    el("markets").querySelectorAll("button")[4].click();
    assert.equal(el("symbolTitle").textContent, "BRD");
    el("markets").querySelectorAll("button")[0].click();
    el("symbols").querySelectorAll("button")[1].click();
    assert.equal(el("symbolTitle").textContent, "MSFT");
    assert.equal(el("stockChart").querySelector("script"),null);
    assert.equal(el("quotePrice").textContent,"—");
    assert.equal(el("orderSymbol").textContent, "US · MSFT");
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
    el("tradeCategories").querySelector('[data-trade-category="FUND"]').click();
    assert.match(el("internalProductsItems").textContent,/测试基金.*持有 30 天.*固定收益 5%.*到期返还 \$94\.50/);
    assert.equal(el("internalProductsItems").querySelector("img").getAttribute("referrerpolicy"),"no-referrer");
    assert.equal(el("watchlistToggle").disabled, false);
    assert.match(el("watchlistToggle").textContent, /加入自选/);
    el("watchlistToggle").click();
    await new Promise(resolve=>setTimeout(resolve,35));
    assert.equal(calls.some(call=>call.method==="POST"&&call.url==="/api/watchlist"),true);
    assert.match(el("watchlistToggle").textContent,/已加入自选/);
    assert.equal(el("savedWatchlistCount").textContent,"1");
    assert.equal(el("savedWatchlist").querySelectorAll(".saved-watchlist-row").length,1);
    assert.match(el("savedWatchlist").textContent,/MSFT/);
    el("symbols").querySelectorAll("button")[0].click();
    assert.equal(el("symbolTitle").textContent,"AAPL");
    el("savedWatchlist").querySelector(".saved-watchlist-open").click();
    assert.equal(el("symbolTitle").textContent,"MSFT");
    assert.equal(JSON.parse(el("stockChart").querySelector("script").textContent).symbol,"NASDAQ:MSFT");
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
