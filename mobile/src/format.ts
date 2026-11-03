import type {Order} from "./api";
export function amount(cents:unknown,currency="USD"):string {
  const number=typeof cents==="number"?cents:typeof cents==="string"&&cents.trim()!==""?Number(cents):NaN;
  if(!Number.isSafeInteger(number)||number<0)return "—";
  try{return new Intl.NumberFormat("en-US",{style:"currency",currency}).format(number/100);}
  catch{return (number/100).toFixed(2)+" "+currency;}
}
export function dateLabel(value:unknown):string {
  if(typeof value!=="string")return "—";
  const t=Date.parse(value);
  return Number.isFinite(t)?new Date(t).toLocaleString():"—";
}
export function shares(value:unknown):string {
  const n=Number(value);
  return Number.isFinite(n)&&n>=0?new Intl.NumberFormat("en-US",{maximumFractionDigits:6}).format(n):"—";
}
export function orderCsv(orders:Order[]):string {
  // Only export actual authenticated account data; prevent spreadsheet formula injection.
  const cell=(value:unknown):string=>{
    let s=String(value??"");
    if(/^[\s]*[=+@-]/.test(s))s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  };
  const rows=[["市场","代码","方向","数量","金额(USD)","创建时间"]];
  for(const o of orders)rows.push([o.market,o.symbol,o.side,String(o.quantity),String(o.amount_usd_cents??""),o.created_at||""]);
  return rows.map(r=>r.map(cell).join(",")).join("\r\n");
}
