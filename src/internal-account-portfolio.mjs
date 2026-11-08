import {getAccountSnapshot} from "./account-service.mjs";
import {getAccountAnalytics} from "./account-analytics.mjs";
import {valueInternalStockPortfolio} from "./internal-stock-portfolio-valuation.mjs";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX=BigInt(Number.MAX_SAFE_INTEGER);
function unavailable(reason){
 return Object.assign(new Error("Internal account portfolio unavailable"),
  {statusCode:503,reason});
}

/**
 * Consistent account/positions/complete FIFO history snapshot. HTTP owner must
 * pass accountId derived from an authenticated session, not request JSON.
 *
 * Independent HTTP GETs of /api/account and /api/account/analytics cannot
 * promise one snapshot when trades occur between them. Here both existing
 * account services reuse a SINGLE repeatable-read, read-only PostgreSQL
 * transaction. Quote/network I/O occurs AFTER that transaction has ended.
 *
 * This backend service does not mount a route, request broker execution,
 * mutate QA/production databases, or manufacture values if market-data rights
 * are missing. Caller-supplied quote/FX rights remain fail-closed.
 */
export async function getConsistentInternalStockPortfolio({
 db,accountId,resolveQuote,resolveFxQuote,
 authorizeUsage,authorizeFxUsage,now=Date.now
}={}){
 if(!db||typeof db.connect!=="function"||!UUID.test(accountId??"")||
    typeof now!=="function")throw Object.assign(
     new Error("Invalid portfolio request"),{statusCode:400});
 const c=await db.connect();let active=false;
 let accountSnapshot,analytics,snapshotAt;
 try{
  await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");active=true;
  const verifiedCash=await c.query("SELECT cash_cents FROM accounts WHERE id=$1",[accountId]);
  if(verifiedCash.rows.length!==1)throw Object.assign(
   new Error("Account not found"),{statusCode:404});
  const rawCash=verifiedCash.rows[0].cash_cents;
  if(!["string","number","bigint"].includes(typeof rawCash) ||
     (typeof rawCash==="number"&&!Number.isSafeInteger(rawCash)) ||
     !/^(0|[1-9][0-9]*)$/.test(String(rawCash))||
     BigInt(rawCash)>MAX)throw unavailable("CASH_UNREPRESENTABLE");
  // getAccountSnapshot expects db.query; this facade reuses c for all reads.
  const transactionDb={query:(sql,params)=>c.query(sql,params)};
  accountSnapshot=await getAccountSnapshot(transactionDb,accountId);
  if(accountSnapshot.account.cashCents!==Number(rawCash))
   throw unavailable("CASH_SNAPSHOT_MISMATCH");
  analytics=await getAccountAnalytics(db,accountId,{transactionClient:c});
  snapshotAt=analytics.asOf;
  await c.query("COMMIT");active=false;
 }catch(error){
  if(active)await c.query("ROLLBACK");
  throw error;
 }finally{c.release();}
 const valuation=await valueInternalStockPortfolio({
  accountSnapshot,analytics,resolveQuote,resolveFxQuote,
  authorizeUsage,authorizeFxUsage,now:now()
 });
 return Object.freeze({accountSnapshot,analytics,valuation,snapshotAt});
}
