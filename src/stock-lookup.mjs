const reference = [
  ["US","AAPL","Apple Inc.","NASDAQ"], ["US","MSFT","Microsoft Corporation","NASDAQ"],
  ["US","NEM","Newmont Corporation","NYSE"], ["HK","0700","Tencent Holdings","HKEX"],
  ["HK","9988","Alibaba Group","HKEX"], ["CN","600519","贵州茅台","SSE"],
  ["CN","000001","平安银行","SZSE"], ["MY","1155","Maybank","Bursa Malaysia"],
  ["MY","1023","CIMB Group","Bursa Malaysia"]
].map(([market,symbol,name,exchange])=>({market,symbol,name,exchange,source:"reference"}));
const exchanges = new Map([
  ["XNAS","US"],["XNGS","US"],["XNMS","US"],["XNCM","US"],["XNYS","US"],["ARCX","US"],["XASE","US"],
  ["XHKG","HK"],["XSHG","CN"],["XSHE","CN"],["XBSE","CN"],["XKLS","MY"]
]);
const stockTypes = new Set(["COMMON STOCK","PREFERRED STOCK","AMERICAN DEPOSITARY RECEIPT","DEPOSITARY RECEIPT","GLOBAL DEPOSITARY RECEIPT"]);

function canonicalSymbol(market,symbol){
  return market==="HK"&&/^\d{1,4}$/.test(symbol) ? symbol.padStart(4,"0") : symbol;
}
function unpad(symbol){
  return /^\d+$/.test(symbol) ? symbol.replace(/^0+(?=\d)/,"") : symbol;
}
export async function lookupStocks(db,value,{apiKey=process.env.TWELVE_DATA_API_KEY,fetchImpl=fetch}={}){
  const code=String(value??"").trim().toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9.-]{0,23}$/.test(code)){
    throw Object.assign(new Error("请输入有效股票代码"),{statusCode:400});
  }
  const numeric=unpad(code);
  const matches=symbol=>symbol===code || (symbol.startsWith(code)) || unpad(symbol)===numeric;
  const local=reference.filter(item=>matches(item.symbol));
  const {rows}=await db.query(`SELECT DISTINCT market,symbol,display_name
    FROM listings WHERE item_type='STOCK' AND (symbol LIKE $1 OR ltrim(symbol,'0')=$2)
    ORDER BY market,symbol,display_name LIMIT 30`,[code+"%",numeric==="0"?"":numeric]);
  let provider=apiKey?"unavailable":"unconfigured";
  const external=[];
  if(apiKey){
    try{
      const url=new URL("https://api.twelvedata.com/symbol_search");
      url.search=new URLSearchParams({symbol:code,outputsize:"120",apikey:apiKey});
      const res=await fetchImpl(url,{redirect:"error",signal:AbortSignal.timeout(4500)});
      const data=await res.json();
      if(!res.ok||!Array.isArray(data?.data)||data.status==="error")throw Error("Symbol lookup unavailable");
      provider="available";
      for(const row of data.data){
        const market=exchanges.get(row?.mic_code);
        const raw=String(row?.symbol??"").toUpperCase();
        const name=String(row?.instrument_name??"").trim();
        const exchange=String(row?.exchange??"").trim();
        if(!market||!stockTypes.has(String(row?.instrument_type??"").toUpperCase())||
          !/^[A-Z0-9][A-Z0-9.-]{0,23}$/.test(raw)||!name||name.length>120||!exchange||exchange.length>80)continue;
        const symbol=canonicalSymbol(market,raw);
        if(matches(symbol))external.push({market,symbol,name,exchange,source:"provider"});
      }
    }catch{
      // Local references remain searchable during upstream errors and quota limits.
    }
  }
  const registered=rows.map(row=>({
    market:row.market,symbol:row.symbol,name:row.display_name,
    exchange:[...external,...local].find(item=>item.market===row.market&&item.symbol===canonicalSymbol(row.market,row.symbol))?.exchange??null,
    source:"catalog"
  }));
  const seen=new Set();
  const items=[...registered,...external,...local].filter(item=>{
    const key=item.market+":"+canonicalSymbol(item.market,item.symbol);
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  }).sort((a,b)=>Number(unpad(b.symbol)===numeric)-Number(unpad(a.symbol)===numeric));
  return {items:items.slice(0,30),provider};
}
