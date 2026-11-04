export const ECB_URL='https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
// Fixed upstream URL: clients cannot select a host or use this as a proxy.
export function createReferenceFx({fetchImpl=fetch,now=Date.now}={}){
 let cached,pending,nextAttempt=0,failed=false;
 function snapshot(){return {...cached,status:failed||now()-Date.parse(cached.date+'T00:00:00Z')>4*86400000?'stale':'available'};}
 async function refresh(){
  try{
   const response=await fetchImpl(ECB_URL,{signal:AbortSignal.timeout(8000),redirect:'error'});
   if(!response.ok)throw Error('ECB request failed');
   const xml=await response.text();
   if(xml.length>100000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Invalid ECB response');
   const date=/\btime\s*=\s*['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
   const instant=Date.parse(date+'T00:00:00Z');
   if(!Number.isFinite(instant)||new Date(instant).toISOString().slice(0,10)!==date||instant>now())throw Error('Invalid ECB date');
   const eur={EUR:1};
   for(const tag of xml.matchAll(/<Cube\b[^>]*>/g)){
    const currency=/\bcurrency\s*=\s*['"]([A-Z]{3})['"]/.exec(tag[0])?.[1];
    if(!['USD','HKD','CNY','MYR'].includes(currency))continue;
    const value=/\brate\s*=\s*['"](\d+(?:\.\d+)?)['"]/.exec(tag[0])?.[1];
    if(!value||!Number.isFinite(Number(value))||Number(value)<=0||eur[currency]!==undefined)throw Error('Invalid ECB rate');
    eur[currency]=Number(value);
   }
   if(['USD','HKD','CNY','MYR'].some(c=>!eur[c]))throw Error('Missing ECB currency');
   const rates=Object.fromEntries(['USD','HKD','CNY','MYR'].map(c=>[c,eur[c]/eur.USD]));
   if(Object.values(rates).some(v=>!Number.isFinite(v)||v<=0))throw Error('Invalid cross rate');
   if(cached&&date<cached.date)throw Error('ECB date moved backwards');
   cached={source:'ECB',sourceUrl:'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html',date,fetchedAt:new Date(now()).toISOString(),base:'USD',rates,derived:true,purpose:'INFORMATION_ONLY'};
   failed=false;nextAttempt=now()+3600000;
  }catch{failed=true;nextAttempt=now()+60000;if(!cached)throw Error('Reference FX unavailable');}
  return snapshot();
 }
 return async()=>{
  if(pending)return pending;
  if(now()<nextAttempt){if(cached)return snapshot();throw Error('Reference FX unavailable');}
  pending=refresh();try{return await pending;}finally{pending=null;}
 };
}
