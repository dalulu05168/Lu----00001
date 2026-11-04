import test from "node:test";
import assert from "node:assert/strict";

// Local tests and ordinary CI must never probe a different website by default.
const enabled = process.env.RUN_LIVE_SITE_CHECKS === "true";
let origin;
if(enabled){
  const target=new URL(process.env.LIVE_SITE_ORIGIN??"");
  if(!["https:","http:"].includes(target.protocol)||target.username||target.password||
    target.pathname!=="/"||target.search||target.hash)throw Error("LIVE_SITE_ORIGIN must be an explicit HTTP(S) origin");
  origin=target.origin;
}
const targets = [
  ["/", 200, "GET"],
  ["/admin.html", 200, "GET"],
  ["/admin.mjs", 200, "GET"],
  ["/admin.css", 200, "GET"],
  ["/stock-chart.mjs", 200, "GET"],
  ["/api/health", 200, "GET"],
  ["/api/ready", 200, "GET"],
  ["/api/auth/register", 400, "POST"],
  ["/api/auth/login", 400, "POST"],
  ["/api/auth/logout", 401, "POST"],
  ["/api/account", 401, "GET"],
  ["/api/admin/me", 401, "GET"],
  ["/api/admin/subaccounts", 401, "GET"],
  ["/api/admin/login", 400, "POST"],
  ["/api/catalog", 401, "GET"],
  ["/api/watchlist", 401, "GET"],
  ["/api/orders", 401, "POST"]
];

for (const [path, expected, method] of targets) {
  const permitted=enabled&&(method==="GET"||process.env.LIVE_SITE_ALLOW_INVALID_POST==="true");
  test("public route " + method + " " + path, { skip: !permitted, timeout: 25000 }, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 19000);
    try {
      const response = await fetch(origin + path, {
        method,
        signal: controller.signal,
        redirect: "error",
        headers: method === "POST" ? { "content-type": "application/json" } : {},
        ...(method === "POST" ? { body: "{invalid-json" } : {})
      });
      const text = await response.text();
      assert.equal(response.status, expected, path + " returned HTTP " + response.status +
        " content-type=" + response.headers.get("content-type") + " body=" + text.slice(0,120));
      if (path === "/api/health") {
        assert.equal(JSON.parse(text).status, "alive");
      }
      if (path === "/api/ready") {
        assert.equal(JSON.parse(text).database, "connected");
      }
    } finally {
      clearTimeout(timeout);
    }
  });
}
