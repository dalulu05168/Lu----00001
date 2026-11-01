import { Pool } from "pg";
import { createApi } from "../src/http-api.mjs";
import { createSessionResolver } from "../src/auth.mjs";

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
    const api = createApi({
      db,
      resolveSession: createSessionResolver(db),
      // No broker order transport or execution-price provider is configured.
      resolveExecutionPrice: undefined
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
    return send(res, 200, { status: "alive", brokerConnected: false, pricingConnected: false });
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
      await current.db.query("SELECT 1");
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
