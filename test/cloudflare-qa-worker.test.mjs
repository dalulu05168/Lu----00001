import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import worker from "../src/cloudflare-qa-worker.mjs";

const assetPaths = [];
const assets = {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    assetPaths.push(path);
    return new Response(`asset:${path}`, { status: 200, headers: { "content-type": "text/html" } });
  },
};
const defaultEnv = { ASSETS: assets };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; assetPaths.length = 0; });

test("/ routes to approved login asset, not desktop index", async () => {
  const res = await worker.fetch(new Request("https://preview.workers.dev/"), defaultEnv);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "asset:/login.html");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(assetPaths, ["/login.html"]);
});

test("mobile and admin aliases preserve their own pages", async () => {
  for (const path of ["/mobile", "/admin"]) {
    const res = await worker.fetch(new Request(`https://preview.workers.dev${path}`), defaultEnv);
    assert.equal(await res.text(), `asset:${path}.html`);
  }
});

test("other frontend files are served unchanged", async () => {
  const res = await worker.fetch(new Request("https://preview.workers.dev/index.html"), defaultEnv);
  assert.equal(await res.text(), "asset:/index.html");
});

test("API fails closed when no QA backend is connected", async () => {
  for (const path of ["/api/auth/login", "/api/account", "/api/orders", "/health", "/ready"]) {
    const res = await worker.fetch(new Request(`https://preview.workers.dev${path}`), defaultEnv);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, "service_unavailable");
  }
  assert.deepEqual(assetPaths, []);
});

test("invalid, insecure, or self-referential origins are rejected", async () => {
  for (const origin of ["http://backend.example", "https://preview.workers.dev/", "https://backend.example/path", "https://u:p@backend.example/"]) {
    const res = await worker.fetch(new Request("https://preview.workers.dev/api/account"), { ...defaultEnv, QA_API_ORIGIN: origin });
    assert.equal(res.status, 503);
  }
});

test("QA proxy preserves authorization and query without leaking backend cookies", async () => {
  let seen;
  globalThis.fetch = async (request) => {
    seen = request;
    return new Response('{"status":"ok"}', { status: 200, headers: { "set-cookie": "bad=secret", "content-type": "application/json" } });
  };
  const req = new Request("https://preview.workers.dev/api/account?type=basic", {
    headers: { authorization: "Bearer test-token", cookie: "session=do-not-forward" },
  });
  const res = await worker.fetch(req, { ...defaultEnv, QA_API_ORIGIN: "https://qa.example.net/" });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '{"status":"ok"}');
  assert.equal(seen.url, "https://qa.example.net/api/account?type=basic");
  assert.equal(seen.headers.get("authorization"), "Bearer test-token");
  assert.equal(seen.headers.get("cookie"), null);
  assert.equal(res.headers.get("set-cookie"), null);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("preview order submission requires an explicit enable flag", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("ok"); };
  const res = await worker.fetch(new Request("https://preview.workers.dev/api/orders", { method: "POST", body: "{}" }), {
    ...defaultEnv, QA_API_ORIGIN: "https://qa.example.net/",
  });
  assert.equal(res.status, 503);
  assert.equal(calls, 0);
});

test("upstream redirect is not followed", async () => {
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } });
  const res = await worker.fetch(new Request("https://preview.workers.dev/api/account"), {
    ...defaultEnv, QA_API_ORIGIN: "https://qa.example.net/",
  });
  assert.equal(res.status, 503);
});

test("unified login routes verified client accounts to mobile or desktop based on viewport, not separate domains", async () => {
  const { readFile } = await import("node:fs/promises");
  const login = await readFile(new URL("../web/login.html", import.meta.url), "utf8");
  assert.match(login, /const verified=await getResponse\(role==='client'\?'\/api\/account':'\/api\/admin\/me',\{headers\}\)/);
  assert.match(login, /const target=role!=='client'\?'\/admin\.html':matchMedia\('\(max-width:700px\)'\)\.matches\?'\/mobile\.html':'\/index\.html'/);
  assert.match(login, /location\.assign\(target\)/);
});

test("single customer URL uses verified login then selects independent mobile or desktop UI", async () => {
  const { readFile } = await import("node:fs/promises");
  const login = await readFile(new URL("../web/login.html", import.meta.url), "utf8");
  const verify = "const verified=await getResponse(role==='client'?'/api/account':'/api/admin/me',{headers});";
  const route = "const target=role!=='client'?'/admin.html':matchMedia('(max-width:700px)').matches?'/mobile.html':'/index.html';";
  assert.ok(login.includes(verify), "session must be verified before routing");
  assert.ok(login.includes(route), "client viewport decides mobile or desktop path on same origin");
  assert.ok(login.indexOf(verify) < login.indexOf(route), "route only after account verification");
  assert.ok(login.includes("location.assign(target);"), "redirect uses relative path, not another domain");
});
