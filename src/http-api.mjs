import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { placeInternalOrder } from "./order-service.mjs";

function send(res,status,data){res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});res.end(JSON.stringify(data));}
function errorStatus(message){return /Invalid|Account required|Order id required/.test(message)?400:/Insufficient|position|funds/.test(message)?409:/not found/i.test(message)?404:500;}
function tokenMatches(supplied,expected){
 if(!supplied||!expected)return false;
 const a=Buffer.from(supplied),b=Buffer.from(expected);
 return a.length===b.length&&timingSafeEqual(a,b);
}
export function createApi({db,resolveSession,createId=randomUUID,maxBodyBytes=8192}){
 if(!db||typeof resolveSession!=="function")throw new Error("Missing dependencies");
 return createServer(async(req,res)=>{
  const url=new URL(req.url??"/","http://localhost");
  if(url.pathname==="/health"&&req.method==="GET")return send(res,200,{status:"ok",brokerConnected:false});
  if(url.pathname!=="/api/orders"||req.method!=="POST")return send(res,404,{error:"Not found"});
  const auth=req.headers.authorization??"";
  if(!auth.startsWith("Bearer "))return send(res,401,{error:"Authentication required"});
  let session;
  try{session=await resolveSession(auth.slice(7));}catch{return send(res,401,{error:"Authentication failed"});}
  if(!session?.accountId)return send(res,401,{error:"Authentication required"});
  const key=req.headers["idempotency-key"];
  if(typeof key!=="string"||key.length<8||key.length>128)return send(res,400,{error:"Invalid idempotency key"});
  let body="";
  try{
   for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>maxBodyBytes){send(res,413,{error:"Request too large"});req.destroy();return;}}
   const data=JSON.parse(body);
   if(!data||typeof data!=="object"||Array.isArray(data))return send(res,400,{error:"Invalid body"});
   const allowed=["side","market","symbol","quantity","priceCents","fxUsdMicros"];
   if(Object.keys(data).some(k=>!allowed.includes(k)))return send(res,400,{error:"Unexpected fields"});
   const result=await placeInternalOrder(db,session.accountId,key,data,createId());
   return send(res,result.replayed?200:201,result);
  }catch(err){
   if(err instanceof SyntaxError)return send(res,400,{error:"Invalid JSON"});
   const status=errorStatus(err.message??"");
   return send(res,status,{error:status===500?"Internal server error":err.message});
  }
 });
}
// A production authentication adapter must validate signed sessions and account ownership.
// Never trust a client-provided account ID. No real broker order transport is present.
