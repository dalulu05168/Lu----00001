import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = (status, body) => new Response(status === 204 ? null : JSON.stringify(body), {
  status, headers: {"content-type":"application/json"}
});

test("dark transactions workspace renders real account orders with filtering, pagination and CSV export", async () => {
  const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../web/styles.css", import.meta.url), "utf8");
  assert.match(html, /id="transactions-section"/);
  assert.match(html, /id="transactionRows"/);
  assert.match(html, /id="exportHistoryButton"/);
  assert.match(html,/class="terminal-top-search"/);
  assert.equal((html.match(/id="transactionSearch"/g)||[]).length,1);
  assert.doesNotMatch(html,/id="transactionRange"/);
  assert.doesNotMatch(html,/>Transaction Activity</);

  assert.match(css, /color-scheme:\s*dark/i);

  const dom = new JSDOM(html, {url:"https://platform.example/"});
  const old = {
    document:globalThis.document,
    sessionStorage:globalThis.sessionStorage,
    fetch:globalThis.fetch,
    createObjectURL:globalThis.URL.createObjectURL,
    revokeObjectURL:globalThis.URL.revokeObjectURL,
    anchorClick:dom.window.HTMLAnchorElement.prototype.click
  };
  const now = Date.now();
  const orders = Array.from({length:13}, (_, index) => ({
    id:"order-" + (index + 1),
    market:"US",
    symbol:index === 1 ? "MSFT" : index === 12 ? 'AAPL, "TEST"' : "AAPL",
    side:index % 2 ? "SELL" : "BUY",
    quantity:String(index + 1),
    price_cents:index === 12 ? null : "10000",
    amount_usd_cents:index === 12 ? null : String((index + 1) * 10000),
    created_at:index === 12 ? "bad-date" : new Date(now - (index === 0 ? 20 : index) * 60 * 60 * 24 * 1000).toISOString()
  }));
  let exportedBlob = null;
  let downloadedName = "";
  try {
    globalThis.document = dom.window.document;
    globalThis.sessionStorage = dom.window.sessionStorage;
    globalThis.fetch = async (url, options = {}) => {
      if (url === "/api/health") return json(200,{status:"alive",brokerConnected:false,pricingConnected:false});
      if (url === "/api/ready") return json(200,{status:"ready",database:"connected"});
      if (url === "/api/auth/login") return json(200,{token:"transactions-test-token"});
      if (url === "/api/account") return json(200,{
        account:{id:"account-test",cashCents:100000,currency:"USD"},
        positions:[],
        orders
      });
      if (url === "/api/watchlist") return json(200,{items:[]});
      if (url === "/api/catalog") return json(200,{items:[]});
      if (url === "/api/auth/logout") return json(204,{});
      throw new Error("Unexpected URL: " + url + " " + (options.method || "GET"));
    };
    globalThis.URL.createObjectURL = blob => {
      exportedBlob = blob;
      return "blob:transactions-test";
    };
    globalThis.URL.revokeObjectURL = () => {};
    dom.window.HTMLAnchorElement.prototype.click = function() {
      downloadedName = this.download;
    };

    await import("../web/app.mjs?transactions-view-check");
    await wait(20);
    const el = id => dom.window.document.getElementById(id);
    assert.equal(el("exportHistoryButton").disabled,true);
    el("email").value = "user@example.com";
    el("password").value = "a-long-test-password";
    const login = el("authForm").querySelector('button[value="login"]');
    el("authForm").dispatchEvent(new dom.window.SubmitEvent("submit",{
      bubbles:true,cancelable:true,submitter:login
    }));
    await wait(50);

    assert.equal(el("transactionVolume").textContent,"$7,800.00");
    assert.equal(el("realizedPnl").textContent,"—");
    assert.equal(el("internalRecordCount").textContent,"13");
    assert.match(el("transactionVolumeNote").textContent,/12 笔有效金额/);
    assert.match(el("transactions-section").querySelector(".execution-summary").textContent,/订单记录/);
    assert.equal(el("transactionRows").querySelectorAll("tr[data-transaction-row]").length,10);
    assert.match(el("transactionRows").textContent,/已记录/);
    assert.match(el("transactionPageSummary").textContent,/13/);
    assert.equal(el("exportHistoryButton").disabled,false);

    el("transactionNext").click();
    assert.equal(el("transactionRows").querySelectorAll("tr[data-transaction-row]").length,3);
    const malformedRow = el("transactionRows").querySelectorAll("tr[data-transaction-row]")[2];
    assert.equal(malformedRow.children[3].textContent,"—");
    assert.equal(malformedRow.children[5].textContent,"—");
    assert.equal(malformedRow.children[7].textContent,"—");

    el("transactionSearch").value = "MSFT";
    el("transactionSearch").dispatchEvent(new dom.window.Event("input",{bubbles:true}));
    assert.equal(el("transactionRows").querySelectorAll("tr[data-transaction-row]").length,1);
    assert.match(el("transactionRows").textContent,/MSFT/);

    assert.equal(el("transactionRows").querySelectorAll("tr[data-transaction-row]").length,1);
    assert.match(el("transactionPageSummary").textContent,/1/);

    el("exportHistoryButton").click();
    assert.ok(exportedBlob instanceof Blob);
    assert.match(downloadedName,/transactions-.*\.csv/);
    const filteredCsv = await exportedBlob.text();
    assert.match(filteredCsv,/MSFT/);
    assert.match(filteredCsv,/RECORDED/);
    el("transactionSearch").value = "";
    el("transactionSearch").dispatchEvent(new dom.window.Event("input",{bubbles:true}));
     el("exportHistoryButton").click();
    const allCsv = await exportedBlob.text();
    assert.ok(allCsv.includes('"AAPL, ""TEST"""'),"CSV must quote commas and embedded double quotes");
  } finally {
    globalThis.document = old.document;
    globalThis.sessionStorage = old.sessionStorage;
    globalThis.fetch = old.fetch;
    globalThis.URL.createObjectURL = old.createObjectURL;
    globalThis.URL.revokeObjectURL = old.revokeObjectURL;
    dom.window.HTMLAnchorElement.prototype.click = old.anchorClick;
    dom.window.close();
  }
});
