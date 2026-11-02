import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

test("dashboard follows the supplied dark charcoal transactions visual direction", async () => {
  const css = await readFile(new URL("../web/styles.css", import.meta.url), "utf8");
  const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");

  assert.match(css, /font-family:"Inter","Helvetica Neue"/);
  assert.match(css, /--surface:#1e2023/i);
  assert.match(css, /--border:#363a3f/i);
  assert.match(css, /background:#191b1e/i);
  const weights = [...css.matchAll(/font-weight\s*:\s*(\d+)/g)].map(match => Number(match[1]));
  assert.ok(weights.length > 0);
  assert.ok(weights.every(weight => weight <= 500), "UI should not add 600+ bold weights");
  assert.match(html, /id="transactions-section"/);
  assert.match(html, /id="transactionRows"/);
  assert.match(html, /class="metrics"/);
  assert.match(html, /class="primary-grid"/);
  assert.match(html, /class="secondary-grid"/);
  assert.equal((html.match(/class="metric-icon"/g) || []).length, 5);
  assert.ok(!html.includes("$256,430.80"), "Reference figures must not be treated as real data");
  assert.ok(!html.includes("BBCA"), "Reference tickers must not be copied into the live app");
});
