import { isDatabaseReady } from "../src/readiness.mjs";
import { Pool } from "pg";
import { createApi } from "../src/http-api.mjs";
import { createSessionResolver } from "../src/auth.mjs";
import { createMarketDataProvider } from "../src/market-provider.mjs";
import { createReadOnlyPricingGateway } from "../src/market-data.mjs";

let runtime;

function getRuntime() {
  if (!process.env.DATABASE_URL) return null;
  if (!runtime) {
    const db = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
      ssl: process.env.PGSSL === "require" ? { rejectUnauthorized: true } : undefined
    });
    const marketDataProvider=createMarketDataProvider();
    const api = createApi({
      db,
      resolveSession: createSessionResolver(db),
      marketDataProvider,
      resolveExecutionPrice: marketDataProvider&&process.env.MARKET_DATA_EXECUTION_ENABLED==="true"
        ?createReadOnlyPricingGateway({provider:marketDataProvider}):undefined
    });
    runtime = { db, requestHandler: api.listeners("request")[0] };
  }
  return runtime;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  const path = (req.url || "/").split("?")[0];
  if (req.method === "GET" && path === "/api/health") {
    return send(res, 200, { status: "alive", brokerConnected: false, pricingConnected: Boolean(process.env.MARKET_DATA_API_KEY||process.env.FINNHUB_API_KEY||process.env.ALPHA_VANTAGE_API_KEY) });
  }

  const current = getRuntime();
  if (!current) {
    return send(res, 503, {
      status: "not_ready",
      error: "DATABASE_URL is not configured",
      brokerConnected: false
    });
  }

  if (req.method === "GET" && path === "/api/ready") {
    try {
      if (!await isDatabaseReady(current.db)) return send(res, 503, { status: "not_ready", database: "schema_missing", brokerConnected: false });
      return send(res, 200, { status: "ready", database: "connected", brokerConnected: false });
    } catch {
      return send(res, 503, { status: "not_ready", database: "unavailable", brokerConnected: false });
    }
  }

  try {
    await current.requestHandler(req, res);
  } catch {
    if (!res.headersSent) send(res, 500, { error: "Internal server error" });
    else res.end();
  }
}
