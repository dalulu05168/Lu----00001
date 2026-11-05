import {validateQuote} from "./market-data.mjs";

// Finnhub free tier: real-time US quotes (/quote), no credit card, ~60 req/min.
// Historical candles (/stock/candle) are premium-only, so the history chart
// stays unavailable on the free tier and the UI degrades to a notice.
const SYMBOL=/^[A-Z0-9][A-Z0-9.-]{0,23}$/;
export const stockQuotesConfigured=()=>Boolean(process.env.FINNHUB_API_KEY);

export async function getUsStockHistory(symbol,{
 apiKey=process.env.FINNHUB_API_KEY,fetchImpl=fetch,now=Date.now
}={}){
 const unavailable=()=>Object.assign(new Error("US stock history unavailable"),{statusCode:503});
 if(!apiKey||typeof symbol!=="string"||!SYMBOL.test(symbol))throw unavailable();
 const end=Math.floor(now()/1000),from=end-90*86400;
 const url=new URL("https://finnhub.io/api/v1/stock/candle");
 url.search=new URLSearchParams({symbol,resolution:"D",from:String(from),to:String(end),token:apiKey});
 try{
  const response=await fetchImpl(url,{redirect:"error",signal:AbortSignal.timeout(3000)});
  if(!response.ok)throw unavailable();
  const data=await response.json();
  // Free keys get {s:"no_data"} or a 403 here; only premium returns candles.
  if(data?.s!=="ok"||!Array.isArray(data.t)||!Array.isArray(data.c)||
     data.t.length!==data.c.length||data.t.length<2||data.t.length>400)throw unavailable();
  let previous=from-86400;
  const points=data.t.map((t,i)=>{
   const price=data.c[i];
   if(!Number.isSafeInteger(t)||t<=previous||t>end||!Number.isFinite(price)||price<=0)throw unavailable();
   previous=t;
   return {time:t*1000,price};
  });
  return {symbol,source:"Finnhub",currency:"USD",points};
 }catch{throw unavailable();}
}

export async function getUsStockQuote({market,symbol},{
 apiKey=process.env.FINNHUB_API_KEY,fetchImpl=fetch,now=Date.now,maxAgeMs=120000
}={}){
 const unavailable=()=>Object.assign(new Error("Verified US stock quote unavailable"),{statusCode:503});
 if(market!=="US"||typeof symbol!=="string"||!SYMBOL.test(symbol)||!apiKey)throw unavailable();
 try{
  const url=new URL("https://finnhub.io/api/v1/quote");
  url.search=new URLSearchParams({symbol,token:apiKey});
  const res=await fetchImpl(url,{redirect:"error",signal:AbortSignal.timeout(3000)});
  if(!res.ok)throw unavailable();
  // Finnhub /quote: c=current price, pc=previous close, t=last-trade unix seconds.
  const {c,t}=await res.json();
  if(typeof c!=="number"||c<=0||typeof t!=="number"||t<=0)throw unavailable();
  const timestampMs=Math.floor(t*1000);
  const quote=validateQuote({market,symbol,priceCents:Math.round(c*100),fxUsdMicros:1000000,
   timestampMs,source:"Finnhub",entitled:true},{now:now(),maxAgeMs});
  return {market,symbol,priceCents:quote.priceCents,timestampMs,source:quote.source,currency:"USD"};
 }catch{throw unavailable();}
}
