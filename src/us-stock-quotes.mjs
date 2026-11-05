import {validateQuote} from "./market-data.mjs";

export const stockQuotesConfigured=()=>Boolean(process.env.MASSIVE_API_KEY)&&process.env.US_STOCK_REALTIME_ENTITLED==="true";

export async function getUsStockQuote({market,symbol},{
 apiKey=process.env.MASSIVE_API_KEY,licensed=process.env.US_STOCK_REALTIME_ENTITLED==="true",fetchImpl=fetch,now=Date.now
}={}){
 const unavailable=()=>Object.assign(new Error("Verified US stock quote unavailable"),{statusCode:503});
 if(market!=="US"||typeof symbol!=="string"||!/^[A-Z0-9][A-Z0-9.-]{0,23}$/.test(symbol)||!licensed||!apiKey)throw unavailable();
 try{
  const url=new URL("https://api.massive.com/v2/last/trade/"+encodeURIComponent(symbol));
  url.searchParams.set("apiKey",apiKey);
  const res=await fetchImpl(url,{redirect:"error",signal:AbortSignal.timeout(3000)});
  if(!res.ok)throw unavailable();
  const {status,results}=await res.json();
  if(status!=="OK"||results?.T!==symbol||typeof results.p!=="number"||typeof results.t!=="number")throw unavailable();
  const timestampMs=Math.floor(Math.min(results.t,typeof results.y==="number"?results.y:results.t)/1e6);
  const quote=validateQuote({market,symbol,priceCents:Math.round(results.p*100),fxUsdMicros:1000000,
   timestampMs,source:"Massive SIP",entitled:true},{now:now(),maxAgeMs:30000});
  return {market,symbol,priceCents:quote.priceCents,timestampMs,source:quote.source,currency:"USD"};
 }catch{throw unavailable();}
}
