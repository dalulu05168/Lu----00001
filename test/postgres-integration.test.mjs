import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createServer } from "node:http";
import serverlessHandler from "../api/[...path].mjs";
import { createApi } from "../src/http-api.mjs";
import { createSessionResolver } from "../src/auth.mjs";
import { placeInternalOrder } from "../src/order-service.mjs";
import {verifyInternalFunding} from './internal-funding-postgres.test.mjs';
import {verifyInternalProducts} from './internal-products-postgres.mjs';
import {verifyPrivateCustomerData} from './private-customer-postgres.mjs';

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
      ["001_init.sql", "002_sessions.sql", "003_private_account_data.sql", "003_watchlist.sql", "004_watchlist_security.sql", "005_admin_roles_and_catalog.sql", "006_admin_mirror_access.sql", "007_admin_password_only.sql", "008_client_admin_policies.sql", "009_operational_requests.sql", "010_subadmin_controls.sql", "011_commodities_support.sql", "012_internal_funding.sql", "013_internal_products.sql", "014_private_customer_data.sql", "015_romanian_listings_optional_reasons.sql", "016_mirror_purchase_audit.sql", "017_listing_minimum_purchase.sql", "018_fixed_term_funds.sql", "019_stock_holding_locks.sql", "020_stock_sales.sql"]
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
    const analytics=await request("/api/account/analytics?accountId="+registerB.value.accountId,{token:tokenA});
    assert.equal(analytics.status,200);
    assert.equal(analytics.value.historyAvailable,true);
    assert.equal(analytics.value.realizedPnlCents,2000);
    assert.equal(analytics.value.positionCostCents,10000);
    assert.equal(analytics.value.volumeCents,32000);
    assert.equal(analytics.value.portfolioValueCents,null);
    const emptyAnalytics=await request("/api/account/analytics",{token:tokenB});
    assert.equal(emptyAnalytics.value.orderCount,0);
    assert.equal(emptyAnalytics.value.realizedPnlCents,0);
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

