// Strict, server-side preflight for future US/CN internal execution wiring.
// This module does NOT fetch market data or authorize a quote source itself.
// A trusted backend policy callback is mandatory: raw provider "entitled:true"
// is not evidence of customer display or internal-price-use licensing.
const SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,23}$/;
const CURRENCIES = Object.freeze({ US:"USD", CN:"CNY" });

function unavailable(reason) {
  throw Object.assign(new Error("Verified internal execution quote unavailable"),{
    statusCode:503, reason
  });
}
function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * request is the authenticated customer's normalized order intent.
 * quote is an untrusted vendor adapter result, never browser-submitted data.
 * authorizeUsage is a SERVER-side lookup of reviewed license/entitlement.
 * For CNY quotes fxQuote must also originate from a trusted server adapter.
 * Do not enable orders until real sources, legal use and HTTP integration are verified.
 */
export function assertInternalExecutionQuote({
  request, quote, fxQuote, authorizeUsage, now=Date.now(),
  maxAgeMs=60_000, maxFxAgeMs=60_000
}={}) {
  if(!request || typeof request!=="object" || !["BUY","SELL"].includes(request.side) ||
      !Object.hasOwn(CURRENCIES,request.market) || !SYMBOL.test(request.symbol??"") ||
      !positiveSafeInteger(request.quantity)) {
    throw Object.assign(new Error("Invalid order intent"),{statusCode:400});
  }
  if(!Number.isSafeInteger(now) || now<0 ||
      !positiveSafeInteger(maxAgeMs) || !positiveSafeInteger(maxFxAgeMs)) {
    throw new TypeError("Invalid server quote policy");
  }
  if(!quote || quote.market!==request.market || quote.symbol!==request.symbol ||
      quote.currency!==CURRENCIES[request.market]) unavailable("INSTRUMENT_OR_CURRENCY_MISMATCH");
  if(!positiveSafeInteger(quote.priceCents)) unavailable("INVALID_PRICE");
  if(!Number.isSafeInteger(quote.timestampMs) || quote.timestampMs>now+5_000 ||
      now-quote.timestampMs>maxAgeMs) unavailable("QUOTE_STALE");
  if(typeof quote.source!=="string" || quote.source.trim().length===0 ||
      quote.source.length>120) unavailable("SOURCE_MISSING");
  // Licensing is not inferred from a vendor API's HTTP 200, a fixed
  // "entitled:true" field, or access to historical market information.
  if(typeof authorizeUsage!=="function") unavailable("LICENSE_UNVERIFIED");
  let rights;
  try {
    rights=authorizeUsage({
      source:quote.source, market:quote.market, currency:quote.currency,
      usage:"CUSTOMER_DISPLAY_AND_INTERNAL_PRICING", now
    });
  } catch { unavailable("LICENSE_UNVERIFIED"); }
  if(rights?.customerDisplayAllowed!==true || rights?.internalPricingAllowed!==true ||
      rights?.market!==quote.market || rights?.source!==quote.source ||
      rights?.currency!==quote.currency ||
      !Number.isSafeInteger(rights.validUntilMs) || rights.validUntilMs<now) {
    unavailable("LICENSE_UNVERIFIED");
  }
  let fxUsdMicros=1_000_000;
  if(request.market==="CN"){
    if(!fxQuote || fxQuote.base!=="CNY" || fxQuote.quote!=="USD" ||
        !positiveSafeInteger(fxQuote.usdMicros) ||
        !Number.isSafeInteger(fxQuote.timestampMs) ||
        fxQuote.timestampMs>now+5_000 ||
        now-fxQuote.timestampMs>maxFxAgeMs ||
        typeof fxQuote.source!=="string" || !fxQuote.source.trim()) {
      unavailable("FX_UNAVAILABLE");
    }
    fxUsdMicros=fxQuote.usdMicros;
  }
  // Exact integer multiplication, consistent with applyOrder() in ledger.mjs.
  const amount=(BigInt(quote.priceCents)*BigInt(fxUsdMicros)*
    BigInt(request.quantity)+500_000n)/1_000_000n;
  if(amount<=0n || amount>BigInt(Number.MAX_SAFE_INTEGER)) unavailable("AMOUNT_OVERFLOW");
  return Object.freeze({
    market:request.market,symbol:request.symbol,side:request.side,
    quantity:request.quantity,priceCents:quote.priceCents,
    currency:quote.currency,fxUsdMicros,amountUsdCents:Number(amount),
    quoteTimestampMs:quote.timestampMs,quoteSource:quote.source,
    ...(fxQuote && request.market==="CN"?{
      fxTimestampMs:fxQuote.timestampMs,fxSource:fxQuote.source
    }:{})
  });
}
