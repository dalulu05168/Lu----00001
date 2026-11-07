import {handleMobileSession} from "./mobile-session.mjs";
import { isDatabaseReady } from "./readiness.mjs";
import {handleAdminApi} from "./admin-http.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { placeInternalOrder } from "./order-service.mjs";
import {registerAccount,loginAccount,logoutAccount,getAccountSnapshot} from "./account-service.mjs";
import {listWatchlist,addWatchlistItem,removeWatchlistItem} from "./watchlist-service.mjs";
import {submitClientRequest,listClientRequests} from "./operational-workflows.mjs";
import {listCommodityProducts} from "./commodity-products.mjs";
import {getCustomerSupport,sendCustomerSupportMessage} from "./support-messages.mjs";
import {getAccountAnalytics} from "./account-analytics.mjs";
import {listPublishedInternalProducts} from './internal-products.mjs';
import {buyInternalProduct,internalPurchaseAccount} from './internal-purchases.mjs';
import {getUsStockQuote,stockQuotesConfigured} from './us-stock-quotes.mjs';
import {sellInternalStock} from './internal-stock-sales.mjs';
import {privateDataKey,submitPrivateData,readPrivateData} from './private-customer-data.mjs';
import {createReferenceFx} from "./reference-fx.mjs";
import {settleDueFunds} from "./fund-maturities.mjs";
import {createAuthRateLimiter,clientAddress,normalizedEmailKey,sendRateLimited} from "./auth-rate-limit.mjs";

