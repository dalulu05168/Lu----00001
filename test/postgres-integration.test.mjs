import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { currentOtp } from "../src/totp.mjs";
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
      ["001_init.sql", "002_sessions.sql", "003_private_account_data.sql", "003_watchlist.sql", "004_watchlist_security.sql", "005_admin_roles_and_catalog.sql", "006_supported_markets_us_cn.sql", "007_admin_auth_protection.sql", "008_admin_audit.sql"]
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
      method:"POST",token:tokenA,body:{market:"CN",symbol:"600519"}
    });
    assert.equal(saved.status,200);
    const savedA = await request("/api/watchlist", {token:tokenA});
    assert.deepEqual(savedA.value.items.map(item=>item.market+":"+item.symbol),["CN:600519"]);
    const isolatedB = await request("/api/watchlist", {token:tokenB});
    assert.deepEqual(isolatedB.value.items,[]);
    const persisted = await db.query(
      "SELECT market,symbol FROM watchlist_items WHERE account_id=$1",[registerA.value.accountId]
    );
    assert.equal(persisted.rows.length,1);
    assert.equal(persisted.rows[0].symbol,"600519");
    const badInstrument = await request("/api/watchlist", {
      method:"POST",token:tokenA,body:{market:"CN",symbol:"<script>"}
    });
    assert.equal(badInstrument.status,400);
    for(const unsupported of ["HK","MY"]){
      const rejected=await request("/api/watchlist",{method:"POST",token:tokenA,body:{market:unsupported,symbol:"AAPL"}});
      assert.equal(rejected.status,400);
    }
    await assert.rejects(
      db.query("INSERT INTO watchlist_items(account_id,market,symbol) VALUES($1,$2,$3)",[registerA.value.accountId,"HK","0700"]),
      /check constraint/
    );
    await assert.rejects(
      db.query("INSERT INTO positions(account_id,market,symbol,quantity) VALUES($1,$2,$3,$4)",
        [registerA.value.accountId,"MY","1155",1]),
      /check constraint/
    );
    const removeSaved = await request("/api/watchlist", {
      method:"DELETE",token:tokenA,body:{market:"CN",symbol:"600519"}
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

run("PostgreSQL: master TOTP, scoped subadmin invitations and securities directory permissions", async () => {
  const previousKey=process.env.ADMIN_TOTP_ENCRYPTION_KEY;
  const previousProof=process.env.ADMIN_BOOTSTRAP_SECRET;
  const previousMasterEmail=process.env.ADMIN_MASTER_EMAIL;
  process.env.ADMIN_TOTP_ENCRYPTION_KEY="a".repeat(64);
  process.env.ADMIN_BOOTSTRAP_SECRET="b".repeat(64);
  const masterEmail="master-"+randomUUID().slice(0,8)+"@example.test";
  process.env.ADMIN_MASTER_EMAIL=masterEmail;
  const db=new Pool({connectionString,max:4});
  const app=createApi({db,resolveSession:createSessionResolver(db)});
  await new Promise(done=>app.listen(0,"127.0.0.1",done));
  const base="http://127.0.0.1:"+app.address().port;
  async function req(path,{method="GET",token,body}={}){
    const res=await fetch(base+path,{method,headers:{
      ...(token?{authorization:"Bearer "+token}:{}),
      ...(body?{"content-type":"application/json"}:{})
    },...(body?{body:JSON.stringify(body)}:{})});
    return {status:res.status,data:res.status===204?{}:await res.json()};
  }
  try {
    // Create a directly registered user before master activation turns on invite-only registration.
    const directEmail="unlinked-"+randomUUID().slice(0,8)+"@example.test";
    const direct=await req("/api/auth/register",{method:"POST",body:{
      email:directEmail,password:"direct-client-password-2026"
    }});
    assert.equal(direct.status,201);
    const email=masterEmail;
    const password="testing-master-pass-2026";
    const missing=await req("/api/admin/me");
    assert.equal(missing.status,401);
    const bootstrapDenied=await req("/api/admin/bootstrap",{method:"POST",body:{
      email:"other@example.test",password,setupKey:"b".repeat(64)
    }});
    assert.equal(bootstrapDenied.status,400);
    const setup=await req("/api/admin/bootstrap",{method:"POST",body:{
      email,password,setupKey:"b".repeat(64)
    }});
    assert.equal(setup.status,201);
    assert.match(setup.data.totpSecret,/^[A-Z2-7]{32}$/);
    const otp=currentOtp(setup.data.totpSecret);
    const activated=await req("/api/admin/activate",{method:"POST",body:{email,password,otp}});
    assert.equal(activated.status,200);
    const secondMaster=await req("/api/admin/bootstrap",{method:"POST",body:{email,password,setupKey:"b".repeat(64)}});
    assert.equal(secondMaster.status,400);
    const admin=await req("/api/admin/login",{method:"POST",body:{email,password,otp}});
    assert.equal(admin.status,200);
    assert.equal(admin.data.role,"MASTER");
    const masterToken=admin.data.token;
    // The same authenticator code must never authorize two admin sessions.
    const replay=await req("/api/admin/login",{method:"POST",body:{email,password,otp}});
    assert.equal(replay.status,401);
    // An unknown account must be throttled after repeated authentication failures,
    // with the limit stored in PostgreSQL rather than in application memory.
    const fakeEmail="unknown-admin-"+randomUUID().slice(0,8)+"@example.test";
    for(let n=0;n<8;n++){
      const invalid=await req("/api/admin/login",{method:"POST",body:{email:fakeEmail,password,otp}});
      assert.equal(invalid.status,401);
    }
    const rateLimited=await req("/api/admin/login",{method:"POST",body:{email:fakeEmail,password,otp}});
    assert.equal(rateLimited.status,429);
    assert.equal((await req("/api/admin/me",{token:masterToken})).data.role,"MASTER");
    const subEmail="sub-"+randomUUID().slice(0,8)+"@example.test";
    const subPassword="testing-subadmin-pass-2026";
    const sub=await req("/api/admin/subaccounts",{method:"POST",token:masterToken,body:{email:subEmail,password:subPassword}});
    assert.equal(sub.status,201);
    assert.match(sub.data.inviteCode,/^[0-9]{6}$/);
    assert.match(sub.data.totpSecret,/^[A-Z2-7]{32}$/);
    const subOtp=currentOtp(sub.data.totpSecret);
    const subActivate=await req("/api/admin/activate",{method:"POST",body:{email:subEmail,password:subPassword,otp:subOtp}});
    assert.equal(subActivate.status,200);
    const attachedEmail="client-"+randomUUID().slice(0,8)+"@example.test";
    const attached=await req("/api/auth/register",{method:"POST",body:{
      email:attachedEmail,password:"testing-client-pass-2026",inviteCode:sub.data.inviteCode
    }});
    assert.equal(attached.status,201);
    const linkage=await db.query("SELECT subadmin_user_id FROM client_links WHERE user_id=$1",[attached.data.userId]);
    assert.equal(linkage.rows[0].subadmin_user_id,sub.data.userId);
    const invalidInvite=await req("/api/auth/register",{method:"POST",body:{
      email:"unknown-"+randomUUID().slice(0,8)+"@example.test",
      password:"testing-client-pass-2026",inviteCode:"not-code"
    }});
    assert.equal(invalidInvite.status,400);
    const subAdmin=await req("/api/admin/login",{method:"POST",body:{email:subEmail,password:subPassword,otp:subOtp}});
    assert.equal(subAdmin.status,200);
    const subListings=await req("/api/admin/listings",{method:"POST",token:subAdmin.data.token,body:{
      itemType:"STOCK",market:"US",symbol:"AAPL",name:"Apple Inc.",status:"DRAFT"
    }});
    assert.equal(subListings.status,403);
    const masterListing=await req("/api/admin/listings",{method:"POST",token:masterToken,body:{
      itemType:"IPO",market:"US",symbol:"IPO123",name:"IPO资料",status:"PUBLISHED"
    }});
    assert.equal(masterListing.status,201);
    assert.equal(masterListing.data.status,"PUBLISHED");
    assert.equal("simulationOnly" in masterListing.data,false);
    assert.equal("discountPercent" in masterListing.data,false);
    const exposed=await req("/api/admin/listings",{token:masterToken});
    assert.equal(exposed.status,200);
    assert.equal(JSON.stringify(exposed.data).includes("demo-password-2026"),false);
    const clientLogin=await req("/api/auth/login",{method:"POST",body:{
      email:attachedEmail,password:"testing-client-pass-2026"
    }});
    assert.equal(clientLogin.status,200);
    const catalog=await req("/api/catalog",{token:clientLogin.data.token});
    assert.equal(catalog.status,200);
    assert.ok(catalog.data.items.some(item=>item.symbol==="IPO123"));
    // Only the master may retrieve the append-only audit trail.
    const subAudit=await req("/api/admin/audit",{token:subAdmin.data.token});
    assert.equal(subAudit.status,403);
    const clientAudit=await req("/api/admin/audit",{token:clientLogin.data.token});
    assert.equal(clientAudit.status,403);
    const missingAudit=await req("/api/admin/audit");
    assert.equal(missingAudit.status,401);
    const auditResponse=await req("/api/admin/audit",{token:masterToken});
    assert.equal(auditResponse.status,200);
    assert.ok(Array.isArray(auditResponse.data.items));
    assert.ok(auditResponse.data.items.some(item=>item.action==="ADMIN_LOGIN"));
    assert.ok(auditResponse.data.items.some(item=>item.action==="LISTING_CREATED"));
    assert.equal(JSON.stringify(catalog.data).includes("simulationOnly"),false);
    assert.equal(JSON.stringify(catalog.data).includes("discountPercent"),false);
    assert.equal(JSON.stringify(catalog.data).includes("purchase_password"),false);
    const unpublished=await req("/api/admin/listings",{method:"PATCH",token:masterToken,body:{
      id:masterListing.data.id,status:"DRAFT"
    }});
    assert.equal(unpublished.status,200);
    const masterClients=await req("/api/admin/clients",{token:masterToken});
    assert.equal(masterClients.status,200);
    assert.ok(masterClients.data.items.some(item=>item.email===attachedEmail));
    assert.ok(masterClients.data.items.some(item=>item.email===directEmail));
    assert.ok(!masterClients.data.items.some(item=>[masterEmail,subEmail].includes(item.email)));
    const subclients=await req("/api/admin/clients",{token:subAdmin.data.token});
    assert.equal(subclients.status,200);
    assert.ok(subclients.data.items.some(item=>item.email===attachedEmail));
    assert.ok(!subclients.data.items.some(item=>item.email===directEmail));
    const audit=await db.query(`SELECT action,actor_user_id,target_id,details
      FROM admin_audit_events ORDER BY id`);
    const actions=audit.rows.map(row=>row.action);
    for(const required of ["ADMIN_CREATED","ADMIN_2FA_ENABLED","ADMIN_LOGIN","LISTING_CREATED","LISTING_STATUS_CHANGED"])
      assert.ok(actions.includes(required),required);
    assert.ok(audit.rows.some(row=>row.action==="LISTING_CREATED" &&
      row.target_id===masterListing.data.id && row.actor_user_id===setup.data.userId || 
      (row.action==="LISTING_CREATED" && row.target_id===masterListing.data.id)));
    for(const row of audit.rows){
      const text=JSON.stringify(row.details);
      assert.ok(!text.includes(password));
      assert.ok(!text.includes(subPassword));
      assert.ok(!text.includes(setup.data.totpSecret));
      assert.ok(!text.includes(masterToken));
    }
    const beforeCount=audit.rowCount;
    await assert.rejects(
      db.query("DELETE FROM admin_audit_events WHERE id=$1",
        [(await db.query("SELECT id FROM admin_audit_events ORDER BY id LIMIT 1")).rows[0].id]),
      /append-only/
    );
    assert.equal((await db.query("SELECT count(*)::integer AS count FROM admin_audit_events")).rows[0].count,beforeCount);
  }finally{
    await new Promise(done=>app.close(done));
    await db.end();
    if(previousKey===undefined)delete process.env.ADMIN_TOTP_ENCRYPTION_KEY;
    else process.env.ADMIN_TOTP_ENCRYPTION_KEY=previousKey;
    if(previousProof===undefined)delete process.env.ADMIN_BOOTSTRAP_SECRET;
    else process.env.ADMIN_BOOTSTRAP_SECRET=previousProof;
    if(previousMasterEmail===undefined)delete process.env.ADMIN_MASTER_EMAIL;
    else process.env.ADMIN_MASTER_EMAIL=previousMasterEmail;
  }
});
