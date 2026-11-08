// Authenticated server-only readback of a committed, evidenced internal fill.
// The caller must resolve accountId from the session; client IDs are not
// accepted as authentication. No broker ownership or external execution.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX=BigInt(Number.MAX_SAFE_INTEGER);
function failure(reason,statusCode=503){
 return Object.assign(new Error("Internal order record unavailable"),{
  statusCode,reason
 });
}
function num(value,{positive=true}={}){
 if(typeof value==="number"&&!Number.isSafeInteger(value))throw failure("RECORD_AMOUNT_INVALID");
 if(!["number","string"].includes(typeof value)||!/^\d+$/.test(String(value)))
  throw failure("RECORD_AMOUNT_INVALID");
 const n=BigInt(value);
 if(n>MAX || (positive&&n===0n))throw failure("RECORD_AMOUNT_INVALID");
 return n;
}
export async function getVerifiedInternalOrderReceipt(db,accountId,orderId){
 if(!UUID.test(accountId??"")||!UUID.test(orderId??"")||
    typeof db?.connect!=="function")
   throw failure("INVALID_REQUEST",400);
 const client=await db.connect();let active=false;
 try{
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");active=true;
  const res=await client.query(
   "SELECT o.id,o.market,o.symbol,o.side,o.quantity,o.price_cents,o.fx_usd_micros,o.amount_usd_cents,o.execution_type,o.created_at,"+
   "l.delta_cents,l.balance_after_cents,e.quote_currency,e.quote_price_cents,e.quote_at,e.quote_source,e.quote_license_ref,"+
   "e.fx_usd_micros AS evidenced_fx_usd_micros,e.fx_at,e.fx_source,e.fx_license_ref,e.session_rule_ref "+
   "FROM orders o LEFT JOIN cash_ledger l ON l.order_id=o.id AND l.account_id=o.account_id "+
   "LEFT JOIN order_execution_evidence e ON e.order_id=o.id AND e.account_id=o.account_id "+
   "WHERE o.account_id=$1 AND o.id=$2",[accountId,orderId]);
  if(res.rows.length!==1)throw failure("ORDER_NOT_FOUND",404);
  const r=res.rows[0];
  if(!["BUY","SELL"].includes(r.side)||!["US","CN"].includes(r.market)||
     r.execution_type!=="INTERNAL_ONLY" ||
     !/^[A-Z0-9][A-Z0-9.-]{0,23}$/.test(r.symbol??"") ||
     typeof r.quote_source!=="string"||!r.quote_source.trim()||
     typeof r.quote_license_ref!=="string"||!r.quote_license_ref.trim()||
     typeof r.session_rule_ref!=="string"||!r.session_rule_ref.trim())
     throw failure("EVIDENCE_UNAVAILABLE");
  const quantity=num(r.quantity),price=num(r.price_cents);
  const fx=num(r.fx_usd_micros),total=num(r.amount_usd_cents);
  const quoted=num(r.quote_price_cents),verifiedFx=num(r.evidenced_fx_usd_micros);
  const balance=num(r.balance_after_cents,{positive:false});
  if(quoted!==price||verifiedFx!==fx ||
     (r.market==="US"&&r.quote_currency!=="USD")||
     (r.market==="CN"&&(r.quote_currency!=="CNY"||
      !r.fx_at||!r.fx_source||!r.fx_license_ref)))throw failure("EVIDENCE_MISMATCH");
  const calc=(quantity*price*fx+500_000n)/1_000_000n;
  if(calc!==total||calc>MAX)throw failure("ORDER_AMOUNT_MISMATCH");
  if(!["number","string"].includes(typeof r.delta_cents)||
     !/^-?\d+$/.test(String(r.delta_cents))||
     BigInt(r.delta_cents)!==(r.side==="BUY"?-total:total))
     throw failure("CASH_LEDGER_MISMATCH");
  const stamp=r.quote_at instanceof Date?r.quote_at.getTime():Date.parse(r.quote_at);
  const traded=r.created_at instanceof Date?r.created_at.getTime():Date.parse(r.created_at);
  if(!Number.isFinite(stamp)||!Number.isFinite(traded)||
     stamp>traded+5000 || traded-stamp>60_000)
    throw failure("QUOTE_TIMESTAMP_MISMATCH");
  const record=Object.freeze({
   id:r.id,market:r.market,symbol:r.symbol,side:r.side,
   quantity:Number(quantity),execution:"INTERNAL_ONLY",
   quoteCurrency:r.quote_currency,unitPriceCents:Number(price),
   fxUsdMicros:Number(fx),amountUsdCents:Number(total),
   cashDeltaCents:Number(BigInt(r.delta_cents)),balanceAfterCents:Number(balance),
   quoteSource:r.quote_source,quoteTimestampMs:stamp,
   createdAt:new Date(traded).toISOString()
  });
  await client.query("COMMIT");active=false;
  return record;
 }catch(error){
  if(active)await client.query("ROLLBACK");
  throw error;
 }finally{client.release();}
}
