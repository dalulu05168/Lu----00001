#!/usr/bin/env node
/**
 * Read-only market API key check.
 *
 * Usage:
 *   FINNHUB_API_KEY=... ALPHA_VANTAGE_API_KEY=... \
 *   node scripts/check-market-api-keys.mjs --symbol=AAPL
 *
 * Optional:
 *   --only=finnhub|alpha|all
 *   --symbol=AAPL
 *   --require       fail when no provider key is configured
 *   MARKET_API_TIMEOUT_MS=8000
 */

const args = new Map(process.argv.slice(2).filter(x => x.startsWith("--")).map(x => {
  const [key, ...rest] = x.slice(2).split("=");
  return [key, rest.length ? rest.join("=") : true];
}));
const symbol = String(args.get("symbol") || process.env.MARKET_TEST_SYMBOL || "AAPL").trim().toUpperCase();
const only = String(args.get("only") || "all").toLowerCase();
const requireKey = args.has("require") || process.env.REQUIRE_MARKET_KEYS === "true";
const timeoutMs = Number(process.env.MARKET_API_TIMEOUT_MS || 8000);
const finnhubKey = String(process.env.FINNHUB_API_KEY || "").trim();
const alphaKey = String(process.env.ALPHA_VANTAGE_API_KEY || "").trim();
const finnhubBase = String(process.env.FINNHUB_API_BASE || "https://finnhub.io/api/v1").replace(/\/$/, "");
const alphaBase = String(process.env.ALPHA_VANTAGE_API_BASE || "https://www.alphavantage.co/query");
const alphaEntitlement = String(process.env.ALPHA_VANTAGE_ENTITLEMENT || "delayed");

if (!/^[A-Z0-9.\-]{1,24}$/.test(symbol)) {
  console.error(`FAIL symbol: invalid symbol ${JSON.stringify(symbol)}`);
  process.exit(2);
}
if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
  console.error("FAIL timeout: MARKET_API_TIMEOUT_MS must be between 1000 and 60000");
  process.exit(2);
}
if (!["all", "finnhub", "alpha"].includes(only)) {
  console.error("FAIL --only: expected finnhub, alpha, or all");
  process.exit(2);
}

function maskKey(key) {
  if (!key) return "missing";
  if (key.length <= 6) return "configured";
  return `${key.slice(0, 3)}…${key.slice(-3)}`;
}

async function getJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json", "user-agent": "cn-capital-market-key-check/1.0" }
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
  return { response, body };
}

function result(provider, ok, message, extra = {}) {
  return { provider, ok, message, ...extra };
}

async function checkFinnhub() {
  if (!finnhubKey) return result("Finnhub", false, "SKIP: FINNHUB_API_KEY is not configured", { skipped: true });
  const url = new URL(`${finnhubBase}/quote`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("token", finnhubKey);
  try {
    const { response, body } = await getJson(url);
    const price = Number(body?.c);
    const timestamp = Number(body?.t);
    if (!response.ok) return result("Finnhub", false, `HTTP ${response.status}`);
    if (body?.error) return result("Finnhub", false, "provider error returned");
    if (!Number.isFinite(price) || price <= 0) return result("Finnhub", false, "response has no positive current price");
    if (!Number.isFinite(timestamp) || timestamp <= 0) return result("Finnhub", false, "response has no valid timestamp");
    return result("Finnhub", true, "OK", { price, timestamp: new Date(timestamp * 1000).toISOString() });
  } catch (error) {
    return result("Finnhub", false, error.name === "TimeoutError" ? `timeout after ${timeoutMs}ms` : error.message);
  }
}

async function checkAlphaVantage() {
  if (!alphaKey) return result("Alpha Vantage", false, "SKIP: ALPHA_VANTAGE_API_KEY is not configured", { skipped: true });
  const url = new URL(alphaBase);
  url.searchParams.set("function", "GLOBAL_QUOTE");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("apikey", alphaKey);
  url.searchParams.set("entitlement", alphaEntitlement);
  try {
    const { response, body } = await getJson(url);
    if (!response.ok) return result("Alpha Vantage", false, `HTTP ${response.status}`);
    if (body?.Note) return result("Alpha Vantage", false, "rate limit notice returned");
    if (body?.Information) return result("Alpha Vantage", false, "provider information/error returned");
    const quote = body?.["Global Quote"] || {};
    const price = Number(quote["05. price"]);
    const tradingDay = quote["07. latest trading day"];
    if (!Number.isFinite(price) || price <= 0) return result("Alpha Vantage", false, "response has no positive quote price");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tradingDay || ""))) return result("Alpha Vantage", false, "response has no valid latest trading day");
    return result("Alpha Vantage", true, "OK", { price, latestTradingDay: tradingDay, entitlement: alphaEntitlement });
  } catch (error) {
    return result("Alpha Vantage", false, error.name === "TimeoutError" ? `timeout after ${timeoutMs}ms` : error.message);
  }
}

const checks = [];
if (only === "all" || only === "finnhub") checks.push(await checkFinnhub());
if (only === "all" || only === "alpha") checks.push(await checkAlphaVantage());
console.log(`Market API key check | symbol=${symbol} | timeout=${timeoutMs}ms`);
console.log(`Finnhub key: ${maskKey(finnhubKey)} | Alpha Vantage key: ${maskKey(alphaKey)}`);
for (const item of checks) {
  const suffix = Object.entries(item).filter(([key]) => !["provider", "ok", "message", "skipped"].includes(key)).map(([key, value]) => `${key}=${value}`).join(" ");
  console.log(`${item.ok ? "PASS" : item.skipped ? "SKIP" : "FAIL"} ${item.provider}: ${item.message}${suffix ? ` (${suffix})` : ""}`);
}
const configured = checks.filter(x => !x.skipped);
const failures = configured.filter(x => !x.ok);
if (!configured.length) {
  console.error(requireKey ? "No market provider key is configured" : "No market provider key is configured; nothing was requested");
  process.exit(requireKey ? 1 : 2);
}
if (failures.length) process.exit(1);
console.log(`All configured providers passed: ${configured.length}`);
