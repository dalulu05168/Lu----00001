import {assertInternalExecutionQuote} from "./internal-execution-quote.mjs";

const MAX=BigInt(Number.MAX_SAFE_INTEGER);
function amount(value) {
  if(typeof value==="number" && !Number.isSafeInteger(value)) return null;
  if(!["number","string"].includes(typeof value) || !/^\d+$/.test(String(value))) return null;
  const big=BigInt(value);
  return big<=MAX?big:null;
}
const symbol=/^[A-Z0-9][A-Z0-9.-]{0,23}$/;
const unavailable=(reason,realizedPnlCents=null)=>Object.freeze({
  currency:"USD",method:"FIFO",valuationAvailable:false,reason,
  realizedPnlCents,unrealizedPnlCents:null,marketValueCents:null,
  portfolioValueCents:null,quotes:[]
});

/**
 * Mark an account's verified FIFO history to actual licensed market quotes.
 *
 * Must receive both accountSnapshot and getAccountAnalytics output from the
 * SAME authorized, consistent database snapshot. This method never invents
 * a mark from a missing quote, and never places an exchange/broker order.
 *
 * Realized P/L is taken from the full committed cash-ledger FIFO history.
 * Unrealized P/L = sum(licensed quote * held shares) - remaining FIFO basis.
 * Amounts and FX are integer-rounded only once per position. No fees are
 * presumed. Product holdings require a separate licensed valuation method.
 *
 * Not mounted to shared /api/account/analytics until API owner coordinates
 * the snapshot, vendor license and US/CN backend route contract in Issue #42.
 */
export async function valueInternalStockPortfolio({
  accountSnapshot,analytics,resolveQuote,resolveFxQuote,authorizeUsage,authorizeFxUsage,now=Date.now()
}={}) {
  if(analytics?.historyAvailable!==true || analytics.method!=="FIFO" ||
     analytics.currency!=="USD" || !Number.isSafeInteger(analytics.realizedPnlCents)) {
    return unavailable("COST_BASIS_UNAVAILABLE");
  }
  const realized=analytics.realizedPnlCents;
  const cash=amount(accountSnapshot?.account?.cashCents);
  const cost=amount(analytics.positionCostCents);
  const rows=accountSnapshot?.positions;
  if(accountSnapshot?.account?.currency!=="USD" || cash===null ||
      cost===null || !Array.isArray(rows)) return unavailable("INVALID_ACCOUNT_SNAPSHOT",realized);
  const holdings=[],seen=new Set();
  for(const row of rows) {
    const quantity=amount(row?.quantity);
    if(quantity===null || quantity===0n ||
       !["US","CN"].includes(row.market) || !symbol.test(row.symbol??"") ||
       quantity>MAX) return unavailable("UNSUPPORTED_OR_INVALID_HOLDING",realized);
    const key=row.market+":"+row.symbol;
    if(seen.has(key))return unavailable("DUPLICATE_POSITION",realized);
    seen.add(key);
    holdings.push({...row,quantity:Number(quantity)});
  }
  if(analytics.holdingCount!==holdings.length || (holdings.length===0 && cost!==0n))
    return unavailable("POSITION_HISTORY_MISMATCH",realized);
  if(holdings.length && (typeof resolveQuote!=="function" || typeof authorizeUsage!=="function"))
    return unavailable("QUOTE_UNAVAILABLE",realized);
  let totalMarketValue=0n;const quotes=[];
  for(const holding of holdings) {
    let verified;
    try {
      const request={side:"SELL",market:holding.market,symbol:holding.symbol,quantity:holding.quantity};
      const quote=await resolveQuote({market:holding.market,symbol:holding.symbol});
      const fxQuote=holding.market==="CN"
        ?await resolveFxQuote?.({base:"CNY",quote:"USD"}):undefined;
      verified=assertInternalExecutionQuote({request,quote,fxQuote,authorizeUsage,authorizeFxUsage,now});
    } catch {
      return unavailable("QUOTE_UNAVAILABLE",realized);
    }
    totalMarketValue+=BigInt(verified.amountUsdCents);
    if(totalMarketValue>MAX) return unavailable("AMOUNT_OVERFLOW",realized);
    quotes.push(Object.freeze({
      market:holding.market,symbol:holding.symbol,quantity:holding.quantity,
      marketValueCents:verified.amountUsdCents,
      priceCents:verified.priceCents,currency:verified.currency,
      quoteTimestampMs:verified.quoteTimestampMs,source:verified.quoteSource
    }));
  }
  const unrealized=totalMarketValue-cost;
  const portfolioValue=cash+totalMarketValue;
  if(unrealized>MAX || unrealized< -MAX || portfolioValue>MAX)
    return unavailable("AMOUNT_OVERFLOW",realized);
  return Object.freeze({
    currency:"USD",method:"FIFO",valuationAvailable:true,reason:null,
    realizedPnlCents:realized,unrealizedPnlCents:Number(unrealized),
    marketValueCents:Number(totalMarketValue),
    portfolioValueCents:Number(portfolioValue),quotes:Object.freeze(quotes)
  });
}
