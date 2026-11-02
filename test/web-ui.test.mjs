import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

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
    globalThis.document = dom.window.document;
    globalThis.sessionStorage = dom.window.sessionStorage;
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET", body: options.body });
      if (url === "/api/health") return json(200, { status: "alive", brokerConnected: false, pricingConnected: false });
      if (url === "/api/ready") return json(200, { status: "ready", database: "connected" });
      if (url === "/api/auth/login") return json(200, { token: "test-session-token" });
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
    assert.equal(el("markets").querySelectorAll("button").length, 4);
    assert.equal(el("marketCards").querySelectorAll("button").length, 4);
    assert.equal(el("quotePrice").textContent, "—");
    assert.equal(el("connectionText").textContent, "账户已连接 · 行情待接入");
    assert.equal(el("cash").textContent, "—");
    assert.equal(el("accountSummary").hidden, true);
    assert.equal(el("refreshAccountButton").hidden, true);
    assert.equal(el("orderForm").querySelector('button[type="submit"]').disabled, true);
    el("markets").querySelectorAll("button")[1].click();
    assert.equal(el("symbolTitle").textContent, "0700");
    el("symbols").querySelectorAll("button")[1].click();
    assert.equal(el("symbolTitle").textContent, "9988");
    assert.equal(el("orderSymbol").textContent, "HK · 9988");
    el("email").value = "user@example.com";
    el("password").value = "a-long-test-password";
    const login = el("authForm").querySelector('button[value="login"]');
    el("authForm").dispatchEvent(new dom.window.SubmitEvent("submit", {
      bubbles: true, cancelable: true, submitter: login
    }));
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(el("cash").textContent, "1,250.00");
    assert.equal(el("positionCount").textContent, "1");
    assert.equal(el("marketCards").querySelectorAll(".market-card-ratio")[0].textContent, "100%");
    assert.equal(el("marketCards").querySelectorAll(".market-card-detail")[0].textContent, "1 只标的");
    assert.equal(el("marketCards").querySelectorAll(".market-card-ratio")[1].textContent, "0%");
    assert.equal(el("positions").querySelectorAll(".holding-company").length, 1);
    assert.equal(el("positions").querySelector(".holding-name").textContent, "Apple Inc.");
    assert.equal(el("accountStatus").textContent, "已连接");
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
    assert.equal(el("accountStatus").textContent, "未登录");
    assert.equal(el("cash").textContent, "—");
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
