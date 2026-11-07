import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

test("keep original customer login shell and use the new CN charcoal terminal after sign-in",async()=>{
  const loginCss=await readFile(new URL("../web/styles.css",import.meta.url),"utf8");
  const loginHtml=await readFile(new URL("../web/index.html",import.meta.url),"utf8");
  const newHtml=await readFile(new URL("../web/cn-terminal.html",import.meta.url),"utf8");
  assert.match(loginCss,/font-family:"Inter","Helvetica Neue"/);
  assert.match(loginCss,/font-weight:400/);
  assert.match(loginHtml,/id="authForm"/);
  assert.match(loginHtml,/id="transactions-section"/);
  assert.match(loginHtml,/class="brand-mark"[^>]*><svg/);
  assert.match(newHtml,/--bg:#060705/);
  assert.match(newHtml,/--ac:#d7ff00/);
  assert.match(newHtml,/id="m-dep"/);
  assert.match(newHtml,/id="m-bank"/);
  assert.match(newHtml,/id="m-id"/);
  assert.doesNotMatch(newHtml,/\$256,430\.80|BBCA/);
});
