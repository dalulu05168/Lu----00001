#!/usr/bin/env node
// Read-only pre-UI integration gate. Never submits orders or touches a database.
import {pathToFileURL} from 'node:url';
import {validateBaseUrl} from './three-end-readonly-gate.mjs';

const CHECKS = Object.freeze([
  {role:'client',path:'/api/account',key:'account'},
  {role:'client',path:'/api/account/analytics',key:'pnl'},
  {role:'client',path:'/api/catalog',key:'catalog'},
  {role:'client',path:'/api/watchlist',key:'watchlist'},
  {role:'client',path:'/api/internal-purchases',key:'internalLedger'},
  {role:'client',path:'/api/stock-quote?market=US&symbol=AAPL',key:'quoteUS'},
  {role:'client',path:'/api/stock-quote?market=CN&symbol=600519',key:'quoteCN'},
  {role:'admin',path:'/api/admin/me',key:'adminSession'},
  {role:'admin',path:'/api/admin/clients',key:'adminClients'}
]);
const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const safeCents=v=>Number.isSafeInteger(v)&&v>=0;
const safeSignedCents=v=>Number.isSafeInteger(v);
const validSymbol=s=>typeof s==='string'&&/^[A-Z0-9][A-Z0-9.-]{0,23}$/.test(s);

// A structurally valid empty account is different from an uninitialized account.
export function validateBusinessSnapshot(key,data,{now=Date.now(),maxQuoteAgeMs=60000}={}) {
  if (!isObject(data)) return 'JSON object required';
  if (key==='account') {
    if(!isObject(data.account)||typeof data.account.id!=='string'||!data.account.id||
       !safeCents(data.account.cashCents)||typeof data.account.currency!=='string'||
       !Array.isArray(data.positions)||!Array.isArray(data.orders)) return 'account/cash/positions/orders absent or invalid';
    if (!data.positions.every(x=>isObject(x)&&['US','CN'].includes(x.market)&&validSymbol(x.symbol)&&
       Number.isSafeInteger(Number(x.quantity))&&Number(x.quantity)>=0)) return 'invalid position';
    if (!data.orders.every(x=>isObject(x)&&typeof x.id==='string'&&validSymbol(x.symbol)&&
       ['BUY','SELL'].includes(x.side)&&['US','CN'].includes(x.market)&&Number(x.quantity)>0&&
       safeCents(Number(x.price_cents??x.priceCents)))) return 'invalid order readback';
    return null;
  }
  if (key==='pnl') {
    if(data.historyAvailable!==true||data.currency!=='USD'||!['FIFO','WEIGHTED_AVERAGE'].includes(data.method)||
       !safeSignedCents(data.realizedPnlCents)||!safeSignedCents(data.unrealizedPnlCents)||
       !safeCents(data.positionCostCents)||!safeCents(data.portfolioValueCents)||
       !Number.isFinite(Date.parse(data.asOf))) return 'verified cost, realized/unrealized P&L and valuation required';
    return null;
  }
  if(key==='catalog') {
    if(!Array.isArray(data.items)) return 'catalog items array required';
    if(!data.items.some(x=>x.market==='US'&&x.itemType==='STOCK'&&validSymbol(x.symbol)&&x.name) ||
       !data.items.some(x=>x.market==='CN'&&x.itemType==='STOCK'&&validSymbol(x.symbol)&&x.name))
      return 'both US and CN real-stock catalog entries required';
    return null;
  }
  if(key==='watchlist') return Array.isArray(data.items)?null:'watchlist items array required';
  if(key==='internalLedger') return Array.isArray(data.positions)&&Array.isArray(data.purchases)&&
    Array.isArray(data.sales)?null:'internal positions/purchases/sales arrays required';
  if(key==='quoteUS'||key==='quoteCN') {
    const market=key==='quoteUS'?'US':'CN',currency=market==='US'?'USD':'CNY';
    if(data.market!==market||!validSymbol(data.symbol)||data.currency!==currency||
       !safeCents(data.priceCents)||data.priceCents===0||
       !Number.isFinite(data.timestampMs)||data.timestampMs>now+5000||
       now-data.timestampMs>maxQuoteAgeMs||typeof data.source!=='string'||!data.source.trim()||
       data.entitled!==true||data.stale===true)
      return 'verified licensed, correctly-timestamped market price required';
    return null;
  }
  if(key==='adminSession') return ['MASTER','SUBADMIN'].includes(data.role)&&typeof data.userId==='string'&&
    data.userId?null:'verified administrator session required';
  if(key==='adminClients') return Array.isArray(data.items)?null:'admin clients array required';
  return 'unknown contract';
}

export async function runBusinessContractGate({baseUrl,clientToken,adminToken,remoteReadonly=false,
 fetchImpl=globalThis.fetch,now=Date.now(),timeoutMs=7000}={}) {
  const origin=validateBaseUrl(baseUrl,{remoteReadonly});
  const host=new URL(origin).hostname;
  if(!['localhost','127.0.0.1','[::1]'].includes(host)&&!origin.startsWith('https://'))
    throw new Error('Remote authenticated QA requires HTTPS');
  if(typeof fetchImpl!=='function') throw new TypeError('fetchImpl required');
  const tokens={client:clientToken,admin:adminToken};
  const results=[];
  for(const check of CHECKS){
    const token=tokens[check.role];
    if(typeof token!=='string'||!token.trim()){
      results.push({key:check.key,role:check.role,status:'BLOCKED',reason:'authorized QA session not provided'});continue;
    }
    try {
      const response=await fetchImpl(origin+check.path,{method:'GET',redirect:'manual',cache:'no-store',
        headers:{authorization:'Bearer '+token,accept:'application/json'},signal:AbortSignal.timeout(timeoutMs)});
      if(response.status!==200){results.push({key:check.key,role:check.role,status:'FAIL',httpStatus:response.status,
        reason:'HTTP '+response.status});continue;}
      if(!String(response.headers.get('content-type')||'').toLowerCase().includes('application/json')){
        results.push({key:check.key,role:check.role,status:'FAIL',reason:'API returned non-JSON'});continue;
      }
      let data;try{data=await response.json();}catch{data=null;}
      const error=validateBusinessSnapshot(check.key,data,{now});
      results.push({key:check.key,role:check.role,status:error?'FAIL':'PASS',...(error?{reason:error}:{})});
    }catch(e){results.push({key:check.key,role:check.role,status:'FAIL',reason:e?.name||'Network failure'});}
  }
  return {origin,mode:'authenticated read-only, zero mutations',results,
    schemaPassed:results.length>0&&results.every(x=>x.status==='PASS'),
    executionVerified:false,dbDurabilityVerified:false,adminTotpVerified:false,
    historyChartVerified:false,externalMarketLicenseVerified:false,
    reminder:'Schema checks never prove real supplier entitlement, true order settlement, database durability, UI integration or P&L arithmetic.'};
}

async function main(args){
 const p=args.indexOf('--base-url');const baseUrl=p<0?undefined:args[p+1];
 const r=await runBusinessContractGate({baseUrl,clientToken:process.env.QA_CLIENT_TOKEN,
   adminToken:process.env.QA_ADMIN_TOKEN,remoteReadonly:args.includes('--remote-readonly')});
 console.log(JSON.stringify(r,null,2));
 if(!r.schemaPassed)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
