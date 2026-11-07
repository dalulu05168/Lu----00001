export const SUPPORTED_MARKETS=Object.freeze(["US","CN"]);
const SYMBOL_PATTERN=/^[A-Z0-9.\-]{1,24}$/;
export function validateQuote(quote,{now=Date.now(),maxAgeMs=60_000}={}){
 if(!quote||!SUPPORTED_MARKETS.includes(quote.market)||typeof quote.symbol!=="string"||!SYMBOL_PATTERN.test(quote.symbol))throw new Error("Invalid quote identity");
 if(!Number.isSafeInteger(quote.priceCents)||quote.priceCents<=0)throw new Error("Invalid quote price");
 if(!Number.isSafeInteger(quote.fxUsdMicros)||quote.fxUsdMicros<=0)throw new Error("Invalid FX rate");
 if(!Number.isFinite(quote.timestampMs)||quote.timestampMs>now+5000||now-quote.timestampMs>maxAgeMs)throw new Error("Stale quote");
 if(typeof quote.source!=="string"||!quote.source.trim())throw new Error("Missing quote provenance");
 if(quote.entitled!==true)throw new Error("Market data entitlement required");
 return Object.freeze({...quote});
}
export function createReadOnlyPricingGateway({provider,now=Date.now}){
 if(!provider||typeof provider.getQuote!=="function")throw new Error("Missing quote provider");
 return async function resolveExecutionPrice({market,symbol}){
  if(!SUPPORTED_MARKETS.includes(market)||typeof symbol!=="string"||!SYMBOL_PATTERN.test(symbol))throw new Error("Invalid instrument");
  const quote=validateQuote(await provider.getQuote({market,symbol}),{now:now()});
  if(quote.market!==market||quote.symbol!==symbol)throw new Error("Quote identity mismatch");
  return {priceCents:quote.priceCents,fxUsdMicros:quote.fxUsdMicros,timestampMs:quote.timestampMs};
 };
}
