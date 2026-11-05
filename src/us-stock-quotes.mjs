import {validateQuote} from "./market-data.mjs";

// Finnhub free tier: real-time US quotes (/quote), no credit card, ~60 req/min.
// Finnhub's free tier does not include historical candles, so daily history
// comes from Twelve Data's /time_series instead (also free, no card; already
// used in this codebase for symbol search in stock-lookup.mjs, same
// TWELVE_DATA_API_KEY and the same lowercase "apikey" query param it uses).
const SYMBOL=/^[A-Z0-9][A-Z0-9.-]{0,23}$/;
export const stockQuotesConfigured=()=>Boolean(process.env.FINNHUB_API_KEY);
export const stockHistoryConfigured=()=>Boolean(process.env.TWELVE_DATA_API_KEY);

// Logs only to the server's own stdout/stderr (Render's log stream) — never
// sent to the client, and the key itself is never logged. Kept lightweight
// (one line per failure) since this runs on every unconfigured/failed quote.
function logQuoteFailure(endpoint,symbol,detail){
 console.error("[us-stock-quotes] "+endpoint+" "+symbol+": "+detail);
}

export async function getUsStockHistory(symbol,{
 apiKey=process.env.TWELVE_DATA_API_KEY,fetchImpl=fetch,now=Date.now
}={}){
 const unavailable=()=>Object.assign(new Error("US stock history unavailable"),{statusCode:503});
 if(!apiKey||typeof symbol!=="string"||!SYMBOL.test(symbol)){
  logQuoteFailure("history",symbol,!apiKey?"TWELVE_DATA_API_KEY not set":"invalid symbol");
  throw unavailable();
 }
 const end=now();
 const url=new URL("https://api.twelvedata.com/time_series");
 url.search=new URLSearchParams({symbol,interval:"1day",outputsize:"90",apikey:apiKey});
 try{
  const response=await fetchImpl(url,{redirect:"error",signal:AbortSignal.timeout(4000)});
  if(!response.ok){logQuoteFailure("history",symbol,"HTTP "+response.status);throw unavailable();}
  const data=await response.json();
  if(data?.status!=="ok"||!Array.isArray(data.values)||data.values.length<2||data.values.length>400){
   logQuoteFailure("history",symbol,"unexpected shape: "+JSON.stringify(data).slice(0,200));
   throw unavailable();
  }
  // Twelve Data's own ordering isn't relied on; sort ascending by date so the
  // chart always receives oldest-to-newest, same contract as before.
  const parsed=data.values.map(row=>{
   const time=Date.parse(String(row?.datetime)+"T00:00:00Z");
   const price=Number(row?.close);
   if(!Number.isFinite(time)||time>end||!Number.isFinite(price)||price<=0)throw unavailable();
   return {time,price};
  }).sort((a,b)=>a.time-b.time);
  for(let i=1;i<parsed.length;i++)if(parsed[i].time<=parsed[i-1].time)throw unavailable();
  return {symbol,source:"Twelve Data",currency:"USD",points:parsed};
 }catch(error){
  if(error?.statusCode!==503)logQuoteFailure("history",symbol,"fetch/parse error: "+(error?.message??error));
  throw unavailable();
 }
}

// Finnhub's free /quote is a single-venue (IEX) last-trade price, not a
// continuously ticking SIP feed: it only moves while IEX itself trades, and
// stops updating entirely outside market hours and on weekends/holidays. A
// short freshness window (originally copied from a continuous-SIP provider)
// would make every quote "unavailable" most of the day. Six days comfortably
// spans any holiday weekend while still rejecting genuinely broken data.
const DEFAULT_MAX_AGE_MS=6*86400000;

export async function getUsStockQuote({market,symbol},{
 apiKey=process.env.FINNHUB_API_KEY,fetchImpl=fetch,now=Date.now,maxAgeMs=DEFAULT_MAX_AGE_MS
}={}){
 const unavailable=()=>Object.assign(new Error("Verified US stock quote unavailable"),{statusCode:503});
 if(market!=="US"||typeof symbol!=="string"||!SYMBOL.test(symbol)||!apiKey){
  logQuoteFailure("quote",symbol,market!=="US"?"non-US market":!apiKey?"FINNHUB_API_KEY not set":"invalid symbol");
  throw unavailable();
 }
 try{
  const url=new URL("https://finnhub.io/api/v1/quote");
  url.search=new URLSearchParams({symbol,token:apiKey});
  const res=await fetchImpl(url,{redirect:"error",signal:AbortSignal.timeout(3000)});
  if(!res.ok){logQuoteFailure("quote",symbol,"HTTP "+res.status);throw unavailable();}
  // Finnhub /quote: c=current price, pc=previous close, t=last-trade unix seconds.
  const body=await res.json();
  const {c,t}=body;
  if(typeof c!=="number"||c<=0||typeof t!=="number"||t<=0){
   logQuoteFailure("quote",symbol,"unexpected shape: "+JSON.stringify(body).slice(0,200));
   throw unavailable();
  }
  const timestampMs=Math.floor(t*1000);
  let quote;
  try{
   quote=validateQuote({market,symbol,priceCents:Math.round(c*100),fxUsdMicros:1000000,
    timestampMs,source:"Finnhub",entitled:true},{now:now(),maxAgeMs});
  }catch(error){
   logQuoteFailure("quote",symbol,"validateQuote rejected: "+error.message+
    " (quote age "+Math.round((now()-timestampMs)/60000)+" min, window "+Math.round(maxAgeMs/60000)+" min)");
   throw unavailable();
  }
  return {market,symbol,priceCents:quote.priceCents,timestampMs,source:quote.source,currency:"USD"};
 }catch(error){
  if(error?.statusCode!==503)logQuoteFailure("quote",symbol,"fetch/parse error: "+(error?.message??error));
  throw unavailable();
 }
}

/**
 * Adapter for the order endpoint's resolveExecutionPrice hook. This is still
 * an internal-only order ledger (see order-service.mjs/ledger.mjs): placing
 * an order never contacts a broker or exchange, it only records a row here,
 * the same as the already-live simulated buy/sell flow. Only the US market
 * has a wired quote source today; other markets correctly surface pricing as
 * unavailable (the caller's generic 503 handling) until one is connected.
 */
export async function resolveOrderExecutionPrice({market,symbol},options={}){
 const quote=await getUsStockQuote({market,symbol},options);
 return {priceCents:quote.priceCents,fxUsdMicros:1000000,timestampMs:quote.timestampMs};
}