run("PostgreSQL: full-history analytics exceeds the 100-row account view and rejects incomplete cost histories",async()=>{
  const db=new Pool({connectionString,max:4});
  const app=createApi({db,resolveSession:createSessionResolver(db)});
  await new Promise(resolve=>app.listen(0,"127.0.0.1",resolve));
  const base="http://127.0.0.1:"+app.address().port;
  const request=async(path,{token,body}={})=>{
    const response=await fetch(base+path,{method:body?"POST":"GET",headers:{
      ...(token?{authorization:"Bearer "+token}:{}),...(body?{"content-type":"application/json"}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json()};
  };
  try{
    const email="analytics-"+randomUUID()+"@example.test",password="local-analytics-password-2026";
    const account=await request("/api/auth/register",{body:{email,password}});
    assert.equal(account.status,201);
    const accountId=account.data.accountId;
    await db.query("UPDATE accounts SET cash_cents=100000 WHERE id=$1",[accountId]);
    await db.query("INSERT INTO cash_ledger(account_id,delta_cents,balance_after_cents) VALUES($1,100000,100000)",[accountId]);
    await placeInternalOrder(db,accountId,"analytics-initial-buy",{market:"US",symbol:"AAPL",side:"BUY",quantity:120,priceCents:100,fxUsdMicros:1000000},randomUUID());
    for(let index=0;index<120;index++)await placeInternalOrder(db,accountId,"analytics-sale-"+index,
      {market:"US",symbol:"AAPL",side:"SELL",quantity:1,priceCents:150,fxUsdMicros:1000000},randomUUID());
    const login=await request("/api/auth/login",{body:{email,password}}),token=login.data.token;
    assert.equal((await request("/api/account/analytics")).status,401);
    const snapshot=await request("/api/account",{token});assert.equal(snapshot.data.orders.length,100);
    const statistics=await request("/api/account/analytics",{token});
    assert.equal(statistics.status,200);assert.equal(statistics.data.orderCount,121);
    assert.equal(statistics.data.historyAvailable,true);assert.equal(statistics.data.realizedPnlCents,6000);
    assert.equal(statistics.data.volumeCents,30000);assert.equal(statistics.data.portfolioValueCents,106000);
    await placeInternalOrder(db,accountId,"analytics-lot-one",{market:"US",symbol:"AAPL",side:"BUY",quantity:1,priceCents:200,fxUsdMicros:1000000},randomUUID());
    const secondLotId=randomUUID();
    await placeInternalOrder(db,accountId,"analytics-lot-two",{market:"US",symbol:"AAPL",side:"BUY",quantity:1,priceCents:400,fxUsdMicros:1000000},secondLotId);
    const finalSaleId=randomUUID();
    await placeInternalOrder(db,accountId,"analytics-final-sale",{market:"US",symbol:"AAPL",side:"SELL",quantity:1,priceCents:300,fxUsdMicros:1000000},finalSaleId);
    // Transaction timestamps may disagree with actual serialized ledger order.
    await db.query("UPDATE orders SET created_at=now()-interval '1 hour' WHERE id=$1",[secondLotId]);
    const ledgerOrdered=await request("/api/account/analytics",{token});
    assert.equal(ledgerOrdered.data.historyAvailable,true);assert.equal(ledgerOrdered.data.realizedPnlCents,6100);
    assert.equal(ledgerOrdered.data.positionCostCents,400);
    await db.query("UPDATE positions SET quantity=2 WHERE account_id=$1 AND market='US' AND symbol='AAPL'",[accountId]);
    const inconsistent=await request("/api/account/analytics",{token});
    assert.equal(inconsistent.data.historyAvailable,false);
    assert.equal(inconsistent.data.reason,"POSITION_HISTORY_MISMATCH");
    assert.equal(inconsistent.data.realizedPnlCents,null);assert.equal(inconsistent.data.portfolioValueCents,null);
    await db.query("UPDATE positions SET quantity=1 WHERE account_id=$1 AND market='US' AND symbol='AAPL'",[accountId]);
    await db.query("UPDATE cash_ledger SET delta_cents=delta_cents+1 WHERE order_id=$1",[finalSaleId]);
    const untrustedLedger=await request("/api/account/analytics",{token});
    assert.equal(untrustedLedger.data.historyAvailable,false);
    assert.equal(untrustedLedger.data.reason,"LEDGER_HISTORY_UNAVAILABLE");
    assert.equal(untrustedLedger.data.realizedPnlCents,null);
  }finally{await new Promise(resolve=>app.close(resolve));await db.end();}
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

run("PostgreSQL: password-only master, scoped subadmin invitations and securities directory permissions", async () => {
  const previousProof=process.env.ADMIN_BOOTSTRAP_SECRET;
  const previousMasterEmail=process.env.ADMIN_MASTER_EMAIL;
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
    assert.equal(setup.data.ready,true);
    assert.equal("totpSecret" in setup.data,false);
    assert.equal((await req("/api/admin/activate",{method:"POST",body:{email,password}})).status,404);
    // Simulate an older master migrated before completing setup.
    await db.query("UPDATE admin_roles SET password_setup_pending=true WHERE user_id=(SELECT id FROM app_users WHERE email=$1)",[email]);
    const deniedRecovery=await req("/api/admin/recover-pending-master",{method:"POST",body:{email,password:"replacement-master-password-2026",setupKey:"wrong"}});
    assert.equal(deniedRecovery.status,400);
    const recoveredPassword="replacement-master-password-2026";
    const recovered=await req("/api/admin/recover-pending-master",{method:"POST",body:{email,password:recoveredPassword,setupKey:"b".repeat(64)}});
    assert.equal(recovered.status,200);
    assert.equal(recovered.data.ready,true);
    assert.equal((await req("/api/admin/recover-pending-master",{method:"POST",body:{email,password:recoveredPassword,setupKey:"b".repeat(64)}})).status,400);
    assert.equal((await req("/api/admin/login",{method:"POST",body:{email,password}})).status,401);
    const secondMaster=await req("/api/admin/bootstrap",{method:"POST",body:{email,password,setupKey:"b".repeat(64)}});
    assert.equal(secondMaster.status,400);
    const admin=await req("/api/admin/login",{method:"POST",body:{email,password:recoveredPassword}});
    assert.equal(admin.status,200);
    assert.equal(admin.data.role,"MASTER");
    const masterToken=admin.data.token;
    assert.equal((await req("/api/admin/me",{token:masterToken})).data.role,"MASTER");
    assert.equal((await req("/api/auth/login",{method:"POST",body:{email,password:recoveredPassword}})).status,401);
    assert.equal((await req("/api/account",{token:masterToken})).status,403);
    const subEmail="sub-"+randomUUID().slice(0,8)+"@example.test";
    const subPassword="testing-subadmin-pass-2026";
    const sub=await req("/api/admin/subaccounts",{method:"POST",token:masterToken,body:{email:subEmail,password:subPassword}});
    assert.equal(sub.status,201);
    assert.match(sub.data.inviteCode,/^[0-9]{6}$/);
    assert.equal("totpSecret" in sub.data,false);
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
    const subAdmin=await req("/api/admin/login",{method:"POST",body:{email:subEmail,password:subPassword}});
    assert.equal(subAdmin.status,200);

    const subListings=await req("/api/admin/listings",{method:"POST",token:subAdmin.data.token,body:{
      itemType:"STOCK",market:"US",symbol:"AAPL",name:"Apple Inc.",status:"DRAFT"
    }});
    assert.equal(subListings.status,403);
    const stockLookup="/api/admin/stock-lookup?code=0700";
    assert.equal((await req(stockLookup)).status,401);
    assert.equal((await req(stockLookup,{token:subAdmin.data.token})).status,403);
    const lookup=await req(stockLookup,{token:masterToken});
    assert.equal(lookup.status,200);
    assert.ok(lookup.data.items.some(item=>item.market==="HK"&&item.symbol==="0700"&&item.exchange==="HKEX"));
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

    // Persisted commodity catalog: publication changes visibility, not brokerage eligibility.
    const commoditySku="GOLD-"+randomUUID().slice(0,8).toUpperCase();
    const product=await req("/api/admin/commodities",{method:"POST",token:masterToken,body:{
      sku:commoditySku,name:"Gold directory example",category:"PRECIOUS_METAL",unit:"ounce",
      minimumQuantity:1,indicativePriceCents:125500,status:"DRAFT",
      reason:""
    }});
    assert.equal(product.status,201);
    assert.equal(product.data.item.status,"DRAFT");
    assert.equal(product.data.item.isDemo,true);
    assert.equal((await req("/api/commodities",{token:clientLogin.data.token})).data.items.some(x=>x.sku===commoditySku),false);
    assert.equal((await req("/api/admin/commodities",{method:"POST",token:subAdmin.data.token,body:{
      sku:"UNAUTHORIZED",name:"Invalid",category:"ENERGY",unit:"barrel",
      reason:"Unauthorized product publication attempt"
    }})).status,403);
    const publishCommodity=await req("/api/admin/commodities",{method:"PATCH",token:masterToken,body:{
      id:product.data.item.id,status:"PUBLISHED",
      reason:"发布"
    }});
    assert.equal(publishCommodity.status,200);
    assert.equal(publishCommodity.data.item.priceSource,"ADMIN_INDICATIVE");
    const visibleProducts=await req("/api/commodities",{token:clientLogin.data.token});
    assert.equal(visibleProducts.status,200);
    assert.equal(visibleProducts.data.items.some(x=>x.sku===commoditySku),true);
    assert.equal(visibleProducts.data.brokerConnected,false);
    assert.equal((await req("/api/admin/commodity-audit?id="+product.data.item.id,{token:masterToken})).data.items.length,2);
    assert.equal((await req("/api/admin/commodity-audit?id="+product.data.item.id,{token:subAdmin.data.token})).status,403);
    assert.equal((await req("/api/commodities")).status,401);

    // Customer <-> assigned support operator: server-side ownership and persistent messages.
    const clientSupport=await req("/api/support",{method:"POST",token:clientLogin.data.token,
      body:{message:"Please clarify the withdrawal application status."}});
    assert.equal(clientSupport.status,201);
    const threadId=clientSupport.data.thread.id;
    assert.equal(clientSupport.data.thread.clientId,attached.data.userId);
    assert.equal((await req("/api/support",{token:clientLogin.data.token})).data.messages.length,1);
    const subInbox=await req("/api/admin/support",{token:subAdmin.data.token});
    assert.equal(subInbox.status,200);
    assert.ok(subInbox.data.items.some(x=>x.id===threadId));
    const subReply=await req("/api/admin/support",{method:"POST",token:subAdmin.data.token,
      body:{threadId,message:"Your request is under internal review; no payment has occurred."}});
    assert.equal(subReply.status,201);
    const clientThread=await req("/api/support",{token:clientLogin.data.token});
    assert.equal(clientThread.status,200);
    assert.equal(clientThread.data.messages.length,2);
    assert.match(clientThread.data.messages[1].body,/no payment/);
    assert.equal((await req("/api/admin/support",{method:"POST",token:clientLogin.data.token,
      body:{threadId,message:"Illegal administrator impersonation"}})).status,403);
    const closeSupport=await req("/api/admin/support",{method:"PATCH",token:masterToken,body:{
      threadId,expectedStatus:"OPEN",status:"CLOSED",
      reason:""
    }});
    assert.equal(closeSupport.status,200);
    assert.equal(closeSupport.data.thread.status,"CLOSED");
    assert.equal((await req("/api/support",{method:"POST",token:clientLogin.data.token,
      body:{message:"Trying to message after thread closure"}})).status,409);
    assert.equal((await req("/api/admin/support",{method:"PATCH",token:subAdmin.data.token,body:{
      threadId,expectedStatus:"OPEN",status:"CLOSED",reason:"Outdated status transition should be rejected"
    }})).status,409);


    // User-controlled requests are only pending administrative records; no money movement or KYC verification.
    const ownReq=(category,body)=>req("/api/requests?category="+category,{
      method:"POST",token:clientLogin.data.token,body
    });
    const deposit=await ownReq("FUNDING",{kind:"DEPOSIT",amountCents:12000});
    assert.equal(deposit.status,201);
    assert.equal(deposit.data.item.status,"SUBMITTED");
    assert.equal(deposit.data.item.settlementStatus,"NOT_EXECUTED");
    const withdrawal=await ownReq("FUNDING",{kind:"WITHDRAWAL",amountCents:2700});
    assert.equal(withdrawal.status,201);
    assert.equal(withdrawal.data.item.settlementStatus,"NOT_EXECUTED");
    assert.equal((await ownReq("FUNDING",{kind:"WITHDRAWAL",amountCents:2.5})).status,400);
    assert.equal((await ownReq("FUNDING",{kind:"DEPOSIT",amountCents:12000,claimedBalance:100000})).status,400);
    const kycRequest=await ownReq("KYC",{});
    assert.equal(kycRequest.status,201);
    assert.equal(kycRequest.data.item.identityVerified,false);
    assert.equal(kycRequest.data.item.documentsStored,false);
    const bank=await ownReq("BANK_LINK",{bankLabel:"Example Bank",accountLast4:"4321"});
    assert.equal(bank.status,201);
    assert.equal(bank.data.item.verified,false);
    assert.equal(bank.data.item.accountLast4,"4321");
    assert.equal((await ownReq("BANK_LINK",{bankLabel:"Example Bank",accountLast4:"1234567890123456"})).status,400);
    assert.equal((await req("/api/requests?category=FUNDING",{token:clientLogin.data.token})).data.items.length,2);
    assert.equal((await req("/api/requests?category=FUNDING")).status,401);
    assert.equal((await req("/api/requests?category=FUNDING",{token:masterToken})).status,403);
    const fundsBeforeReview=await db.query("SELECT cash_cents FROM accounts WHERE id=$1",[attached.data.accountId]);
    assert.equal(Number(fundsBeforeReview.rows[0].cash_cents),0);
    const adminWorkflow="/api/admin/workflow-requests?category=FUNDING";
    const ownFunding=await req(adminWorkflow,{token:subAdmin.data.token});
    assert.equal(ownFunding.status,200);
    assert.equal(ownFunding.data.items.length,2);
    assert.equal(ownFunding.data.items.some(x=>x.id===deposit.data.item.id),true);
    const scopedOwn=await req(adminWorkflow+"&clientId="+attached.data.userId,{token:subAdmin.data.token});
    assert.equal(scopedOwn.status,200);
    assert.equal(scopedOwn.data.items.length,2);
    const historyUrl="/api/admin/client-history?clientId="+attached.data.userId+"&limit=1";
    const firstHistory=await req(historyUrl,{token:subAdmin.data.token});
    assert.equal(firstHistory.status,200);
    assert.equal(firstHistory.data.items.length,1);
    assert.equal(firstHistory.data.hasMore,true);
    assert.equal(typeof firstHistory.data.nextCursor,"string");
    const secondHistory=await req(historyUrl+"&cursor="+encodeURIComponent(firstHistory.data.nextCursor),
      {token:subAdmin.data.token});
    assert.equal(secondHistory.status,200);
    assert.equal(secondHistory.data.items.length,1);
    assert.notEqual(secondHistory.data.items[0].id,firstHistory.data.items[0].id);
    assert.equal((await req(historyUrl+"&cursor=invalid",{token:subAdmin.data.token})).status,400);
    assert.equal((await req(historyUrl.replace("limit=1","limit=51"),{token:subAdmin.data.token})).status,400);
    assert.equal((await req(adminWorkflow+"&clientId="+sub.data.userId,{token:subAdmin.data.token})).status,404);
    assert.equal((await req(adminWorkflow+"&clientId=invalid",{token:subAdmin.data.token})).status,400);
    assert.equal((await req(adminWorkflow,{token:clientLogin.data.token})).status,403);
    assert.equal((await req(adminWorkflow)).status,401);
    const workflowChange=(token,category,id,expectedStatus,status)=>req("/api/admin/workflow-requests",{
      method:"PATCH",token,body:{category,id,expectedStatus,status}
    });
    assert.equal((await workflowChange(subAdmin.data.token,"FUNDING",deposit.data.item.id,"SUBMITTED","APPROVED")).status,403);
    const intake=await workflowChange(subAdmin.data.token,"FUNDING",deposit.data.item.id,"SUBMITTED","UNDER_REVIEW");
    assert.equal(intake.status,200);
    assert.equal(intake.data.item.status,"UNDER_REVIEW");
    const approved=await workflowChange(masterToken,"FUNDING",deposit.data.item.id,"UNDER_REVIEW","APPROVED");
    assert.equal(approved.status,200);
    assert.equal(approved.data.item.settlementStatus,"INTERNAL_POSTED");
    assert.equal((await workflowChange(masterToken,"FUNDING",deposit.data.item.id,"SUBMITTED","APPROVED")).status,409);
    const kycNeedsInfo=await workflowChange(subAdmin.data.token,"KYC",kycRequest.data.item.id,
      "AWAITING_EVIDENCE","NEEDS_INFORMATION");
    assert.equal(kycNeedsInfo.status,200);
    assert.equal(kycNeedsInfo.data.item.identityVerified,false);
    const bankNeedsInfo=await workflowChange(subAdmin.data.token,"BANK_LINK",bank.data.item.id,
      "PENDING_VERIFICATION","NEEDS_INFORMATION");
    assert.equal(bankNeedsInfo.status,200);
    assert.equal(bankNeedsInfo.data.item.verified,false);
    const auditTrail=await req("/api/admin/workflow-audit?clientId="+attached.data.userId,{token:masterToken});
    assert.equal(auditTrail.status,200);
    assert.ok(auditTrail.data.items.some(e=>e.category==="FUNDING"&&e.new_status==="APPROVED"));
    assert.equal((await req("/api/admin/workflow-audit?clientId="+attached.data.userId,{token:clientLogin.data.token})).status,403);
    assert.equal((await req("/api/admin/workflow-audit?clientId="+sub.data.userId,{token:masterToken})).status,404);
    const balanceAfterReview=await db.query("SELECT cash_cents FROM accounts WHERE id=$1",[attached.data.accountId]);
    assert.equal(Number(balanceAfterReview.rows[0].cash_cents),12000);

    const catalog=await req("/api/catalog",{token:clientLogin.data.token});
    assert.equal(catalog.status,200);
    assert.ok(catalog.data.items.some(item=>item.symbol==="IPO123"));
    assert.equal(JSON.stringify(catalog.data).includes("simulationOnly"),false);
    assert.equal(JSON.stringify(catalog.data).includes("discountPercent"),false);
    assert.equal(JSON.stringify(catalog.data).includes("purchase_password"),false);
    const subclients=await req("/api/admin/clients",{token:subAdmin.data.token});
    assert.ok(subclients.data.items.some(item=>item.email===attachedEmail));

    // Role-scoped customer App mirror: no impersonation, no write endpoints.
    const mirrorReadiness=await req("/api/admin/mirror-status",{token:masterToken});
    assert.equal(mirrorReadiness.status,200);
    assert.deepEqual(mirrorReadiness.data,{ready:true,mode:"READ_ONLY"});
    const customerAppToken=clientLogin.data.token;
    assert.equal((await req("/api/admin/mirror?clientId="+attached.data.userId)).status,401);
    assert.equal((await req("/api/admin/mirror?clientId="+attached.data.userId,{token:customerAppToken})).status,403);
    assert.equal((await req("/api/admin/mirror?clientId=bad-id",{token:masterToken})).status,400);
    assert.equal((await req("/api/admin/mirror?clientId="+sub.data.userId,{token:masterToken})).status,404);
    const mirrorFromMaster=await req("/api/admin/mirror?clientId="+attached.data.userId,{token:masterToken});
    assert.equal(mirrorFromMaster.status,200);
    assert.equal(mirrorFromMaster.data.mode,"READ_ONLY");
    assert.equal(mirrorFromMaster.data.client.email,attachedEmail);
    assert.equal(mirrorFromMaster.data.account.id,attached.data.accountId);
    assert.deepEqual(mirrorFromMaster.data.positions,[]);
    assert.deepEqual(mirrorFromMaster.data.orders,[]);
    assert.deepEqual(mirrorFromMaster.data.watchlist,[]);
    assert.equal("password" in mirrorFromMaster.data,false);
    assert.equal("token" in mirrorFromMaster.data,false);
    // Client writes and administrator reads use the same persisted account.
    assert.equal((await req("/api/watchlist",{method:"POST",token:customerAppToken,
      body:{market:"HK",symbol:"9988"}})).status,200);
    const accountView=await req("/api/account",{token:customerAppToken});
    const watchlistView=await req("/api/watchlist",{token:customerAppToken});
    const mirrorFromOwnSub=await req("/api/admin/mirror?clientId="+attached.data.userId,{token:subAdmin.data.token});
    assert.equal(mirrorFromOwnSub.status,200);
    assert.deepEqual(mirrorFromOwnSub.data.account,accountView.data.account);
    assert.deepEqual(mirrorFromOwnSub.data.positions,accountView.data.positions);
    assert.deepEqual(mirrorFromOwnSub.data.orders,accountView.data.orders);
    assert.deepEqual(mirrorFromOwnSub.data.watchlist,watchlistView.data.items);
    assert.equal(mirrorFromOwnSub.data.watchlist[0].symbol,"9988");
    const otherEmail="other-sub-"+randomUUID().slice(0,8)+"@example.test";
    const otherSub=await req("/api/admin/subaccounts",{method:"POST",token:masterToken,body:{email:otherEmail,password:subPassword}});
    assert.equal(otherSub.status,201);
    const otherLogin=await req("/api/admin/login",{method:"POST",body:{email:otherEmail,password:subPassword}});
    assert.equal(otherLogin.status,200);
    assert.equal((await req("/api/admin/support-thread?threadId="+threadId,
      {token:otherLogin.data.token})).status,404);
    assert.equal((await req("/api/admin/support",{method:"POST",token:otherLogin.data.token,
      body:{threadId,message:"Cross-account message must be rejected"}})).status,404);
    assert.equal((await req("/api/admin/support",{token:otherLogin.data.token})).data.items.some(x=>x.id===threadId),false);
    assert.deepEqual((await req(adminWorkflow,{token:otherLogin.data.token})).data.items,[]);
    assert.equal((await req("/api/admin/client-history?clientId="+attached.data.userId,
      {token:otherLogin.data.token})).status,404);
    assert.equal((await req(adminWorkflow+"&clientId="+attached.data.userId,{token:otherLogin.data.token})).status,404);
    assert.equal((await workflowChange(otherLogin.data.token,"FUNDING",withdrawal.data.item.id,
      "SUBMITTED","UNDER_REVIEW")).status,404);
    assert.equal((await req("/api/admin/workflow-audit?clientId="+attached.data.userId,{
      token:otherLogin.data.token})).status,404);
    assert.equal((await req("/api/admin/mirror?clientId="+attached.data.userId,{token:otherLogin.data.token})).status,404);
    const audit=await db.query("SELECT actor_user_id,client_user_id FROM admin_mirror_access_log WHERE client_user_id=$1",[attached.data.userId]);
    assert.equal(audit.rows.length,2);
    const masterAudit=await req("/api/admin/mirror-audit",{token:masterToken});
    assert.equal(masterAudit.status,200);
    assert.ok(masterAudit.data.items.some(x=>x.clientUserId===attached.data.userId));
    assert.ok(masterAudit.data.items.some(x=>x.actorUserId===sub.data.userId));
    const subAudit=await req("/api/admin/mirror-audit",{token:subAdmin.data.token});
    assert.equal(subAudit.status,200);
    assert.ok(subAudit.data.items.every(x=>x.actorUserId===sub.data.userId));
    assert.equal((await req("/api/admin/mirror-audit",{token:customerAppToken})).status,403);
    assert.equal((await req("/api/admin/mirror-audit")).status,401);
    assert.equal((await req("/api/admin/mirror-status")).status,401);
    assert.equal((await req("/api/admin/mirror-status",{token:customerAppToken})).status,403);
    assert.equal((await req("/api/admin/mirror-audit",{method:"POST",token:masterToken})).status,405);
    const unchangedClient=await req("/api/account",{token:customerAppToken});
    assert.equal(unchangedClient.data.account.cashCents,12000);

    // MASTER-managed account flags are persisted, scoped and audited, not payments or real trading permissions.
    const policyPath="/api/admin/client-controls?clientId="+attached.data.userId;
    const auditPath="/api/admin/client-control-audit?clientId="+attached.data.userId;
    const initialPolicy=await req(policyPath,{token:masterToken});
    assert.equal(initialPolicy.status,200);
    assert.deepEqual({
      login:initialPolicy.data.policy.loginAllowed,
      withdrawal:initialPolicy.data.policy.withdrawalRequestsAllowed,
      loan:initialPolicy.data.policy.loanRequestsAllowed,
      vip:initialPolicy.data.policy.vipTier,
      account:initialPolicy.data.policy.accountClass,
      version:initialPolicy.data.policy.version
    },{login:true,withdrawal:true,loan:false,vip:"STANDARD",account:"SIMULATED",version:0});
    assert.equal((await req(policyPath,{token:subAdmin.data.token})).status,200);
    assert.equal((await req(policyPath,{token:otherLogin.data.token})).status,404);
    assert.equal((await req(policyPath,{token:customerAppToken})).status,403);
    assert.equal((await req(policyPath)).status,401);
    const change=(token,body)=>req("/api/admin/client-controls",{method:"PATCH",token,body:{
      clientId:attached.data.userId,confirmPassword:recoveredPassword,...body
    }});
    assert.equal((await change(subAdmin.data.token,{field:"vipTier",value:"GOLD",expectedVersion:0})).status,403);
    assert.equal((await change(masterToken,{field:"vipTier",value:"GOLD",expectedVersion:0,confirmPassword:"wrong-confirmation"})).status,401);
    assert.equal((await change(masterToken,{field:"vipTier",value:"GOLD",expectedVersion:0,reason:"x".repeat(401)})).status,400);
    const vipChanged=await change(masterToken,{field:"vipTier",value:"GOLD",expectedVersion:0});
    assert.equal(vipChanged.status,200);
    assert.equal(vipChanged.data.policy.version,1);
    assert.equal(vipChanged.data.policy.vipTier,"GOLD");
    assert.equal((await change(masterToken,{field:"vipTier",value:"PLATINUM",expectedVersion:0})).status,409);
    const loanChanged=await change(masterToken,{field:"loanRequestsAllowed",value:true,expectedVersion:1,reason:"已核" });
    assert.equal(loanChanged.status,200);
    assert.equal(loanChanged.data.policy.version,2);
    const classChanged=await change(masterToken,{field:"accountClass",value:"REAL_PENDING",expectedVersion:2});
    assert.equal(classChanged.status,200);
    assert.equal(classChanged.data.policy.accountClass,"REAL_PENDING");
    assert.equal(classChanged.data.policy.version,3);
    const withdrawalsChanged=await change(masterToken,{field:"withdrawalRequestsAllowed",value:false,expectedVersion:3});
    assert.equal(withdrawalsChanged.status,200);
    assert.equal(withdrawalsChanged.data.policy.version,4);
    assert.equal((await ownReq("FUNDING",{kind:"WITHDRAWAL",amountCents:10000})).status,403);
    assert.equal((await change(masterToken,{field:"accountClass",value:"REAL_CONNECTED",expectedVersion:4})).status,400);
    const changedAudit=await req(auditPath,{token:masterToken});
    assert.equal(changedAudit.status,200);
    assert.equal(changedAudit.data.items.length,4);
    assert.equal(changedAudit.data.items.find(x=>x.field==="vipTier").reason,"");
    assert.deepEqual(changedAudit.data.items.map(x=>x.field).sort(),
      ["accountClass","loanRequestsAllowed","vipTier","withdrawalRequestsAllowed"].sort());
    assert.equal((await req(auditPath,{token:otherLogin.data.token})).status,404);
    assert.equal((await req(auditPath,{token:subAdmin.data.token})).status,200);
    assert.equal((await req(auditPath,{token:customerAppToken})).status,403);
    const locked=await change(masterToken,{field:"loginAllowed",value:false,expectedVersion:4});
    assert.equal(locked.status,200);
    assert.equal(locked.data.policy.version,5);
    assert.equal((await req("/api/account",{token:customerAppToken})).status,401);
    assert.equal((await req("/api/auth/login",{method:"POST",body:{
      email:attachedEmail,password:"testing-client-pass-2026"
    }})).status,401);
    const policyAfter=await req(policyPath,{token:masterToken});
    assert.equal(policyAfter.data.policy.loginAllowed,false);
    assert.equal(policyAfter.data.policy.withdrawalRequestsAllowed,false);
    assert.equal(policyAfter.data.policy.accountClass,"REAL_PENDING");
    const cashAfter=await db.query("SELECT cash_cents FROM accounts WHERE id=$1",[attached.data.accountId]);
    assert.equal(Number(cashAfter.rows[0].cash_cents),12000);

    // A master can restrict a specific child administrator; an unrelated subaccount cannot inspect it.
    const subPolicyPath="/api/admin/subaccount-controls?userId="+sub.data.userId;
    const subAuditPath="/api/admin/subaccount-control-audit?userId="+sub.data.userId;
    const initialSub=await req(subPolicyPath,{token:masterToken});
    assert.equal(initialSub.status,200);
    assert.equal(initialSub.data.policy.loginAllowed,true);
    assert.equal(initialSub.data.policy.version,0);
    assert.equal(initialSub.data.policy.clientCount,1);
    assert.ok(initialSub.data.policy.requestCount>=2);
    assert.equal((await req(subPolicyPath,{token:subAdmin.data.token})).status,200);
    assert.equal((await req(subPolicyPath,{token:otherLogin.data.token})).status,404);
    assert.equal((await req(subPolicyPath,{token:customerAppToken})).status,401); // customer session was revoked above
    const subEdit=(body)=>req("/api/admin/subaccount-controls",{method:"PATCH",token:masterToken,body:{
      userId:sub.data.userId,loginAllowed:false,expectedVersion:0,
      confirmPassword:recoveredPassword,...body
    }});
    assert.equal((await req("/api/admin/subaccount-controls",{method:"PATCH",token:subAdmin.data.token,body:{
      userId:sub.data.userId,loginAllowed:false,expectedVersion:0,
      reason:"Reviewed delegated account access and security requirements",confirmPassword:subPassword
    }})).status,403);
    assert.equal((await subEdit({confirmPassword:"invalid-password"})).status,401);
    const disabled=await subEdit({});
    assert.equal(disabled.status,200);
    assert.equal(disabled.data.policy.version,1);
    assert.equal(disabled.data.policy.loginAllowed,false);
    assert.equal((await req("/api/admin/me",{token:subAdmin.data.token})).status,401);
    assert.equal((await req("/api/admin/login",{method:"POST",body:{email:subEmail,password:subPassword}})).status,401);
    assert.equal((await subEdit({expectedVersion:0,loginAllowed:true})).status,409);
    const reinstated=await subEdit({expectedVersion:1,loginAllowed:true});
    assert.equal(reinstated.status,200);
    assert.equal(reinstated.data.policy.version,2);
    assert.equal((await req("/api/admin/login",{method:"POST",body:{email:subEmail,password:subPassword}})).status,200);
    const subHistory=await req(subAuditPath,{token:masterToken});
    assert.equal(subHistory.status,200);
    assert.equal(subHistory.data.items.length,2);
    assert.equal(subHistory.data.items[0].reason,"");
    assert.equal(subHistory.data.items[0].newLoginAllowed,true);
    assert.equal(subHistory.data.items[1].newLoginAllowed,false);
    assert.equal((await req(subAuditPath,{token:otherLogin.data.token})).status,404);

    // The unified feed executes real UNION SQL and preserves each role's scope.
    const unifiedMaster=await req("/api/admin/audit-events?limit=200",{token:masterToken});
    assert.equal(unifiedMaster.status,200);
    assert.ok(unifiedMaster.data.items.some(x=>x.eventType==="SUBADMIN"));
    assert.ok(unifiedMaster.data.items.some(x=>x.eventType==="CLIENT_POLICY"&&x.clientId===attached.data.userId));
    const activeSub=await req("/api/admin/login",{method:"POST",body:{email:subEmail,password:subPassword}});
    const unifiedSub=await req("/api/admin/audit-events",{token:activeSub.data.token});
    assert.equal(unifiedSub.status,200);
    assert.ok(unifiedSub.data.items.length>0);
    assert.ok(unifiedSub.data.items.every(x=>x.clientId===attached.data.userId));
    assert.ok(unifiedSub.data.items.every(x=>!["SUBADMIN","COMMODITY"].includes(x.eventType)));
    assert.deepEqual((await req("/api/admin/audit-events",{token:otherLogin.data.token})).data.items,[]);

    // A failed access-audit INSERT must never release the snapshot in the HTTP response.
    await db.query(`CREATE FUNCTION reject_test_mirror_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$`);
    await db.query(`CREATE TRIGGER reject_test_mirror_audit BEFORE INSERT ON admin_mirror_access_log
      FOR EACH ROW EXECUTE FUNCTION reject_test_mirror_audit()`);
    try{
      const blockedMirror=await req("/api/admin/mirror?clientId="+attached.data.userId,{token:masterToken});
      assert.equal(blockedMirror.status,500);
      assert.deepEqual(blockedMirror.data,{error:"Internal server error"});
    }finally{
      await db.query("DROP TRIGGER reject_test_mirror_audit ON admin_mirror_access_log");
      await db.query("DROP FUNCTION reject_test_mirror_audit()");
    }


  }finally{
    await new Promise(done=>app.close(done));
    await db.end();
    if(previousProof===undefined)delete process.env.ADMIN_BOOTSTRAP_SECRET;
    else process.env.ADMIN_BOOTSTRAP_SECRET=previousProof;
    if(previousMasterEmail===undefined)delete process.env.ADMIN_MASTER_EMAIL;
    else process.env.ADMIN_MASTER_EMAIL=previousMasterEmail;
  }
});

run('PostgreSQL: concurrent funding approvals post once and insufficient withdrawals roll back',verifyInternalFunding);
run('PostgreSQL: discounted product participation, six-digit secret, concurrency, lockout and ownership',verifyInternalProducts);
run('PostgreSQL: encrypted identity and bank submissions, scoped reading, audit and concurrent limits',verifyPrivateCustomerData);
