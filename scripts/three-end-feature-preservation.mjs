#!/usr/bin/env node
// Issue #42 window 6: executable preservation contract, not a trading or release switch.
// This is for the historical QA functional baseline; cleaned Library UI requires a separate manifest.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateBaseUrl} from './three-end-readonly-gate.mjs';

const f=(surface,key,selector,method,path,readback,shape='object',source='html')=>Object.freeze({
 surface,key,selector,method,path,readback,shape,source,
 failureStatuses:Object.freeze([401,403,503]),
 requiresDbEvidence:method!=='GET' && method!=='VIEW'
});

// Entries cover the native customer desktop, real mobile and every existing admin pane.
// Write methods are listed ONLY as coverage obligations; the runtime never sends them.
export const FEATURES=Object.freeze([
 f('desktop','register','#entryForm','POST','/api/auth/register','/api/account'),
 f('desktop','login','#entryForm','POST','/api/auth/login','/api/account','account'),
 f('desktop','logout','#logout','POST','/api/auth/logout','/api/account'),
 f('desktop','account','#accountCashValue','GET','/api/account','/api/account','account'),
 f('desktop','positions','#positions','GET','/api/account','/api/account','account'),
 f('desktop','orders','#transactionRows','GET','/api/account','/api/account','account'),
 f('desktop','performance','#realizedPnl','GET','/api/account/analytics','/api/account/analytics','analytics'),
 f('desktop','catalog','#catalogItems','GET','/api/catalog','/api/catalog','items'),
 f('desktop','stockQuote','#quotePrice','GET','/api/stock-quote?market=US&symbol=AAPL','/api/stock-quote?market=US&symbol=AAPL','quote'),
 f('desktop','referenceFx','#refreshReferenceFx','GET','/api/reference-fx','/api/reference-fx'),
 f('desktop','watchlist','#watchlistToggle','POST','/api/watchlist','/api/watchlist','items'),
 f('desktop','removeWatchlist','#savedWatchlist','DELETE','/api/watchlist','/api/watchlist','items'),
 f('desktop','buySell','#orderForm','POST','/api/orders','/api/account','account'),
 f('desktop','internalProducts','#internalProductsItems','GET','/api/internal-products','/api/internal-products','items'),
 f('desktop','internalPurchase','#internalProductsPanel','POST','/api/internal-purchases','/api/internal-purchases','ledger'),
 f('desktop','funding','#fundingRequestForm','POST','/api/requests?category=FUNDING','/api/requests?category=FUNDING','items'),
 f('desktop','kyc','#startKycRequest','POST','/api/requests?category=KYC','/api/requests?category=KYC','items'),
 f('desktop','privateData','#identityUploadForm','POST','/api/private-data?kind=KYC','/api/private-data/status'),
 f('desktop','bank','#bankLinkRequestForm','POST','/api/requests?category=BANK_LINK','/api/requests?category=BANK_LINK','items'),
 f('desktop','support','#customerSupportForm','POST','/api/support','/api/support','support'),
 f('mobile','home','[data-tab="home"]','GET','/api/account','/api/account','account'),
 f('mobile','market','[data-tab="market"]','GET','/api/stock-quote?market=US&symbol=AAPL','/api/stock-quote?market=US&symbol=AAPL','quote'),
 f('mobile','trade','[data-tab="trade"]','VIEW','/api/orders','/api/account','account'),
 f('mobile','orders','[data-tab="orders"]','GET','/api/account','/api/account','account'),
 f('mobile','account','[data-tab="account"]','GET','/api/account','/api/account','account'),
 f('mobile','refresh','#mobileRefresh','GET','/api/account','/api/account','account'),
 f('mobile','watchlist','[data-action="favorite"]','POST','/api/watchlist','/api/watchlist','items','module'),
 f('mobile','buySell','#mobileOrderForm','POST','/api/orders','/api/account','account','module'),
 f('mobile','funding','#mobileFundingForm','POST','/api/requests?category=FUNDING','/api/requests?category=FUNDING','items','module'),
 f('mobile','bank','#mobileBankForm','POST','/api/requests?category=BANK_LINK','/api/requests?category=BANK_LINK','items','module'),
 f('mobile','kyc','[data-action="kyc-request"]','POST','/api/requests?category=KYC','/api/requests?category=KYC','items','module'),
 f('mobile','support','#mobileSupportForm','POST','/api/support','/api/support','support','module'),
 f('mobile','products','#mobileProductForm','POST','/api/internal-purchases','/api/internal-purchases','ledger','module'),
 f('admin','login','#adminLoginForm','POST','/api/admin/login','/api/admin/me','admin'),
 f('admin','totp','#adminTotpForm','POST','/api/admin/totp/verify','/api/admin/me','admin'),
 f('admin','dashboard','[data-pane="dashboard"]','GET','/api/admin/clients','/api/admin/clients','items'),
 f('admin','accounts','[data-pane="accounts"]','GET','/api/admin/subaccounts','/api/admin/subaccounts','items'),
 f('admin','clients','[data-pane="clients"]','GET','/api/admin/clients','/api/admin/clients','items'),
 f('admin','mirror','[data-pane="mirror"]','GET','/api/admin/mirror-status','/api/admin/mirror-status'),
 f('admin','catalog','[data-pane="catalog"]','GET','/api/admin/listings','/api/admin/listings','items'),
 f('admin','commodities','[data-pane="commodities"]','GET','/api/admin/commodities','/api/admin/commodities'),
 f('admin','approvals','[data-pane="approvals"]','GET','/api/admin/workflow-requests?category=FUNDING','/api/admin/workflow-requests?category=FUNDING','items'),
 f('admin','treasury','[data-pane="treasury"]','GET','/api/admin/workflow-requests?category=FUNDING','/api/admin/workflow-requests?category=FUNDING','items'),
 f('admin','support','[data-pane="support"]','GET','/api/admin/support','/api/admin/support'),
 f('admin','audit','[data-pane="audit"]','GET','/api/admin/audit-events','/api/admin/audit-events'),
 f('admin','subadminInvite','#subadminForm','POST','/api/admin/subaccounts','/api/admin/subaccounts','items'),
 f('admin','subadminPolicy','#subadminPolicyForm','PATCH','/api/admin/subaccount-controls','/api/admin/subaccount-controls?userId={userId}'),
 f('admin','clientPolicy','#clientPolicyForm','PATCH','/api/admin/client-controls','/api/admin/client-controls?clientId={clientId}'),
 f('admin','fundApproval','#workflowReviewForm','PATCH','/api/admin/workflow-requests','/api/admin/workflow-requests?category=FUNDING','items'),
 f('admin','listingEdit','#listingForm','POST','/api/admin/listings','/api/admin/listings','items'),
 f('admin','commodityEdit','#commodityForm','POST','/api/admin/commodities','/api/admin/commodities'),
 f('admin','supportReply','#supportReplyForm','POST','/api/admin/support','/api/admin/support'),
 f('admin','customerPrivateData','#privateDataDialog','GET','/api/admin/private-data?kind=KYC&id={clientId}','/api/admin/private-data?kind=KYC&id={clientId}'),
 f('admin','productTerms','#productTermsForm','PATCH','/api/admin/product-terms','/api/admin/product-terms?kind=STOCK&id={productId}'),
 f('admin','mirrorAudit','#refreshMirrorAudit','GET','/api/admin/mirror-audit','/api/admin/mirror-audit','items')
]);

