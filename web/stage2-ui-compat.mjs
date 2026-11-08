// Stage 3: isolated view-model integration for the UNMODIFIED stage2 desktop/mobile UI.
// Uses the existing window-3 business API. No market data or trade can be invented here.
const error=(code,status)=>Object.assign(new Error(code),{code,status});
const dollars=v=>Number.isSafeInteger(v)?v/100:null;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function emptyStage2State(){
 return {desktop:{acct:'',sync:'未同步',cashOverride:null,totalAssets:null,realizedPnl:null,
  holds:[],orders:[],reqs:[],watch:[],fav:[],chat:[],names:{},sec:{}},
 mobile:{auth:0,accountReady:false,ordersReady:false,cash:null,holdCost:null,
  realizedPnl:null,tradeTotal:null,hold:[],ord:[],req:[],chat:[],fav:[]},
 flags:{account:false,analytics:false,orders:false,positions:false,watchlist:false,
  requests:false,quotes:false,tradeEligible:false}};
}
export function toStage2State(overview,{catalog,watchlist,requests}={}){
 const state=emptyStage2State();
 if(!object(overview))return state;
 const acct=overview.account?.state==='ready'?overview.account.data:null;
 const pnl=overview.analytics?.state==='ready'?overview.analytics.data:null;
 if(acct&&object(acct.account)&&acct.account.currency==='USD'&&
    Number.isSafeInteger(acct.account.cashCents)&&acct.account.cashCents>=0&&
    Array.isArray(acct.positions)&&Array.isArray(acct.orders)){
  state.flags.account=true;state.flags.positions=true;state.flags.orders=true;
  const cash=dollars(acct.account.cashCents);
  state.desktop.acct=String(acct.account.id||'').slice(-8);
  state.desktop.cashOverride=cash;state.desktop.sync='已同步';
  state.mobile.auth=1;state.mobile.accountReady=true;state.mobile.ordersReady=true;state.mobile.cash=cash;
  state.desktop.holds=acct.positions.map(p=>({s:p.symbol,q:p.quantity,c:null}));
  state.mobile.hold=acct.positions.map(p=>({s:p.symbol,q:p.quantity,c:null}));
  state.desktop.orders=acct.orders.map(o=>({id:o.id,s:o.symbol,
   t:o.side==='BUY'?'买入':'卖出',p:dollars(o.priceCents),q:o.quantity,
   a:dollars(o.amountUsdCents),d:o.createdAt||null}));
  state.mobile.ord=state.desktop.orders.map(o=>({...o}));
 }
 if(pnl?.historyAvailable===true&&pnl.currency==='USD'&&pnl.method==='FIFO'){
  state.flags.analytics=true;
  state.desktop.realizedPnl=dollars(pnl.realizedPnlCents);
  state.mobile.realizedPnl=state.desktop.realizedPnl;
  state.mobile.holdCost=dollars(pnl.positionCostCents);
  state.desktop.totalAssets=dollars(pnl.portfolioValueCents);
  state.mobile.tradeTotal=dollars(pnl.volumeCents);
 }
 if(Array.isArray(catalog))for(const p of catalog)
  if(['US','CN'].includes(p.market)&&typeof p.symbol==='string'&&typeof p.name==='string')
   state.desktop.names[p.symbol]=p.name;
 if(Array.isArray(watchlist)){
  state.flags.watchlist=true;
  state.desktop.watch=watchlist.map(x=>x.symbol);state.desktop.fav=[...state.desktop.watch];
  state.mobile.fav=[...state.desktop.fav];
 }
 if(Array.isArray(requests)){
  state.flags.requests=true;
  state.desktop.reqs=requests.map(x=>({id:x.id,k:x.kind||x.category||'申请',
   a:dollars(x.amountCents),st:x.status??'—',d:x.createdAt||null}));
  state.mobile.req=state.desktop.reqs.map(x=>({...x}));
 }
 return state; // trading remains disabled, even if reads succeeded.
}
export function createStage2ClientController({businessApi,getToken,capabilities={}}={}){
 if(typeof businessApi?.loadOverview!=='function'||typeof getToken!=='function')
  throw new TypeError('Authenticated business API required');
 let last=emptyStage2State(),generation=0;
 function clear(){generation++;last=emptyStage2State();return last;}
 async function refresh(){
  const seq=++generation,token=getToken();
  if(typeof token!=='string'||!token)return clear();
  try{
   const [overview,cat,watch,req]=await Promise.allSettled([
    businessApi.loadOverview(),businessApi.getCatalog(),businessApi.getWatchlist(),businessApi.getRequests()]);
   if(seq!==generation||getToken()!==token)throw error('SESSION_CHANGED',401);
   const failures=[overview,cat,watch,req].filter(x=>x.status==='rejected');
   const fatal=failures.find(x=>[401,403].includes(x.reason?.status));
   if(overview.status==='rejected'||fatal)throw (overview.status==='rejected'?overview.reason:fatal.reason);
   last=toStage2State(overview.value,{catalog:cat.status==='fulfilled'?cat.value:null,
    watchlist:watch.status==='fulfilled'?watch.value:null,requests:req.status==='fulfilled'?req.value:null});
   return last;
  }catch(e){clear();throw e;}
 }
 async function readQuote(instrument){
  if(typeof businessApi.getQuote!=='function')throw error('QUOTE_UNAVAILABLE',503);
  const seq=generation,token=getToken();if(!token)throw error('AUTH_REQUIRED',401);
  try{
   const quote=await businessApi.getQuote(instrument);
   if(seq!==generation||getToken()!==token)throw error('SESSION_CHANGED',401);
   return quote; // window-3 adapter validates licensed display/time/source.
  }catch(e){if([401,403].includes(e?.status))clear();throw e;}
 }
 async function submitOrder(input){
  if(capabilities.internalTradingQaVerified!==true||typeof businessApi.submitInternalOrder!=='function')
    throw error('TRADING_UNAVAILABLE',503);
  const result=await businessApi.submitInternalOrder(input); // POST -> GET verified by window-3.
  await refresh();return result;
 }
 return Object.freeze({clear,refresh,readQuote,submitOrder,getState:()=>last});
}
export const STAGE2_ADMIN_API=Object.freeze({
 'p-over':'/api/admin/me','p-cli':'/api/admin/clients',
 'p-appr':'/api/admin/workflow-requests?category=FUNDING',
 'p-fund':'/api/admin/workflow-requests?category=FUNDING',
 'p-cat':'/api/admin/listings',accounts:'/api/admin/subaccounts',
 support:'/api/admin/support',audit:'/api/admin/audit-events',
 mirror:'/api/admin/mirror-status',commodities:'/api/admin/commodities'
});
export function createStage2AdminReader({getAdminToken,fetchImpl=fetch}={}){
 if(typeof getAdminToken!=='function'||typeof fetchImpl!=='function')throw new TypeError('Admin API required');
 async function read(id){
  const path=STAGE2_ADMIN_API[id];if(!path)throw error('UNMAPPED_ADMIN_ENTRY',404);
  const token=getAdminToken();if(!token)throw error('AUTH_REQUIRED',401);
  async function get(p){
   const r=await fetchImpl(p,{method:'GET',cache:'no-store',
    headers:{authorization:'Bearer '+token,accept:'application/json'}});
   const d=await r.json().catch(()=>null);
   if(getAdminToken()!==token)throw error('SESSION_CHANGED',401);
   if(!r.ok)throw error('ADMIN_API_UNAVAILABLE',r.status);
   if(!object(d))throw error('INVALID_ADMIN_DATA',503);
   return d;
  }
  const admin=await get('/api/admin/me');
  if(!['MASTER','SUBADMIN'].includes(admin.role))throw error('ADMIN_2FA_REQUIRED',403);
  return {actor:admin,data:path==='/api/admin/me'?admin:await get(path),path};
 }
 return Object.freeze({read});
}
// Only a server-issued session followed by GET /account permits sign-in.
export function createStage2ClientSession({getToken,setToken,fetchImpl=fetch}={}){
 if(typeof getToken!=='function'||typeof setToken!=='function'||typeof fetchImpl!=='function')
  throw new TypeError('Session dependencies required');
 async function request(path,{method='GET',token,body}={}){
  const r=await fetchImpl('/api'+path,{method,cache:'no-store',headers:{accept:'application/json',
   ...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json().catch(()=>null);
  if(!r.ok)throw error('AUTH_HTTP_'+r.status,r.status);
  return data;
 }
 async function login({email,password}){
  if(typeof email!=='string'||typeof password!=='string')throw error('INVALID_CREDENTIALS',400);
  setToken(null);const result=await request('/auth/login',{method:'POST',body:{email,password}});
  if(typeof result?.token!=='string'||!result.token)throw error('INVALID_SESSION',503);
  try{
   const snap=await request('/account',{token:result.token});
   if(!object(snap?.account)||!Number.isSafeInteger(snap.account.cashCents)||
      snap.account.currency!=='USD'||!Array.isArray(snap.positions)||!Array.isArray(snap.orders))
     throw error('ACCOUNT_UNCONFIRMED',503);
   setToken(result.token);return {accountId:snap.account.id,currency:'USD'};
  }catch(e){setToken(null);throw e;}
 }
 async function logout(){
  const token=getToken();if(!token){setToken(null);return {revoked:false};}
  try{await request('/auth/logout',{method:'POST',token});return {revoked:true};}
  finally{setToken(null);}
 }
 return Object.freeze({login,logout});
}
