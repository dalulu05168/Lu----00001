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
      ["001_init.sql", "002_sessions.sql", "003_private_account_data.sql", "003_watchlist.sql", "004_watchlist_security.sql", "005_admin_roles_and_catalog.sql", "006_admin_mirror_access.sql", "007_admin_password_only.sql", "008_client_admin_policies.sql", "009_operational_requests.sql"]
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
    assert.equal((await req(adminWorkflow,{token:clientLogin.data.token})).status,403);
    assert.equal((await req(adminWorkflow)).status,401);
    const workflowChange=(token,category,id,expectedStatus,status)=>req("/api/admin/workflow-requests",{
      method:"PATCH",token,body:{category,id,expectedStatus,status,reason:"Reviewed against documented internal request procedures"}
    });
    assert.equal((await workflowChange(subAdmin.data.token,"FUNDING",deposit.data.item.id,"SUBMITTED","APPROVED")).status,403);
    const intake=await workflowChange(subAdmin.data.token,"FUNDING",deposit.data.item.id,"SUBMITTED","UNDER_REVIEW");
    assert.equal(intake.status,200);
    assert.equal(intake.data.item.status,"UNDER_REVIEW");
    const approved=await workflowChange(masterToken,"FUNDING",deposit.data.item.id,"UNDER_REVIEW","APPROVED");
    assert.equal(approved.status,200);
    assert.equal(approved.data.item.settlementStatus,"NOT_EXECUTED");
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
    assert.equal(Number(balanceAfterReview.rows[0].cash_cents),0);

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
    const mirrorFromOwnSub=await req("/api/admin/mirror?clientId="+attached.data.userId,{token:subAdmin.data.token});
    assert.equal(mirrorFromOwnSub.status,200);
    const otherEmail="other-sub-"+randomUUID().slice(0,8)+"@example.test";
    const otherSub=await req("/api/admin/subaccounts",{method:"POST",token:masterToken,body:{email:otherEmail,password:subPassword}});
    assert.equal(otherSub.status,201);
    const otherLogin=await req("/api/admin/login",{method:"POST",body:{email:otherEmail,password:subPassword}});
    assert.equal(otherLogin.status,200);
    assert.deepEqual((await req(adminWorkflow,{token:otherLogin.data.token})).data.items,[]);
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
    assert.equal(unchangedClient.data.account.cashCents,0);

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
      clientId:attached.data.userId,reason:"Verified internal policy adjustment",confirmPassword:recoveredPassword,...body
    }});
    assert.equal((await change(subAdmin.data.token,{field:"vipTier",value:"GOLD",expectedVersion:0})).status,403);
    assert.equal((await change(masterToken,{field:"vipTier",value:"GOLD",expectedVersion:0,confirmPassword:"wrong-confirmation"})).status,401);
    assert.equal((await change(masterToken,{field:"vipTier",value:"GOLD",expectedVersion:0,reason:"short"})).status,400);
    const vipChanged=await change(masterToken,{field:"vipTier",value:"GOLD",expectedVersion:0});
    assert.equal(vipChanged.status,200);
    assert.equal(vipChanged.data.policy.version,1);
    assert.equal(vipChanged.data.policy.vipTier,"GOLD");
    assert.equal((await change(masterToken,{field:"vipTier",value:"PLATINUM",expectedVersion:0})).status,409);
    const loanChanged=await change(masterToken,{field:"loanRequestsAllowed",value:true,expectedVersion:1});
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
    assert.equal(Number(cashAfter.rows[0].cash_cents),0);

  }finally{
    await new Promise(done=>app.close(done));
    await db.end();
    if(previousProof===undefined)delete process.env.ADMIN_BOOTSTRAP_SECRET;
    else process.env.ADMIN_BOOTSTRAP_SECRET=previousProof;
    if(previousMasterEmail===undefined)delete process.env.ADMIN_MASTER_EMAIL;
    else process.env.ADMIN_MASTER_EMAIL=previousMasterEmail;
  }
});
