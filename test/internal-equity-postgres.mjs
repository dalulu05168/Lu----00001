import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {Pool} from "pg";
import {executeLicensedInternalOrder} from "../src/internal-equity-execution.mjs";
import {placeInternalOrder} from "../src/order-service.mjs";
import {getAccountAnalytics} from "../src/account-analytics.mjs";
import {getAccountSnapshot} from "../src/account-service.mjs";
import {getVerifiedInternalOrderReceipt} from "../src/internal-order-readback.mjs";
import {valueInternalStockPortfolio} from "../src/internal-stock-portfolio-valuation.mjs";

// Real ephemeral PostgreSQL; only external quote calls use deterministic
// licensed-format fixtures. This is NOT proof of live provider access.
export async function verifyLicensedEquityPostgres(connectionString) {
 const db=new Pool({connectionString,max:4});
 const clock=Date.now();
 const us="U"+randomUUID().replaceAll("-","").slice(0,9).toUpperCase();
 const cn="600519";
 const accountId=randomUUID(),otherId=randomUUID();
 const userId=randomUUID(),otherUserId=randomUUID();
 const prices=new Map([["US:"+us,10000],["CN:"+cn,20000]]);
 const authorizeUsage=({market,currency,source})=>({
  market,currency,source,customerDisplayAllowed:true,internalPricingAllowed:true,
  validUntilMs:clock+60000,reviewReference:"QA-EQUITY-REVIEW"
 });
 const authorizeFxUsage=({base,quote,source})=>({
  base,quote,source,internalPricingAllowed:true,validUntilMs:clock+60000,
  reviewReference:"QA-FX-REVIEW"
 });
 const authorizeTradingSession=({market})=>({
  market,allowed:true,validUntilMs:clock+60000,
  ruleReference:"QA-EXCHANGE-SESSION"
 });
 const marketData={async getQuote({market,symbol},{purpose}){
  assert.equal(purpose,"internalSimulationPricing");
  return {status:"FRESH",stale:false,market,symbol,currency:market==="US"?"USD":"CNY",
   mic:market==="US"?"XNAS":"XSHG",name:"Isolated test equity",
   priceCents:prices.get(market+":"+symbol),timestampMs:clock-1000,
   source:"QA_EQUITY_FIXTURE",
   entitlement:{purpose,reviewReference:"QA-EQUITY-REVIEW"}};
 }};
 const fxData={async getQuote({base,quote,purpose}){
  assert.equal(purpose,"internalPricing");
  return {base,quote,usdMicros:140000,timestampMs:clock-1000,source:"QA_FX_FIXTURE"};
 }};
 const args={db,accountId,marketData,fxData,authorizeUsage,authorizeFxUsage,authorizeTradingSession,
  tradingEnabled:true,now:()=>clock};
 const buy=(market,symbol,quantity,key)=>executeLicensedInternalOrder({
  ...args,key,request:{side:"BUY",market,symbol,quantity}
 });
 const sell=(market,symbol,quantity,key)=>executeLicensedInternalOrder({
  ...args,key,request:{side:"SELL",market,symbol,quantity}
 });
 try{
  // Candidate is applied ONLY to this CI's disposable test database. It is
  // intentionally NOT in db/ and never run by the normal migration command.
  const sql=await readFile(new URL("../migration-candidates/024_internal_order_quote_evidence.sql",import.meta.url),"utf8");
  await db.query(sql);
  let admin=(await db.query("SELECT user_id FROM admin_roles ORDER BY created_at LIMIT 1")).rows[0]?.user_id;
  if(!admin){
   admin=randomUUID();
   await db.query("INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,'test-hash')",
     [admin,"qa-equity-admin-"+admin+"@example.test"]);
   await db.query("INSERT INTO admin_roles(user_id,role,totp_secret_ciphertext) VALUES($1,'MASTER','test-only')",[admin]);
  }
  for(const [market,symbol] of [["US",us],["CN",cn]]){
   await db.query("INSERT INTO listings(id,item_type,market,symbol,display_name,purchase_password_hash,status,created_by) VALUES($1,'STOCK',$2,$3,'Isolated equity','test-hash','PUBLISHED',$4)",
    [randomUUID(),market,symbol,admin]);
  }
  for(const [id,user] of [[accountId,userId],[otherId,otherUserId]]){
   await db.query("INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,'test-hash')",
    [user,"qa-equity-"+user+"@example.test"]);
   await db.query("INSERT INTO accounts(id,user_id,cash_cents) VALUES($1,$2,$3)",
    [id,user,id===accountId?100000:0]);
  }
  await db.query("INSERT INTO cash_ledger(account_id,delta_cents,balance_after_cents) VALUES($1,100000,100000)",[accountId]);
  const usPurchase=await buy("US",us,3,"qa-us-first-buy");
  assert.equal(usPurchase.replayed,false);
  assert.equal(usPurchase.cashCents,70000);
  const cnPurchase=await buy("CN",cn,2,"qa-cn-first-buy");
  assert.equal(cnPurchase.replayed,false);
  assert.equal(cnPurchase.cashCents,64400);
  assert.equal((await getAccountSnapshot(db,accountId)).positions.length,2);
  // Test price changes are fixtures, not actual market prices.
  prices.set("US:"+us,15000);
  const usSale=await sell("US",us,1,"qa-us-partial-sale");
  assert.equal(usSale.cashCents,79400);
  prices.set("CN:"+cn,25000);
  const cnSale=await sell("CN",cn,1,"qa-cn-partial-sale");
  assert.equal(cnSale.cashCents,82900);
  // A retry may be confirmed without asking the live feed for a new price.
  const replay=await executeLicensedInternalOrder({
   ...args,marketData:undefined,fxData:undefined,key:"qa-us-first-buy",
   request:{side:"BUY",market:"US",symbol:us,quantity:3}
  });
  assert.equal(replay.replayed,true);
  assert.equal(replay.order.id,usPurchase.order.id);
  await assert.rejects(executeLicensedInternalOrder({
   ...args,key:"qa-us-first-buy",request:{side:"BUY",market:"US",symbol:us,quantity:2}
  }),e=>e.statusCode===409);
  await assert.rejects(sell("US",us,20,"qa-too-many-shares"),/Insufficient position/);
  await assert.rejects(executeLicensedInternalOrder({
   ...args,accountId:otherId,key:"qa-other-without-cash",
   request:{side:"BUY",market:"US",symbol:us,quantity:1}
  }),/Insufficient funds/);
  const stale={getQuote:async ({market,symbol},{purpose})=>({
   ...await marketData.getQuote({market,symbol},{purpose}),
   timestampMs:clock-120000
  })};
  await assert.rejects(executeLicensedInternalOrder({
   ...args,marketData:stale,key:"qa-stale-rejected",
   request:{side:"BUY",market:"US",symbol:us,quantity:1}
  }),e=>e.statusCode===503);
  await assert.rejects(executeLicensedInternalOrder({
   ...args,authorizeTradingSession:()=>({allowed:false}),key:"qa-closed-market",
   request:{side:"BUY",market:"US",symbol:us,quantity:1}
  }),e=>e.statusCode===503);
  await assert.rejects(executeLicensedInternalOrder({
   ...args,authorizeUsage:()=>({entitled:true}),key:"qa-unlicensed",
   request:{side:"BUY",market:"US",symbol:us,quantity:1}
  }),e=>e.statusCode===503);
  await assert.rejects(executeLicensedInternalOrder({
   ...args,tradingEnabled:false,key:"qa-disabled-trade",
   request:{side:"BUY",market:"US",symbol:us,quantity:1}
  }),e=>e.statusCode===503);
  await assert.rejects(executeLicensedInternalOrder({
   ...args,key:"qa-client-price-rejected",
   request:{side:"BUY",market:"US",symbol:us,quantity:1,priceCents:1}
  }),e=>e.statusCode===400);
  await assert.rejects(executeLicensedInternalOrder({
   ...args,key:"qa-numeric-symbol-rejected",
   request:{side:"BUY",market:"CN",symbol:600519,quantity:1}
  }),e=>e.statusCode===400);
  // Prove quote audit is part of the transaction: an evidence write failure
  // must also roll back cash, position, order and cash-ledger mutations.
  await assert.rejects(placeInternalOrder(db,accountId,"qa-audit-fails",{
   side:"BUY",market:"US",symbol:us,quantity:1,priceCents:100,fxUsdMicros:1000000
  },randomUUID(),{persistQuoteEvidence:async()=>{throw Error("evidence unavailable")}}),
  /evidence unavailable/);
  const account=await getAccountSnapshot(db,accountId);
  assert.equal(account.account.cashCents,82900);
  assert.deepEqual(account.positions.map(p=>[p.market,p.symbol,Number(p.quantity)]),
   [["CN",cn,1],["US",us,2]]);
  assert.equal(account.orders.length,4);
  const isolated=await getAccountSnapshot(db,otherId);
  assert.equal(isolated.account.cashCents,0);
  assert.deepEqual(isolated.positions,[]);
  assert.deepEqual(isolated.orders,[]);
  const analytics=await getAccountAnalytics(db,accountId,{now:new Date(clock+1000)});
  assert.equal(analytics.historyAvailable,true);
  assert.equal(analytics.method,"FIFO");
  assert.equal(analytics.realizedPnlCents,5700);
  assert.equal(analytics.positionCostCents,22800);
  const valuation=await valueInternalStockPortfolio({
    accountSnapshot:account,analytics,
    resolveQuote:instrument=>marketData.getQuote(instrument,{purpose:"internalSimulationPricing"}),
    resolveFxQuote:pair=>fxData.getQuote({...pair,purpose:"internalPricing"}),
    authorizeUsage,authorizeFxUsage,now:clock
  });
  assert.equal(valuation.valuationAvailable,true);
  assert.equal(valuation.marketValueCents,33500);
  assert.equal(valuation.unrealizedPnlCents,10700);
  assert.equal(valuation.portfolioValueCents,116400);
  const noQuoteValuation=await valueInternalStockPortfolio({
    accountSnapshot:account,analytics,
    resolveQuote:async()=>{throw Error("No market price");},
    authorizeUsage,now:clock
  });
  assert.equal(noQuoteValuation.valuationAvailable,false);
  assert.equal(noQuoteValuation.unrealizedPnlCents,null);
  assert.equal(noQuoteValuation.portfolioValueCents,null);
  const [stored,ledger,evidence]=await Promise.all([
   db.query("SELECT id,market,side,amount_usd_cents FROM orders WHERE account_id=$1 ORDER BY created_at",[accountId]),
   db.query("SELECT order_id,delta_cents FROM cash_ledger WHERE account_id=$1 AND order_id IS NOT NULL",[accountId]),
   db.query("SELECT market,quote_source,quote_license_ref,fx_source,fx_license_ref,quote_price_cents,session_rule_ref FROM order_execution_evidence WHERE account_id=$1",[accountId])
  ]);
  assert.equal(stored.rows.length,4);
  assert.equal(ledger.rows.length,4);
  assert.equal(evidence.rows.length,4);
  const buyReceipt=await getVerifiedInternalOrderReceipt(db,accountId,usPurchase.order.id);
  assert.equal(buyReceipt.execution,"INTERNAL_ONLY");
  assert.equal(buyReceipt.quoteCurrency,"USD");
  assert.equal(buyReceipt.amountUsdCents,30000);
  assert.equal(buyReceipt.cashDeltaCents,-30000);
  const cnReceipt=await getVerifiedInternalOrderReceipt(db,accountId,cnSale.order.id);
  assert.equal(cnReceipt.quoteCurrency,"CNY");
  assert.equal(cnReceipt.fxUsdMicros,140000);
  assert.equal(cnReceipt.amountUsdCents,3500);
  assert.equal(cnReceipt.cashDeltaCents,3500);
  await assert.rejects(getVerifiedInternalOrderReceipt(db,otherId,usPurchase.order.id),
    e=>e.statusCode===404 && e.reason==="ORDER_NOT_FOUND");
  assert.equal(evidence.rows.filter(x=>x.market==="CN"&&
   x.fx_license_ref==="QA-FX-REVIEW").length,2);
  assert.equal(evidence.rows.every(x=>x.quote_license_ref==="QA-EQUITY-REVIEW"),true);
  assert.equal(evidence.rows.every(x=>x.session_rule_ref==="QA-EXCHANGE-SESSION"),true);
  assert.equal((await db.query("SELECT count(*)::integer AS c FROM orders WHERE account_id=$1",[otherId])).rows[0].c,0);
  return {accountId,orders:stored.rows.length,evidence:evidence.rows.length,
   cashCents:account.account.cashCents,realizedPnlCents:analytics.realizedPnlCents,
   positionCostCents:analytics.positionCostCents};
 }finally{await db.end();}
}