// Render serves this process directly, so vercel.json headers do not apply there.
// frame-ancestors blocks clickjacking without restricting scripts the pages load.
export const SECURITY_HEADERS=Object.freeze({
 "x-content-type-options":"nosniff",
 "x-frame-options":"DENY",
 "content-security-policy":"frame-ancestors 'none'",
 "referrer-policy":"strict-origin-when-cross-origin",
 "permissions-policy":"camera=(), microphone=(), geolocation=()"
});
function send(res,status,data){res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});res.end(status===204?undefined:JSON.stringify(data));}
async function readBody(req,maxBodyBytes){
 if(req.body!==undefined){
  const payload=typeof req.body==="string"?req.body:Buffer.isBuffer(req.body)?req.body.toString("utf8"):JSON.stringify(req.body);
  if(Buffer.byteLength(payload)>maxBodyBytes){const error=new Error("Request too large");error.statusCode=413;throw error;}
  return payload;
 }
 let payload="";
 for await(const chunk of req){
  payload+=chunk;
  if(Buffer.byteLength(payload)>maxBodyBytes){const error=new Error("Request too large");error.statusCode=413;throw error;}
 }
 return payload;
}
function errorStatus(message){return /Invalid|Account required|Order id required/.test(message)?400:/Insufficient|position|funds/.test(message)?409:/not found/i.test(message)?404:500;}
export function createApi({db,resolveSession,createId=randomUUID,resolveExecutionPrice,getStockQuote=getUsStockQuote,maxBodyBytes=8192,referenceFx=createReferenceFx(),authLimiter=createAuthRateLimiter()}){
 if(!db||typeof resolveSession!=="function")throw new Error("Missing dependencies");
 let privateUploads=0;
 return createServer(async(req,res)=>{
  if(typeof res.setHeader==="function")for(const [name,value] of Object.entries(SECURITY_HEADERS))res.setHeader(name,value);
  const url=new URL(req.url??"/","http://localhost");
  // A single Render web service hosts both branded entrances. Only the two
  // exact custom hostnames have distinct landing pages; preview URLs stay intact.
  const hostname=String(req.headers.host??"").toLowerCase().split(":")[0];
  const adminLanding=hostname==="admin.nuvexapro.com";
  if(req.method==="GET" && ["/","/index.html","/app.mjs","/stock-chart.mjs","/styles.css","/admin.html","/admin.mjs","/admin.css","/admin-cn-v3.css","/portal.css","/portal.mjs","/market-allocation.mjs","/favicon.svg","/cn-capital.png","/cn-logo.svg","/cn-login-logo.svg","/front-cn-v3.css","/front-cn-v4.css","/front-cn-v4.mjs","/mobile.html","/mobile.css","/mobile.mjs","/mobile-entry.mjs"].includes(url.pathname)){
   const mobileLanding=hostname==="m.nuvexapro.com";
   const file=(mobileLanding&&(url.pathname==="/"||url.pathname==="/index.html"))
     ?"mobile.html":(adminLanding&&(url.pathname==="/"||url.pathname==="/index.html"))
     ?"admin.html":url.pathname==="/"?"index.html":url.pathname.slice(1);
   try{const bytes=await readFile(new URL("../web/"+file,import.meta.url));res.writeHead(200,{"content-type":file.endsWith(".mjs")?"text/javascript; charset=utf-8":file.endsWith(".css")?"text/css; charset=utf-8":file.endsWith(".svg")?"image/svg+xml":file.endsWith(".png")?"image/png":"text/html; charset=utf-8","cache-control":"no-store"});res.end(bytes);return;}
   catch{return send(res,404,{error:"Not found"});}
  }
  if(["/health","/api/health"].includes(url.pathname)&&req.method==="GET")return send(res,200,{status:"alive",brokerConnected:false,pricingConnected:typeof resolveExecutionPrice==="function"});
  if(["/ready","/api/ready"].includes(url.pathname)&&req.method==="GET"){
   try{if(!await isDatabaseReady(db))return send(res,503,{status:"not_ready",database:"schema_missing",brokerConnected:false});return send(res,200,{status:"ready",database:"connected",brokerConnected:false});}
   catch{return send(res,503,{status:"not_ready",database:"unavailable",brokerConnected:false});}
  }
  const route=url.pathname;
  if(route==="/api/reference-fx"){
   if(req.method!=="GET")return send(res,405,{error:"Method not allowed"});
   try{return send(res,200,await referenceFx());}
   catch{return send(res,503,{error:"Reference FX unavailable"});}
  }
  if(route==="/api/auth/mobile-session")return handleMobileSession(req,res,db,resolveSession);
  if(await handleAdminApi(req,res,route,db,resolveSession,getStockQuote,authLimiter))return;
  const authPath=["/api/auth/register","/api/auth/login"].includes(route);
  const isAuthRoute=authPath&&req.method==="POST";
  if(authPath&&!isAuthRoute)return send(res,405,{error:"Method not allowed"});
  const isProtected=["/api/orders","/api/account","/api/account/analytics","/api/auth/logout","/api/watchlist","/api/requests","/api/commodities","/api/support","/api/internal-products","/api/internal-purchases","/api/stock-quote","/api/private-data","/api/private-data/status"].includes(route);
  if(!isAuthRoute&&!isProtected)return send(res,404,{error:"Not found"});
  if(route==="/api/orders"&&req.method!=="POST")return send(res,405,{error:"Method not allowed"});
  if(route==="/api/account"&&req.method!=="GET")return send(res,405,{error:"Method not allowed"});
  if(route==="/api/account/analytics"&&req.method!=="GET")return send(res,405,{error:"Method not allowed"});
  if(route==="/api/requests"&&!["GET","POST"].includes(req.method))return send(res,405,{error:"Method not allowed"});
  if(route==="/api/commodities"&&req.method!=="GET")return send(res,405,{error:"Method not allowed"});
  if(route==="/api/support"&&!["GET","POST"].includes(req.method))return send(res,405,{error:"Method not allowed"});
  if(route==="/api/watchlist"&&!["GET","POST","DELETE"].includes(req.method))return send(res,405,{error:"Method not allowed"});
  if(route==="/api/auth/logout"&&req.method!=="POST")return send(res,405,{error:"Method not allowed"});
  if(isAuthRoute){
   try{
    const payload=await readBody(req,maxBodyBytes);
    const body=JSON.parse(payload);
    if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some(k=>!["email","password","inviteCode"].includes(k)))return send(res,400,{error:"Invalid body"});
    const ip=clientAddress(req);
    if(route==="/api/auth/register"){
      // Throttle before password hashing so enrollment cannot be used to exhaust CPU
      // or to enumerate six-digit invitation codes.
      const wait=authLimiter.blocked([["registrations",ip],["ipFailures",ip]]);
      if(wait)return sendRateLimited(res,wait);
      authLimiter.record([["registrations",ip]]);
      let account;
      try{account=await registerAccount(db,{email:body.email,password:body.password,openingCashCents:0,inviteCode:body.inviteCode});}
      catch(err){if(err.message==="Invalid invitation code")authLimiter.record([["ipFailures",ip]]);throw err;}
      return send(res,201,{userId:account.userId,accountId:account.accountId});
    }
    const emailKey=normalizedEmailKey("client",body.email);
    const wait=authLimiter.blocked([["ipFailures",ip],["accountFailures",emailKey]]);
    if(wait)return sendRateLimited(res,wait);
    let login;
    try{login=await loginAccount(db,{email:body.email,password:body.password});}
    catch(err){if(err.message==="Invalid credentials")authLimiter.record([["ipFailures",ip],["accountFailures",emailKey]]);throw err;}
    authLimiter.reset("accountFailures",emailKey);
    return send(res,200,login);
   }catch(err){
    if(err.statusCode===413)return send(res,413,{error:"Request too large"});
    if(err instanceof SyntaxError)return send(res,400,{error:"Invalid JSON"});
    if(err.message==="Invalid credentials")return send(res,401,{error:"Invalid credentials"});
    if(/^Invalid /.test(err.message))return send(res,400,{error:err.message});
    if(err.code==="23505")return send(res,409,{error:"Account already exists"});
    return send(res,500,{error:"Internal server error"});
   }
  }
  const auth=req.headers.authorization??"";
  if(!auth.startsWith("Bearer "))return send(res,401,{error:"Authentication required"});
  let session;
  try{session=await resolveSession(auth.slice(7));}catch{return send(res,401,{error:"Authentication failed"});}
  if(!session?.accountId)return send(res,401,{error:"Authentication required"});
  if(session.adminVerified===true)return send(res,403,{error:"Use the administrator console"});
  if(req.method==="GET"&&["/api/account","/api/account/analytics","/api/internal-purchases"].includes(route)){
   // Best effort: a failed settlement stays due and is retried by the sweep or the next read.
   try{await settleDueFunds(db,{accountId:session.accountId});}catch{}
  }
  if(route==='/api/private-data/status'){
   if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
   try{privateDataKey();return send(res,200,{ready:true});}catch{return send(res,200,{ready:false});}
  }
  if(route==='/api/private-data'){
   if(!['GET','POST'].includes(req.method))return send(res,405,{error:'Method not allowed'});
   const upload=req.method==='POST';
   if(upload&&privateUploads>=2)return send(res,429,{error:'Private upload service busy; retry shortly'});
   if(upload)privateUploads++;
   try{
    const key=privateDataKey(),kind=url.searchParams.get('kind');
    if(!upload)return send(res,200,{kind,payload:await readPrivateData(db,{role:'CLIENT',userId:session.userId},kind,url.searchParams.get('id'),{key})});
    const body=JSON.parse(await readBody(req,6*1024*1024));
    return send(res,201,{item:await submitPrivateData(db,session.userId,kind,body,{key})});
   }catch(error){
    if(error instanceof SyntaxError)return send(res,400,{error:'Invalid JSON'});
    const status=[400,403,404,413,429].includes(error.statusCode)?error.statusCode:503;
    return send(res,status,{error:status===503?'Private data service unavailable':error.message});
   }finally{if(upload)privateUploads--;}
  }
  if(route==='/api/stock-quote'){
   if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
   try{return send(res,200,await getStockQuote({market:url.searchParams.get('market'),symbol:url.searchParams.get('symbol')}));}
   catch{return send(res,503,{error:'Verified US stock quote unavailable'});}
  }
  if(route==='/api/internal-products'||route==='/api/internal-purchases'){
   if((route==='/api/internal-products'&&req.method!=='GET')||(route==='/api/internal-purchases'&&!['GET','POST','PATCH'].includes(req.method)))return send(res,405,{error:'Method not allowed'});
   try{
    if(route==='/api/internal-products')return send(res,200,{items:await listPublishedInternalProducts(db),stockQuotesConfigured:stockQuotesConfigured()});
    if(req.method==='GET')return send(res,200,{...await internalPurchaseAccount(db,session.accountId),stockQuotesConfigured:stockQuotesConfigured()});
    if(req.method==='PATCH'){
      const result=await sellInternalStock(db,session.accountId,req.headers['idempotency-key'],
        JSON.parse(await readBody(req,maxBodyBytes)),{getStockQuote});
      return send(res,result.replayed?200:201,result);
    }
    const result=await buyInternalProduct(db,session.accountId,req.headers['idempotency-key'],JSON.parse(await readBody(req,maxBodyBytes)),undefined,{getStockQuote});
    return send(res,result.replayed?200:201,result);
   }catch(error){
    if(error instanceof SyntaxError)return send(res,400,{error:'Invalid JSON'});
    const status=[400,403,404,409,413,429,503].includes(error.statusCode)?error.statusCode:500;
    return send(res,status,{error:status===500?'Internal purchase service unavailable':error.message});
   }
  }
  if(route==="/api/commodities"){
   try{return send(res,200,await listCommodityProducts(db,null,{publishedOnly:true}));}
   catch{return send(res,500,{error:"Internal server error"});}
  }
  if(route==="/api/support"){
   try{
    if(req.method==="GET")return send(res,200,await getCustomerSupport(db,session.userId));
    const payload=JSON.parse(await readBody(req,maxBodyBytes));
    return send(res,201,await sendCustomerSupportMessage(db,session.userId,payload));
   }catch(err){
    if(err.statusCode===413)return send(res,413,{error:"Request too large"});
    if(err instanceof SyntaxError)return send(res,400,{error:"Invalid JSON"});
    if([400,403,404,409].includes(err.statusCode))return send(res,err.statusCode,{error:err.message});
    return send(res,500,{error:"Internal server error"});
   }
  }
  if(route==="/api/requests"){
   try{
    const category=url.searchParams.get("category");
    if(req.method==="GET")return send(res,200,{items:await listClientRequests(db,session.userId,category)});
    const body=JSON.parse(await readBody(req,maxBodyBytes));
    return send(res,201,{item:await submitClientRequest(db,session.userId,category,body)});
   }catch(err){
    if(err.statusCode===413)return send(res,413,{error:"Request too large"});
    if(err instanceof SyntaxError)return send(res,400,{error:"Invalid JSON"});
    if([400,403,404,409].includes(err.statusCode))return send(res,err.statusCode,{error:err.message});
    return send(res,500,{error:"Internal server error"});
   }
  }
  if(route==="/api/account/analytics"){
   try{return send(res,200,await getAccountAnalytics(db,session.accountId));}
   catch(error){return send(res,error.statusCode===404?404:503,{error:"Account analytics unavailable"});}
  }
  if(route==="/api/account"){
   try{return send(res,200,await getAccountSnapshot(db,session.accountId));}
   catch{return send(res,500,{error:"Internal server error"});}
  }
  if(route==="/api/watchlist"){
    try {
      if(req.method==="GET")return send(res,200,{items:await listWatchlist(db,session.accountId)});
      const body=JSON.parse(await readBody(req,maxBodyBytes));
      const item=req.method==="POST"
        ? await addWatchlistItem(db,session.accountId,body)
        : await removeWatchlistItem(db,session.accountId,body);
      return send(res,200,{item});
    } catch(err) {
      if(err.statusCode===413)return send(res,413,{error:"Request too large"});
      if(err instanceof SyntaxError)return send(res,400,{error:"Invalid JSON"});
      if(/^Invalid watchlist/.test(err.message??""))return send(res,400,{error:err.message});
      if(err.message==="Watchlist limit reached")return send(res,409,{error:err.message});
      return send(res,500,{error:"Internal server error"});
    }
  }
  if(route==="/api/auth/logout"){
   try{await logoutAccount(db,auth.slice(7));return send(res,204,{});}
   catch{return send(res,500,{error:"Internal server error"});}
  }
  const key=req.headers["idempotency-key"];
  if(typeof key!=="string"||key.length<8||key.length>128)return send(res,400,{error:"Invalid idempotency key"});
  try{
   const body=await readBody(req,maxBodyBytes);
   const data=JSON.parse(body);
   if(!data||typeof data!=="object"||Array.isArray(data))return send(res,400,{error:"Invalid body"});
   const allowed=["side","market","symbol","quantity"];
   if(Object.keys(data).some(k=>!allowed.includes(k)))return send(res,400,{error:"Unexpected fields"});
   // Do not trust a browser-supplied execution price or FX rate.
   // resolveExecutionPrice is the only source of truth for price/FX/timestamp;
   // when absent (no provider wired at all), fail closed instead of guessing.
   if(typeof resolveExecutionPrice!=="function")return send(res,503,{error:"Verified market pricing unavailable"});
   // Platform publication is distinct from exchange listing and trading eligibility.
   // IPO directory entries never become order-eligible merely by being published.
   const eligible=await db.query(`SELECT id FROM listings WHERE market=$1 AND symbol=$2
     AND status='PUBLISHED' AND item_type IN ('STOCK','FUND') LIMIT 1`,[data.market,data.symbol]);
   if(!eligible.rows.length)return send(res,409,{error:"Security not available for orders"});
   const verified=await resolveExecutionPrice({market:data.market,symbol:data.symbol,side:data.side,quantity:data.quantity});
   // Staleness is the provider's own responsibility (it knows its feed's real
   // cadence); a second, shorter window here previously duplicated and
   // disagreed with it. Only a basic sanity/clock-skew check stays here.
   if(!verified||!Number.isSafeInteger(verified.priceCents)||verified.priceCents<=0||
      !Number.isSafeInteger(verified.fxUsdMicros)||verified.fxUsdMicros<=0||
      !Number.isFinite(verified.timestampMs)||
      verified.timestampMs>Date.now()+5000)
      return send(res,503,{error:"Verified market pricing unavailable"});
   const result=await placeInternalOrder(db,session.accountId,key,{
     side:data.side,market:data.market,symbol:data.symbol,quantity:data.quantity,
     priceCents:verified.priceCents,fxUsdMicros:verified.fxUsdMicros
   },createId());
   return send(res,result.replayed?200:201,result);
  }catch(err){
   if(err.statusCode===413)return send(res,413,{error:"Request too large"});
   if(err instanceof SyntaxError)return send(res,400,{error:"Invalid JSON"});
   if(/quote|pricing|entitlement|instrument|FX rate/i.test(err.message??""))return send(res,503,{error:"Verified market pricing unavailable"});
   const status=errorStatus(err.message??"");
   return send(res,status,{error:status===500?"Internal server error":err.message});
  }
 });
}
// A production authentication adapter must validate signed sessions and account ownership.
// Never trust a client-provided account ID. No real broker order transport is present.
