import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("trading dashboard keeps the current dark CN Capital palette and real-data placeholders", async () => {
  const css=await readFile(new URL("../web/styles.css",import.meta.url),"utf8");
  const html=await readFile(new URL("../web/index.html",import.meta.url),"utf8");

  // The later visual layer is intentional and must not be silently replaced
  // by the 2026-11-02 charcoal prototype just to satisfy obsolete CSS snapshots.
  assert.match(css,/--tf-bg:#0c100e/i);
  assert.match(css,/--tf-accent:#b9f46a/i);
  assert.match(css,/\.main-content,\.workspace\{background:var\(--tf-bg\)\}/);
  assert.match(css,/\.market\.active\{background:var\(--tf-accent\)/);
  assert.match(css,/\.metric-value\{font-weight:650;font-size:26px;color:#f2f8ee\}/);

  for (const id of ["transactions-section","transactionRows","marketCards",
                    "accountStatus","authForm","orderForm","positions","cash"]) {
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(html,/class="brand-mark"[^>]*><svg/);
  assert.match(html,/class="metrics"/);
  assert.match(html,/class="primary-grid"/);
  assert.match(html,/class="secondary-grid"/);
  assert.equal((html.match(/class="metric-icon"/g)||[]).length,5);
  assert.ok(!html.includes("$256,430.80"));
  assert.ok(!html.includes("BBCA"));
});
