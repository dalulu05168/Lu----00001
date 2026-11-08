import {randomUUID} from "node:crypto";
import {placeInternalOrder} from "./order-service.mjs";
import {assertInternalExecutionQuote} from "./internal-execution-quote.mjs";

// Server-only execution seam. No HTTP route, UI edits or broker transport.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const US=/^[A-Z][A-Z0-9.-]{0,23}$/;
const CN=/^(?:60|68|00|30)\d{4}$/;
const US_MICS=new Set(["XNAS","XNYS","XASE","ARCX","XNGS","XNMS","XNCM","BATS"]);
const invalid=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const unavailable=()=>invalid("Verified internal order pricing unavailable",503);

function normalizeIntent(request) {
 if(!request||typeof request!=="object"||Array.isArray(request)||
    Object.keys(request).some(k=>!["side","market","symbol","quantity"].includes(k))||
    !["BUY","SELL"].includes(request.side) ||
    !(request.market==="US" ? US.test(request.symbol??"") :
      request.market==="CN" ? CN.test(request.symbol??"") : false) ||
    !Number.isSafeInteger(request.quantity) || request.quantity<1 || request.quantity>1_000_000)
   throw invalid("Invalid internal order intent");
 return Object.freeze({side:request.side,market:request.market,symbol:request.symbol,
   quantity:request.quantity});
}
function confirmIdentity(quote,intent) {
 const correctMic=intent.market==="US"
  ? US_MICS.has(quote?.mic)
  : quote?.mic===(/^(60|68)/.test(intent.symbol)?"XSHG":"XSHE");
 if(!correctMic || typeof quote?.name!=="string" || !quote.name.trim() ||
    quote.name.length>180 ||
    quote?.entitlement?.purpose!=="internalSimulationPricing" ||
    typeof quote.entitlement.reviewReference!=="string" ||
    !quote.entitlement.reviewReference.trim()) throw unavailable();
}
function sameOrder(previous,intent) {
 return previous.side===intent.side && previous.market===intent.market &&
   previous.symbol===intent.symbol && String(previous.quantity)===String(intent.quantity);
}

/**
 * Internal buy/sell: accountId must come from an authenticated customer session.
 * The request may not include price, FX, account ID or source. Explicit
 * tradingEnabled and independently reviewed data/FX rights are mandatory.
 * Account/position/order/ledger/quote evidence commit atomically.
 * All external quote calls finish before BEGIN; synchronous quote freshness
 * and rights are then rechecked with the account row lock.
 */
export async function executeLicensedInternalOrder({
 db,accountId,key,request,marketData,fxData,authorizeUsage,authorizeFxUsage,
 tradingEnabled=false,now=Date.now,createId=randomUUID
}={}) {
 if(!db || typeof db.query!=="function" || typeof db.connect!=="function" ||
    typeof now!=="function" || typeof createId!=="function" ||
    !UUID.test(accountId??"") || typeof key!=="string" ||
    key.length<8 || key.length>128) throw invalid("Invalid internal order reference");
 const intent=normalizeIntent(request);
 if(tradingEnabled!==true) throw unavailable();
 // A replay is not a new quote-priced execution. It must work with no feed.
 const prior=await db.query("SELECT id,side,market,symbol,quantity,price_cents,fx_usd_micros FROM orders WHERE account_id=$1 AND idempotency_key=$2",[accountId,key]);
 if(prior.rows.length) {
  const existing=prior.rows[0];
  if(!sameOrder(existing,intent))throw invalid("Idempotency key already used for another order",409);
  const priceCents=Number(existing.price_cents),fxUsdMicros=Number(existing.fx_usd_micros);
  if(!Number.isSafeInteger(priceCents)||priceCents<1||
     !Number.isSafeInteger(fxUsdMicros)||fxUsdMicros<1)throw unavailable();
  return placeInternalOrder(db,accountId,key,{...intent,priceCents,fxUsdMicros},createId());
 }
 if(typeof marketData?.getQuote!=="function" || typeof authorizeUsage!=="function" ||
    (intent.market==="CN" &&
      (typeof fxData?.getQuote!=="function"||typeof authorizeFxUsage!=="function")))
   throw unavailable();
 // Remote I/O before transaction, never while account lock is held.
 const quote=await marketData.getQuote({market:intent.market,symbol:intent.symbol},
   {purpose:"internalSimulationPricing"});
 confirmIdentity(quote,intent);
 const fxQuote=intent.market==="CN"?
   await fxData.getQuote({base:"CNY",quote:"USD",purpose:"internalPricing"}):undefined;
 const certify=()=>assertInternalExecutionQuote({
   request:intent,quote,fxQuote,authorizeUsage,authorizeFxUsage,now:now()
 });
 const initial=certify();
 if(initial.licenseReviewReference!==quote.entitlement.reviewReference)throw unavailable();
 const result=await placeInternalOrder(db,accountId,key,{
  ...intent,priceCents:initial.priceCents,fxUsdMicros:initial.fxUsdMicros
 },createId(),{
  assertInstrumentAvailable:async client=>{
   const allowed=await client.query("SELECT id FROM listings WHERE market=$1 AND symbol=$2 AND status='PUBLISHED' AND item_type IN ('STOCK','FUND') ORDER BY id LIMIT 1 FOR SHARE",[intent.market,intent.symbol]);
   if(allowed.rows.length!==1)
    throw invalid("Security not available for orders",409);
  },
  assertExecutionReady:()=>{
   const fresh=certify();
   if(fresh.licenseReviewReference!==quote.entitlement.reviewReference ||
      fresh.priceCents!==initial.priceCents ||
      fresh.fxUsdMicros!==initial.fxUsdMicros ||
      fresh.amountUsdCents!==initial.amountUsdCents)throw unavailable();
  },
  persistQuoteEvidence:async (client,order)=>{
   await client.query("INSERT INTO order_execution_evidence(order_id,account_id,market,symbol,quote_currency,quote_price_cents,quote_at,quote_source,quote_license_ref,fx_usd_micros,fx_at,fx_source,fx_license_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",[
    order.id,accountId,intent.market,intent.symbol,initial.currency,
    initial.priceCents,new Date(initial.quoteTimestampMs),initial.quoteSource,
    initial.licenseReviewReference,initial.fxUsdMicros,
    initial.fxTimestampMs==null?null:new Date(initial.fxTimestampMs),
    initial.fxSource??null,initial.fxReviewReference
   ]);
  }
 });
 return {...result,quote:{
  source:initial.quoteSource,timestampMs:initial.quoteTimestampMs,
  currency:initial.currency,priceCents:initial.priceCents
 }};
}
