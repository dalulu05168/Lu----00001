import {validateQuote} from "./market-data.mjs";

// Alpaca Market Data API, free tier (IEX feed only, no card, ~200 req/min).
// NOTE: endpoint paths and field names below follow Alpaca's long-stable
// Market Data v2 API from prior knowledge; they were NOT re-verified against
// live docs in this session (the sandbox network does not reach
// docs.alpaca.markets). Every response is strictly shape-checked, so a wrong
// field name fails safe into "unavailable" rather than showing bad data —
// but if the whole shape is off, quotes will simply stay unavailable until
// someone with a real key confirms the actual response against
// https://docs.alpaca.markets/reference/stocklatesttrade-1 and
// https://docs.alpaca.markets/reference/stockbars-1 and this file is adjusted.
const SYMBOL=/^[A-Z0-9][A-Z0-9.-]{0,23}$/;
const DATA_HOST="https://data.alpaca.markets";

export const stockQuotesConfigured=()=>Boolean(process.env.APCA_API_KEY_ID)&&Boolean(process.env.APCA_API_SECRET_KEY);

function authHeaders(keyId,secretKey){
 return {"APCA-API-KEY-ID":keyId,"APCA-API-SECRET-KEY":secretKey,accept:"application/json"};
}

export async function getUsStockHistory(symbol,{
 keyId=process.env.APCA_API_KEY_ID,secretKey=process.env.APCA_API_SECRET_KEY,
 fetchImpl=fetch,now=Date.now
}={}){
 const unavailable=()=>Object.assign(new Error("US stock history unavailable"),{statusCode:503});
 if(!keyId||!secretKey||typeof symbol!=="string"||!SYMBOL.test(symbol))throw unavailable();
 const day=ms=>new Date(ms).toISOString().slice(0,10);
 const end=now(),from=end-90*86400000;
 const url=new URL(DATA_HOST+"/v2/stocks/"+encodeURIComponent(symbol)+"/bars");
 url.search=new URLSearchParams({timeframe:"1Day",start:day(from),end:day(end),feed:"iex",limit:"100"});
 try{
  const response=await fetchImpl(url,{headers:authHeaders(keyId,secretKey),redirect:"error",signal:AbortSignal.timeout(3000)});
  if(!response.ok)throw unavailable();
  const data=await response.json();
  if(data?.symbol!==symbol||!Array.isArray(data.bars)||data.bars.length<2||data.bars.length>100)throw unavailable();
  let previous=from-86400000;
  const points=data.bars.map(({t,c})=>{
   const time=Date.parse(t);
   if(!Number.isFinite(time)||time<=previous||time>end||!Number.isFinite(c)||c<=0)throw unavailable();
   previous=time;
   return {time,price:c};
  });
  return {symbol,source:"Alpaca",currency:"USD",points};
 }catch{throw unavailable();}
}

export async function getUsStockQuote({market,symbol},{
 keyId=process.env.APCA_API_KEY_ID,secretKey=process.env.APCA_API_SECRET_KEY,
 fetchImpl=fetch,now=Date.now,maxAgeMs=120000
}={}){
 const unavailable=()=>Object.assign(new Error("Verified US stock quote unavailable"),{statusCode:503});
 if(market!=="US"||typeof symbol!=="string"||!SYMBOL.test(symbol)||!keyId||!secretKey)throw unavailable();
 try{
  const url=new URL(DATA_HOST+"/v2/stocks/"+encodeURIComponent(symbol)+"/trades/latest");
  url.searchParams.set("feed","iex");
  const res=await fetchImpl(url,{headers:authHeaders(keyId,secretKey),redirect:"error",signal:AbortSignal.timeout(3000)});
  if(!res.ok)throw unavailable();
  const data=await res.json();
  const trade=data?.trade;
  if(data?.symbol!==symbol||!trade||typeof trade.p!=="number"||trade.p<=0||typeof trade.t!=="string")throw unavailable();
  const timestampMs=Date.parse(trade.t);
  if(!Number.isFinite(timestampMs))throw unavailable();
  const quote=validateQuote({market,symbol,priceCents:Math.round(trade.p*100),fxUsdMicros:1000000,
   timestampMs,source:"Alpaca IEX",entitled:true},{now:now(),maxAgeMs});
  return {market,symbol,priceCents:quote.priceCents,timestampMs,source:quote.source,currency:"USD"};
 }catch{throw unavailable();}
}
