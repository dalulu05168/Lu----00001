import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

test("login keeps its existing light design while the new terminal uses readable dark tokens",async()=>{
  const css=await readFile(new URL("../web/styles.css",import.meta.url),"utf8");
  const terminal=await readFile(new URL("../web/cn-terminal.html",import.meta.url),"utf8");
  const admin=await readFile(new URL("../web/cn-admin.html",import.meta.url),"utf8");
  assert.match(css,/color:#000000;background:#f6f7f9/);
  assert.match(css,/--text:#000000/);
  assert.match(terminal,/--tx:#eceee6/);
  assert.match(terminal,/--mut:#c3cab7/);
  assert.match(terminal,/--up:#4fdd8f/);
  assert.match(terminal,/--dn:#ff5b50/);
  assert.match(admin,/--tx:#f7f9f2/);
  assert.match(admin,/--ac:#d7ff00/);
});
