import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { placeInternalOrder } from "./order-service.mjs";
import {registerAccount,loginAccount,logoutAccount,getAccountSnapshot} from "./account-service.mjs";

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
  if(req.method==="GET" && ["/","/index.html","/app.mjs","/styles.css"].includes(url.pathname)){
   const file=url.pathname==="/"?"index.html":url.pathname.slice(1);
   try{const bytes=await readFile(new URL("../web/"+file,import.meta.url));res.writeHead(200,{"content-type":file.endsWith(".mjs")?"text/javascript; charset=utf-8":file.endsWith(".css")?"text/css; charset=utf-8":"text/html; charset=utf-8","cache-control":"no-store"});res.end(bytes);return;}
   catch{return send(res,404,{error:"Not found"});}
  }
  if(url.pathname==="/health"&&req.method==="GET")return send(res,200,{status:"alive",brokerConnected:false,pricingConnected:typeof resolveExecutionPrice==="function"});
  if(url.pathname==="/ready"&&req.method==="GET"){
   try{await db.query("SELECT 1");return send(res,200,{status:"ready",database:"connected",brokerConnected:false});}
   catch{return send(res,503,{status:"not_ready",database:"unavailable",brokerConnected:false});}
  }
  const route=url.pathname;
  const authPath=["/api/auth/register","/api/auth/login"].includes(route);
  const isAuthRoute=authPath&&req.method==="POST";
  if(authPath&&!isAuthRoute)return send(res,405,{error:"Method not allowed"});
  const isProtected=["/api/orders","/api/account","/api/auth/logout"].includes(route);
  if(!isAuthRoute&&!isProtected)return send(res,404,{error:"Not found"});
  if(route==="/api/orders"&&req.method!=="POST")return send(res,405,{error:"Method not allowed"});
  if(route==="/api/account"&&req.method!=="GET")return send(res,405,{error:"Method not allowed"});
  if(route==="/api/auth/logout"&&req.method!=="POST")return send(res,405,{error:"Method not allowed"});
  if(isAuthRoute){
   try{
    const payload=await readBody(req,maxBodyBytes);
    const body=JSON.parse(payload);
    if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some(k=>!["email","password"].includes(k)))return send(res,400,{error:"Invalid body"});
    if(route==="/api/auth/register"){
      const account=await registerAccount(db,{email:body.email,password:body.password,openingCashCents:0});
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
   // Until a licensed read-only quote service and pricing policy are configured,
   // the HTTP endpoint is disabled instead of creating misleading orders.
   if(typeof resolveExecutionPrice!=="function")return send(res,503,{error:"Verified market pricing unavailable"});
   const verified=await resolveExecutionPrice({market:data.market,symbol:data.symbol,side:data.side,quantity:data.quantity});
   if(!verified||!Number.isSafeInteger(verified.priceCents)||verified.priceCents<=0||
      !Number.isSafeInteger(verified.fxUsdMicros)||verified.fxUsdMicros<=0||
      !Number.isFinite(verified.timestampMs)||Date.now()-verified.timestampMs>60000||
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
