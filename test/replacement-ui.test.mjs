import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const web = resolve("web");
const entrypoints = ["login.html", "index.html", "mobile.html", "cn-terminal.html", "admin.html", "cn-admin.html"];
const deletedLegacy = [
  "app.mjs", "styles.css", "admin.mjs", "admin.css", "cn-login.css",
  "market-allocation.mjs", "catalog-instruments.mjs", "stock-chart.mjs",
  "cn-terminal-bridge.mjs", "cn-admin-bridge.mjs",
  "cn-entry-redirect.mjs", "cn-admin-entry-redirect.mjs"
];

test("replacement UI keeps all five HTML entrypoints", async () => {
  for (const file of entrypoints) {
    const html = await readFile(resolve(web, file), "utf8");
    assert.match(html, /<!doctype html>/i, file);
    assert.match(html, /<html[\s>]/i, file);
  }
});

test("replacement UI does not reference deleted legacy assets", async () => {
  const files = await readdir(web, { recursive: true });
  for (const file of deletedLegacy) assert.equal(files.includes(file), false, file);
  for (const file of entrypoints) {
    const html = await readFile(resolve(web, file), "utf8");
    for (const legacy of deletedLegacy) assert.doesNotMatch(html, new RegExp(`(?:src|href)=["'][^"']*${legacy.replace('.', '\\.')}`), `${file} -> ${legacy}`);
  }
});
