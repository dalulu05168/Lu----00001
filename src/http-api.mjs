import { isDatabaseReady } from "./readiness.mjs";
import {handleAdminApi} from "./admin-http.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { placeInternalOrder } from "./order-service.mjs";
import {registerAccount,loginAccount,logoutAccount,getAccountSnapshot} from "./account-service.mjs";
import {listWatchlist,addWatchlistItem,removeWatchlistItem} from "./watchlist-service.mjs";

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
export function createApi({db,resolveSession,createId=randomUUID,resolveExecutionPrice,maxBodyBytes=8192}){
 if(!db||typeof resolveSession!=="function")throw new Error("Missing dependencies");
 return createServer(async(req,res)=>{
  const url=new URL(req.url??"/","http://localhost");
  if(req.method==="GET" && ["/","/index.html","/admin.html","/mobile.html","/cn-terminal.html","/cn-admin.html"].includes(url.pathname)){
   const file=url.pathname==="/"?"index.html":url.pathname.slice(1);
   try{const bytes=await readFile(new URL("../web/"+file,import.meta.url));res.writeHead(200,{"content-type":file.endsWith(".mjs")?"text/javascript; charset=utf-8":file.endsWith(".css")?"text/css; charset=utf-8":"text/html; charset=utf-8","cache-control":"no-store"});res.end(bytes);return;}
   catch{return send(res,404,{error:"Not found"});}
  }
  if(["/health","/api/health"].includes(url.pathname)&&req.method==="GET")return send(res,200,{status:"alive",brokerConnected:false,pricingConnected:typeof resolveExecutionPrice==="function"});
  if(["/ready","/api/ready"].includes(url.pathname)&&req.method==="GET"){
   try{if(!await isDatabaseReady(db))return send(res,503,{status:"not_ready",database:"schema_missing",brokerConnected:false});return send(res,200,{status:"ready",database:"connected",brokerConnected:false});}
   catch{return send(res,503,{status:"not_ready",database:"unavailable",brokerConnected:false});}
  }
  const route=url.pathname;
  if(await handleAdminApi(req,res,route,db,resolveSession))return;
  const authPath=["/api/auth/register","/api/auth/login"].includes(route);
  const isAuthRoute=authPath&&req.method==="POST";
  if(authPath&&!isAuthRoute)return send(res,405,{error:"Method not allowed"});
  const isProtected=["/api/orders","/api/account","/api/auth/logout","/api/watchlist","/api/securities","/api/requests","/api/messages"].includes(route);
  if(!isAuthRoute&&!isProtected)return send(res,404,{error:"Not found"});
  if(route==="/api/orders"&&req.method!=="POST")return send(res,405,{error:"Method not allowed"});
  if(route==="/api/account"&&req.method!=="GET")return send(res,405,{error:"Method not allowed"});
  if(route==="/api/securities"&&req.method!=="GET")return send(res,405,{error:"Method not allowed"});
  if(route==="/api/requests"&&!['GET','POST'].includes(req.method))return send(res,405,{error:"Method not allowed"});
  if(route==="/api/messages"&&!['GET','POST'].includes(req.method))return send(res,405,{error:"Method not allowed"});
  if(route==="/api/watchlist"&&!["GET","POST","DELETE"].includes(req.method))return send(res,405,{error:"Method not allowed"});
  if(route==="/api/auth/logout"&&req.method!=="POST")return send(res,405,{error:"Method not allowed"});
  if(isAuthRoute){
   try{
    const payload=await readBody(req,maxBodyBytes);
    const body=JSON.parse(payload);
    if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some(k=>!["email","password","inviteCode"].includes(k)))return send(res,400,{error:"Invalid body"});
    if(route==="/api/auth/register"){
      const account=await registerAccount(db,{email:body.email,password:body.password,openingCashCents:0,inviteCode:body.inviteCode});
      return send(res,201,{userId:account.userId,accountId:account.accountId});
    }
    const login=await loginAccount(db,{email:body.email,password:body.password});
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
  if(route==="/api/account"){
   try{return send(res,200,await getAccountSnapshot(db,session.accountId));}
   catch{return send(res,500,{error:"Internal server error"});}
  }
  if(route==="/api/securities"){
   try{
    const result=await db.query(`SELECT item_type,market,symbol,display_name
      FROM listings WHERE status='PUBLISHED' ORDER BY created_at DESC LIMIT 100`);
    const sec={},names={};
    for(const row of result.rows){
      const symbol=String(row.symbol);
      names[symbol]=row.display_name||symbol;
      sec[symbol]={symbol,market:row.market,name:row.display_name||symbol,type:row.item_type};
    }
    return send(res,200,{sec,names,cfg:sec,name:names});
   }catch{return send(res,500,{error:"Internal server error"});}
  }
  if(route==="/api/requests"){
   try{
    if(req.method==="GET"){
     const r=await db.query(`SELECT id,request_type,amount_cents,payload,status,review_note,created_at,updated_at FROM customer_requests WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100`,[session.accountId]);
     return send(res,200,{items:r.rows});
    }
    const body=JSON.parse(await readBody(req,5*1024*1024));
    const types={"充值申请":"DEPOSIT","提现申请":"WITHDRAW","身份审核":"KYC","银行卡登记":"BANK"};
    const type=types[body.type]||body.type, amount=body.amount==null?null:Number(body.amount);
    if(!['DEPOSIT','WITHDRAW','KYC','BANK'].includes(type))return send(res,400,{error:"Invalid request type"});
    if(['DEPOSIT','WITHDRAW'].includes(type)&&(!Number.isFinite(amount)||amount<=0))return send(res,400,{error:"Invalid amount"});
    const payload={...body};delete payload.type;delete payload.amount;delete payload.accountId;
    const r=await db.query(`INSERT INTO customer_requests(id,account_id,request_type,amount_cents,payload) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING id,request_type,amount_cents,payload,status,created_at`,[randomUUID(),session.accountId,type,amount==null?null:Math.round(amount*100),JSON.stringify(payload)]);
    return send(res,201,{item:r.rows[0]});
   }catch(err){if(err.statusCode===413)return send(res,413,{error:"Request too large"});if(err instanceof SyntaxError)return send(res,400,{error:"Invalid JSON"});return send(res,500,{error:"Internal server error"});}
  }
  if(route==="/api/messages"){
   try{
    if(req.method==="GET"){
     const r=await db.query(`SELECT id,sender_role,body,created_at,read_at FROM support_messages WHERE account_id=$1 ORDER BY created_at ASC LIMIT 200`,[session.accountId]);
     return send(res,200,{items:r.rows});
    }
    const body=JSON.parse(await readBody(req,16384));
    if(typeof body.body!=="string"||!body.body.trim()||body.body.length>4000)return send(res,400,{error:"Invalid message"});
    const r=await db.query(`INSERT INTO support_messages(id,account_id,sender_role,body) VALUES($1,$2,'CLIENT',$3) RETURNING id,sender_role,body,created_at`,[randomUUID(),session.accountId,body.body.trim()]);
    return send(res,201,{item:r.rows[0]});
   }catch(err){if(err instanceof SyntaxError)return send(res,400,{error:"Invalid JSON"});return send(res,500,{error:"Internal server error"});}
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
   const allowed=["side","market","symbol","quantity","qty","tradePassword"];
   if(Object.keys(data).some(k=>!allowed.includes(k)))return send(res,400,{error:"Unexpected fields"});
   const side=data.side==="买入"?"BUY":data.side==="卖出"?"SELL":data.side;
   const quantity=data.quantity??data.qty;
   if(!["BUY","SELL"].includes(side)||!Number.isSafeInteger(quantity)||quantity<=0)
    return send(res,400,{error:"Invalid order fields"});
   // Do not trust a browser-supplied execution price or FX rate.
   // Until a licensed read-only quote service and pricing policy are configured,
   // the HTTP endpoint is disabled instead of creating misleading orders.
   if(typeof resolveExecutionPrice!=="function")return send(res,503,{error:"Verified market pricing unavailable"});
   const verified=await resolveExecutionPrice({market:data.market,symbol:data.symbol,side,quantity});
   if(!verified||!Number.isSafeInteger(verified.priceCents)||verified.priceCents<=0||
      !Number.isSafeInteger(verified.fxUsdMicros)||verified.fxUsdMicros<=0||
      !Number.isFinite(verified.timestampMs)||Date.now()-verified.timestampMs>60000||
      verified.timestampMs>Date.now()+5000)
      return send(res,503,{error:"Verified market pricing unavailable"});
   const result=await placeInternalOrder(db,session.accountId,key,{
     side,market:data.market,symbol:data.symbol,quantity,
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
