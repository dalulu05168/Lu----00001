const MARKET_CURRENCY={US:"USD",HK:"HKD",CN:"CNY",MY:"MYR"};
const SYMBOL=/^[A-Z0-9.\-]{1,24}$/;
function timeoutSignal(ms){return AbortSignal.timeout(ms);}
async function json(url,timeoutMs){
  const r=await fetch(url,{signal:timeoutSignal(timeoutMs),headers:{accept:"application/json"}});
  if(!r.ok)throw new Error(`Market provider HTTP ${r.status}`);
  const v=await r.json();
  if(v.Note||v.Information||v.error)throw new Error("Market provider limit or error");
  return v;
}
function cents(value){const n=Number(value);return Number.isFinite(n)&&n>0?Math.round(n*100):null;}
function fxMicros(value){const n=Number(value);return Number.isFinite(n)&&n>0?Math.round(n*1_000_000):null;}
export function createMarketDataProvider({finnhubApiKey=process.env.FINNHUB_API_KEY,alphaVantageApiKey=process.env.ALPHA_VANTAGE_API_KEY,timeoutMs=5000}={}){
  const finnhub=String(finnhubApiKey||"").trim();
  const alpha=String(alphaVantageApiKey||"").trim();
  if(!finnhub&&!alpha)return null;
  async function alphaFx(from,to){
    if(from===to)return 1_000_000;
    const v=await json(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${encodeURIComponent(from)}&to_currency=${encodeURIComponent(to)}&apikey=${encodeURIComponent(alpha)}`,timeoutMs);
    return fxMicros(v["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]);
  }
  async function quote({market,symbol}){
    if(!MARKET_CURRENCY[market]||!SYMBOL.test(symbol))throw new Error("Invalid instrument");
    if(market!=="US")throw new Error("Provider currently supports US quotes only");
    const currency=MARKET_CURRENCY[market];
    if(finnhub){
      const v=await json(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(finnhub)}`,timeoutMs);
      const price=cents(v.c),timestampMs=Number(v.t)*1000;
      if(!price||!Number.isFinite(timestampMs)||timestampMs<=0)throw new Error("Quote unavailable");
      return {market,symbol,priceCents:price,fxUsdMicros:1_000_000,timestampMs,source:"finnhub.us.quote",entitled:true,change:v.d,changePercent:v.dp,high:v.h,low:v.l,open:v.o,previousClose:v.pc};
    }
    const v=await json(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(alpha)}&entitlement=${encodeURIComponent(process.env.ALPHA_VANTAGE_ENTITLEMENT||"delayed")}`,timeoutMs);
    const q=v["Global Quote"]||{},price=cents(q["05. price"]);
    if(!price)throw new Error("Quote unavailable");
    const day=Date.parse(`${q["07. latest trading day"]||""}T16:00:00Z`);
    return {market,symbol,priceCents:price,fxUsdMicros:1_000_000,timestampMs:day||Date.now(),source:"alphavantage.global_quote",entitled:false,change:Number(q["09. change"]),changePercent:Number(String(q["10. change percent"]||"").replace("%",""))};
  }
  return {getQuote:quote,getFx:alpha?alphaFx:async(from,to)=>from===to?1_000_000:null,provider:finnhub?"finnhub": "alphavantage"};
}
