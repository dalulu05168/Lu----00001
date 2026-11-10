function createProductQuote(env, request=fetch, now=Date.now){
 const key=env.EULERPOOL_API_KEY;
 if(typeof key!=='string'||!key.trim())return undefined;
 const cache=new Map();
 async function json(path){
  const r=await request('https://api.eulerpool.com/api/1/'+path,{headers:{Authorization:'Bearer '+key},redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(!r.ok)cnProductFail('Reference quote unavailable',503);
  return r.json();
 }
 return async({symbol,market})=>{
  if(market!=='US')cnProductFail('Unsupported reference market',400);
  const old=cache.get(symbol);if(old&&now()-old.loadedAt<60000)return old;
  const search=await json('equity/search?q='+encodeURIComponent(symbol));
  const rows=Array.isArray(search)?search:Array.isArray(search?.results)?search.results:search?.results?[search.results]:[];
  const matches=rows.filter(x=>x.ticker===symbol&&['stock','etf'].includes(x.type)&&/^[A-Z0-9]{12}$/.test(x.isin));
  if(matches.length!==1)cnProductFail('Instrument not found',404);
  let item=matches[0],kind=item.type==='etf'?'etf':'equity';
  if(kind==='etf'){
   const profile=await json('etf/profile/'+item.isin);
   if(profile.isin!==item.isin||profile.symbol!==symbol||profile.currency!=='USD'||!profile.tickers?.some(x=>x.ticker===symbol&&['amex','nyse','nasdaq'].includes(String(x.exchange).toLowerCase())))cnProductFail('Reference quote identity mismatch',503);
   item={...item,currency:profile.currency,name:profile.name||item.name};
  }
  if(item.currency!=='USD')cnProductFail('Reference quote identity mismatch',503);
  const history=await json(kind+'/quotes/'+item.isin+'?startdate='+(now()-7*86400000));
  if(!Array.isArray(history))cnProductFail('Reference quote unavailable',503);
  let last;
  for(const row of history){const t=Array.isArray(row)?row[0]:row.timestamp,p=Array.isArray(row)?row[1]:row.price;if(Number.isSafeInteger(t)&&typeof p==='number'&&p>0&&(!last||t>last.timestampMs))last={timestampMs:t,priceCents:Math.round(p*100)};}
  if(!last||!Number.isSafeInteger(last.priceCents)||last.priceCents<=0||last.timestampMs>now()+5000||now()-last.timestampMs>5*86400000)cnProductFail('Reference quote stale or invalid',503);
  const value={symbol,market,name:item.name,isin:item.isin,currency:'USD',...last,loadedAt:now(),source:'EULERPOOL_REFERENCE'};
  if(cache.size>200)cache.clear();cache.set(symbol,value);return value;
 };
}
