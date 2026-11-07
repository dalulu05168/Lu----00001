// The administrator's published directory supplements the public example symbols.
// A directory entry is not proof of broker eligibility or a live market quote.
const SUPPORTED_MARKETS = new Set(["US", "CN"]);
export function mergePublishedInstruments(fallback,catalog,{authenticated=false,catalogLoaded=false,markets=[]}={}){
 const examples=fallback.filter(item=>item && SUPPORTED_MARKETS.has(item.market)).map(item=>({
  ...item,
  name:authenticated&&catalogLoaded?item.name+"（示例）":item.name,
  published:false
 }));
 if(!authenticated||!catalogLoaded)return examples;
 const allowed=new Set(markets.filter(code=>SUPPORTED_MARKETS.has(code)));
 const result=[];
 const seen=new Set();
 for(const item of Array.isArray(catalog)?catalog:[]){
  if(!item||!["STOCK","FUND"].includes(item.itemType))continue;
  if(!allowed.has(item.market))continue;
  if(typeof item.symbol!=="string"||!item.symbol.trim()||typeof item.name!=="string"||!item.name.trim())continue;
  const symbol=item.symbol.trim().toUpperCase();
  const key=item.market+":"+symbol;
  if(seen.has(key))continue;
  seen.add(key);
  result.push({market:item.market,symbol,name:item.name.trim(),published:true});
 }
 for(const item of examples){
  const key=item.market+":"+item.symbol;
  if(!seen.has(key)){seen.add(key);result.push(item);}
 }
 return result;
}
