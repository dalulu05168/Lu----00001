import test from "node:test";
import assert from "node:assert/strict";

const ORIGIN = "https://trade.maacropierce.com";
const isGitHubCI = process.env.GITHUB_ACTIONS === "true";
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
  test("public route " + method + " " + path, { skip: !isGitHubCI, timeout: 25000 }, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 19000);
    try {
      const response = await fetch(ORIGIN + path, {
        method,
        signal: controller.signal,
        redirect: "follow",
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