const files=Object.freeze({desktop:['web/index.html','web/app.mjs'],mobile:['web/mobile.html','web/mobile.mjs'],admin:['web/admin.html','web/admin.mjs']});
const codeFile=surface=>surface==='admin'?'src/admin-http.mjs':'src/http-api.mjs';
const stripQuery=path=>path.split('?')[0];
export function coverageSummary(){
 const bySurface={desktop:0,mobile:0,admin:0};
 for(const feature of FEATURES)bySurface[feature.surface]++;
 return {total:FEATURES.length,bySurface,adminPanes:FEATURES.filter(x=>x.surface==='admin'&&
   ['dashboard','accounts','clients','mirror','catalog','commodities','approvals','treasury','support','audit'].includes(x.key)).map(x=>x.key),
   mutationObligations:FEATURES.filter(x=>x.requiresDbEvidence).length};
}

export function checkSourceBinding(feature,{html,module,server}){
 const match=feature.selector.match(/^#([\w-]+)$/);
 const selectorText=match?'id="'+match[1]+'"':feature.selector.slice(1,-1);
 const source=feature.source==='module'?module:html;
 const selectorFound=source.includes(selectorText) || (match?source.includes("id='"+match[1]+"'"):false) ||
   (feature.source==='module'&&feature.selector==='[data-action="kyc-request"]'&&
      source.includes('"kyc-request"')&&source.includes('data-action='));
 // This is a source-level route-preservation guard, not proof of running the event listener.
 const routeFound=server.includes(stripQuery(feature.path)) && server.includes(stripQuery(feature.readback));
 return {surface:feature.surface,key:feature.key,selectorFound,routeFound,passed:selectorFound&&routeFound,
   writeExecuted:false,dbReadbackVerified:false};
}

export async function auditQaSourcePreservation({root=process.cwd(),readText=async p=>readFile(p,'utf8')}={}){
 const loaded={};
 for(const source of Object.values(files).flat().concat(['src/http-api.mjs','src/admin-http.mjs']))
   loaded[source]=await readText(resolve(root,source));
 const checks=FEATURES.map(feature=>checkSourceBinding(feature,{
   html:loaded[files[feature.surface][0]],module:loaded[files[feature.surface][1]],server:feature.surface==='admin'?loaded['src/admin-http.mjs']:(loaded['src/http-api.mjs']+'\n'+loaded['src/admin-http.mjs'])
 }));
 return {baseline:'historical QA only, NOT the final Library UI',checks,passed:checks.every(c=>c.passed),
   total:checks.length,passedCount:checks.filter(c=>c.passed).length};
}

// A 200 alone does not imply a posted fund, a filled order or an authenticated snapshot.
export function classifyReadback(httpStatus,data,shape='object'){
 if(httpStatus===401)return 'AUTH_REQUIRED';
 if(httpStatus===403)return 'FORBIDDEN';
 if(httpStatus===503)return 'UNAVAILABLE';
 if(httpStatus!==200)return 'FAIL';
 if(data===null||typeof data!=='object'||Array.isArray(data))return 'INVALID';
 if(shape==='account'){
   if(!data.account||!Number.isSafeInteger(data.account.cashCents)||data.account.cashCents<0||
      !Array.isArray(data.positions)||!Array.isArray(data.orders))return 'UNKNOWN';
   return data.account.cashCents!==0||data.positions.length||data.orders.length?'DATA':'EMPTY_CONFIRMED';
 }
 if(shape==='analytics'){
   if(data.historyAvailable!==true)return 'UNKNOWN';
   if(!Number.isSafeInteger(data.realizedPnlCents)||!Number.isSafeInteger(data.unrealizedPnlCents)||!Number.isSafeInteger(data.positionCostCents))return 'UNKNOWN';
   return 'DATA';
 }
 if(shape==='items')return !Array.isArray(data.items)?'UNKNOWN':data.items.length?'DATA':'EMPTY_CONFIRMED';
 if(shape==='ledger')return !Array.isArray(data.positions)||!Array.isArray(data.purchases)||
      !Array.isArray(data.sales)?'UNKNOWN':data.positions.length||data.purchases.length||data.sales.length?'DATA':'EMPTY_CONFIRMED';
 if(shape==='quote')return Number.isSafeInteger(data.priceCents)&&data.priceCents>0&&
    ['US','CN'].includes(data.market)&&data.currency===(data.market==='US'?'USD':'CNY')&&
    typeof data.source==='string'&&data.source.trim()&&Number.isFinite(data.timestampMs)&&
    data.timestampMs<=Date.now()+5000&&Date.now()-data.timestampMs<=60000&&
    data.entitled===true&&data.stale!==true?'DATA':'UNKNOWN';
 if(shape==='admin')return ['MASTER','SUBADMIN'].includes(data.role)?'DATA':'UNKNOWN';
 if(shape==='support')return Array.isArray(data.messages)?(data.messages.length?'DATA':'EMPTY_CONFIRMED'):'UNKNOWN';
 return 'STRUCTURE_ONLY';
}

// Only the read-after-write obligations are probed, and only as GETs. Mutations are NEVER dispatched.
// For remote QA, approval of a read-only test and HTTPS are compulsory.
export async function probeReadbackMatrix({baseUrl,clientToken,adminToken,remoteReadonly=false,
  authorizedRemoteQa=false,fetchImpl=fetch,timeoutMs=7000}={}){
 const origin=validateBaseUrl(baseUrl,{remoteReadonly});
 const url=new URL(origin);
 if(remoteReadonly&&(!authorizedRemoteQa||url.protocol!=='https:'))throw Error('Remote QA must be explicitly authorized and HTTPS');
 const getList=new Map();
 for(const feature of FEATURES){
  if(feature.method==='VIEW')continue;
  const path=feature.readback;
  const shape=path==='/api/account'?'account':path==='/api/account/analytics'?'analytics':
    path.startsWith('/api/stock-quote?')?'quote':path.startsWith('/api/admin/me')?'admin':
    path==='/api/internal-purchases'?'ledger':feature.shape;
  if(!getList.has(feature.surface+'|'+path))getList.set(feature.surface+'|'+path,{surface:feature.surface,path,shape});
 }
 const results=[];
 for(const {surface,path,shape} of getList.values()){
  const role=surface==='admin'?'admin':'client';
  const token=role==='admin'?adminToken:clientToken;
  if(path.includes('{')){results.push({surface,path,status:'BLOCKED_CONTEXT'});continue;}
  if(typeof token!=='string'||!token.trim()){results.push({surface,path,status:'BLOCKED_AUTH'});continue;}
  try {
   const response=await fetchImpl(origin+path,{method:'GET',redirect:'manual',cache:'no-store',
      headers:{accept:'application/json',authorization:'Bearer '+token},signal:AbortSignal.timeout(timeoutMs)});
   const ct=String(response.headers?.get('content-type')||'');
   if(response.status===200&&!ct.includes('application/json')){
      results.push({surface,path,status:'INVALID'});continue;
   }
   let data=null;
   if(response.status===200){try{data=await response.json();}catch{}}
   results.push({surface,path,status:classifyReadback(response.status,data,shape)});
  }catch(error){results.push({surface,path,status:'NETWORK_FAILED',reason:error?.name||'NetworkError'});}
 }
 return {origin,mode:'GET-only',results,passed:false,
   note:'Read evidence cannot establish database persistence after mutations, trading entitlement, 2FA or final UI. No writes were made.'};
}

async function main(args){
 const rootFlag=args.indexOf('--qa-source-root');
 if(rootFlag!==-1){const result=await auditQaSourcePreservation({root:args[rootFlag+1]});
   console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;return;}
 const index=args.indexOf('--base-url');
 const result=await probeReadbackMatrix({baseUrl:index<0?undefined:args[index+1],
   clientToken:process.env.QA_CLIENT_TOKEN,adminToken:process.env.QA_ADMIN_TOKEN,
   remoteReadonly:args.includes('--remote-readonly'),authorizedRemoteQa:args.includes('--authorized-remote-qa')});
 console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
