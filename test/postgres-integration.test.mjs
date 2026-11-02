import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createServer } from "node:http";
import serverlessHandler from "../api/[...path].mjs";
import { createApi } from "../src/http-api.mjs";
import { createSessionResolver } from "../src/auth.mjs";
import { placeInternalOrder } from "../src/order-service.mjs";

const connectionString = process.env.TEST_DATABASE_URL;
const run = connectionString ? test : test.skip;

run("PostgreSQL: migrations, isolated accounts, sessions, internal orders, and rollback", async () => {
  const db = new Pool({ connectionString, max: 4 });
  const app = createApi({ db, resolveSession: createSessionResolver(db) });
  await new Promise(resolve => app.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + app.address().port;
  async function request(path, { method = "GET", token, body } = {}) {
    const response = await fetch(url + path, {
      method,
      headers: {
        ...(token ? { authorization: "Bearer " + token } : {}),
        ...(body ? { "content-type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const value = response.status === 204 ? null : await response.json();
    return { status: response.status, value };
  }
  try {
    const migrations = await db.query("SELECT filename FROM schema_migrations ORDER BY filename");
    assert.deepEqual(
      migrations.rows.map(row => row.filename),
      ["001_init.sql", "002_sessions.sql", "003_private_account_data.sql", "003_watchlist.sql", "004_watchlist_security.sql", "005_admin_roles_and_catalog.sql"]
    );
    const rls = await db.query(`SELECT relname, relrowsecurity FROM pg_class
      WHERE relname IN ('app_users','accounts','positions','orders','cash_ledger','user_sessions')
      ORDER BY relname`);
    assert.equal(rls.rows.length, 6);
    assert.ok(rls.rows.every(row => row.relrowsecurity));

    const suffix = randomUUID().slice(0, 12);
    const emailA = "a-" + suffix + "@example.test";
    const emailB = "b-" + suffix + "@example.test";
    const password = "test-only-password-2026";
    const registerA = await request("/api/auth/register", { method: "POST", body: { email: emailA, password } });
    const registerB = await request("/api/auth/register", { method: "POST", body: { email: emailB, password } });
    assert.equal(registerA.status, 201);
    assert.equal(registerB.status, 201);
    assert.notEqual(registerA.value.accountId, registerB.value.accountId);

    const badPassword = await request("/api/auth/login", { method: "POST", body: { email: emailA, password: "incorrect-password" } });
    assert.equal(badPassword.status, 401);
    const loginA = await request("/api/auth/login", { method: "POST", body: { email: emailA, password } });
    const loginB = await request("/api/auth/login", { method: "POST", body: { email: emailB, password } });
    assert.equal(loginA.status, 200);
    assert.equal(loginB.status, 200);
    const tokenA = loginA.value.token, tokenB = loginB.value.token;
    assert.ok(tokenA.length >= 32);
    assert.ok(tokenB.length >= 32);

    const a0 = await request("/api/account", { token: tokenA });
    const b0 = await request("/api/account", { token: tokenB });
    assert.equal(a0.status, 200);
    assert.equal(b0.status, 200);
    assert.equal(a0.value.account.cashCents, 0);
    assert.equal(b0.value.account.cashCents, 0);
    assert.notEqual(a0.value.account.id, b0.value.account.id);

    // A saved watchlist must be persisted and never exposed to another account.
    const initiallyEmpty = await request("/api/watchlist", {token:tokenA});
    assert.equal(initiallyEmpty.status,200);
    assert.deepEqual(initiallyEmpty.value.items,[]);
    const saved = await request("/api/watchlist", {
      method:"POST",token:tokenA,body:{market:"HK",symbol:"9988"}
    });
    assert.equal(saved.status,200);
    const savedA = await request("/api/watchlist", {token:tokenA});
    assert.deepEqual(savedA.value.items.map(item=>item.market+":"+item.symbol),["HK:9988"]);
    const isolatedB = await request("/api/watchlist", {token:tokenB});
    assert.deepEqual(isolatedB.value.items,[]);
    const persisted = await db.query(
      "SELECT market,symbol FROM watchlist_items WHERE account_id=$1",[registerA.value.accountId]
    );
    assert.equal(persisted.rows.length,1);
    assert.equal(persisted.rows[0].symbol,"9988");
    const badInstrument = await request("/api/watchlist", {
      method:"POST",token:tokenA,body:{market:"HK",symbol:"<script>"}
    });
    assert.equal(badInstrument.status,400);
    const removeSaved = await request("/api/watchlist", {
      method:"DELETE",token:tokenA,body:{market:"HK",symbol:"9988"}
    });
    assert.equal(removeSaved.status,200);
    assert.deepEqual((await request("/api/watchlist",{token:tokenA})).value.items,[]);
    const protectedOrder = await request("/api/orders", {
      method: "POST", token: tokenA, body: { side: "BUY", market: "US", symbol: "AAPL", quantity: 1 }
    });
    assert.equal(protectedOrder.status, 400); // missing idempotency key
    const noQuote = await fetch(url + "/api/orders", {
      method: "POST", headers: {
        authorization: "Bearer " + tokenA,
        "content-type": "application/json",
        "idempotency-key": "order-disabled-123456"
      }, body: JSON.stringify({ side: "BUY", market: "US", symbol: "AAPL", quantity: 1 })
    });
    assert.equal(noQuote.status, 503);
    assert.equal((await noQuote.json()).error, "Verified market pricing unavailable");

    // Test-only, privileged funding fixture; no public funding API exists.
    const initialFunds = 100_000;
    await db.query("UPDATE accounts SET cash_cents=$2 WHERE id=$1", [registerA.value.accountId, initialFunds]);
    await db.query("INSERT INTO cash_ledger(account_id,delta_cents,balance_after_cents) VALUES($1,$2,$3)",
      [registerA.value.accountId, initialFunds, initialFunds]);

    const buy = { side: "BUY", market: "US", symbol: "AAPL", quantity: 2, priceCents: 10000, fxUsdMicros: 1_000_000 };
    const idempotencyKey = "postgres-test-" + randomUUID();
    const orderId = randomUUID();
    const placed = await placeInternalOrder(db, registerA.value.accountId, idempotencyKey, buy, orderId);
    assert.equal(placed.replayed, false);
    assert.equal(placed.cashCents, 80000);
    assert.equal(placed.position, 2);
    const replay = await placeInternalOrder(db, registerA.value.accountId, idempotencyKey, buy, randomUUID());
    assert.equal(replay.replayed, true);
    assert.equal(replay.order.id, orderId);
    const afterBuy = await request("/api/account", { token: tokenA });
    assert.equal(afterBuy.value.account.cashCents, 80000);
    assert.equal(afterBuy.value.orders.length, 1);
    assert.equal(Number(afterBuy.value.positions[0].quantity), 2);
    const unaffected = await request("/api/account", { token: tokenB });
    assert.equal(unaffected.value.orders.length, 0);
    assert.equal(unaffected.value.positions.length, 0);
    assert.equal(unaffected.value.account.cashCents, 0);

    await assert.rejects(
      placeInternalOrder(db, registerA.value.accountId, "sell-too-many-" + randomUUID(), {
        ...buy, side: "SELL", quantity: 3
      }, randomUUID()), /Insufficient position/
    );
    const afterRollback = await request("/api/account", { token: tokenA });
    assert.equal(afterRollback.value.account.cashCents, 80000);
    assert.equal(afterRollback.value.orders.length, 1);

    const sold = await placeInternalOrder(db, registerA.value.accountId, "sell-one-" + randomUUID(), {
      ...buy, side: "SELL", quantity: 1, priceCents: 12000
    }, randomUUID());
    assert.equal(sold.cashCents, 92000);
    assert.equal(sold.position, 1);
    const final = await request("/api/account", { token: tokenA });
    assert.equal(final.value.orders.length, 2);
    assert.equal(Number(final.value.positions[0].quantity), 1);
    const ledger = await db.query("SELECT delta_cents,balance_after_cents FROM cash_ledger WHERE account_id=$1 ORDER BY id",
      [registerA.value.accountId]);
    assert.deepEqual(ledger.rows.map(row => Number(row.delta_cents)), [100000,-20000,12000]);

    const logout = await request("/api/auth/logout", { method: "POST", token: tokenA });
    assert.equal(logout.status, 204);
    assert.equal((await request("/api/account", { token: tokenA })).status, 401);
    assert.equal((await request("/api/account", { token: tokenB })).status, 200);
  } finally {
    await new Promise(resolve => app.close(resolve));
    await db.end();
  }
});

run("Vercel serverless API adapter routes to real PostgreSQL", async () => {
  const app = createServer(serverlessHandler);
  await new Promise(resolve => app.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + app.address().port;
  try {
    const alive = await fetch(base + "/api/health");
    assert.equal(alive.status, 200);
    assert.equal((await alive.json()).status, "alive");
    const ready = await fetch(base + "/api/ready");
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).database, "connected");
    assert.equal((await fetch(base + "/api/account")).status, 401);

    const email = "serverless-" + randomUUID().slice(0, 12) + "@example.test";
    const password = "long-serverless-test-password";
    const register = await fetch(base + "/api/auth/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    assert.equal(register.status, 201);
    const record = await register.json();
    assert.ok(record.accountId);
    const login = await fetch(base + "/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    assert.ok(token);
    const account = await fetch(base + "/api/account", {
      headers: { authorization: "Bearer " + token }
    });
    assert.equal(account.status, 200);
    assert.equal((await account.json()).account.id, record.accountId);
  } finally {
    await new Promise(resolve => app.close(resolve));
  }
});
