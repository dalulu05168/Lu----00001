import {getClientAppMirror,listClientMirrorAudit,getClientMirrorSetupStatus,purchaseForMirrorClient} from "./admin-mirror.mjs";
import {getAdminClientAnalytics} from "./admin-client-analytics.mjs";
import {getClientPolicy,changeClientPolicy,listClientPolicyAudit} from "./client-admin-policies.mjs";
import {listAdminRequests,reviewAdminRequest,listAdminWorkflowAudit,listAdminClientHistoryPage} from "./operational-workflows.mjs";
import {getSubadminPolicy,changeSubadminLogin,listSubadminControlAudit} from "./admin-subaccount-policies.mjs";
import {listCommodityProducts,createCommodityProduct,updateCommodityProduct,commodityProductAudit} from "./commodity-products.mjs";
import {listAdminSupportThreads,getAdminSupportThread,sendAdminSupportMessage,changeAdminSupportStatus} from "./support-messages.mjs";
import {listUnifiedAudit} from "./operation-audit.mjs";
import {listPublishedInternalProducts,readAdminProductTerms,updateAdminProductTerms} from './internal-products.mjs';
import {lookupStocks} from './stock-lookup.mjs';
import {setStockPositionLock} from './stock-position-locks.mjs';
import {getUsStockHistory,stockQuotesConfigured} from './us-stock-quotes.mjs';
import {readPrivateData} from './private-customer-data.mjs';
import {createAuthRateLimiter,clientAddress,normalizedEmailKey,sendRateLimited} from "./auth-rate-limit.mjs";
import {
  roleFor,bootstrapMaster,recoverPendingMaster,adminLogin,verifyAdminTotp,createSubadmin,
  listSubadmins,listClients,createListing,listListings,updateListing
} from "./admin-service.mjs";
function response(res,status,value){
  res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
  res.end(JSON.stringify(value));
}
async function input(req){
  if(req.body!==undefined){
    const value=typeof req.body==="string"?req.body:Buffer.isBuffer(req.body)?
      req.body.toString("utf8"):JSON.stringify(req.body);
    if(Buffer.byteLength(value)>8192)throw Object.assign(new Error("Request too large"),{statusCode:413});
    return JSON.parse(value);
  }
  const chunks=[];let length=0;
  for await(const chunk of req){
    const bytes=Buffer.from(chunk);length+=bytes.length;
    if(length>8192)throw Object.assign(new Error("Request too large"),{statusCode:413});
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function safeError(error){
  if(error?.statusCode===413)return {status:413,error:"Request too large"};
  if(error instanceof SyntaxError)return {status:400,error:"Invalid JSON"};
  if(error?.statusCode===401)return {status:401,error:"Invalid admin credentials"};
  if(error?.statusCode===400)return {status:400,error:error.message};
  if(error?.statusCode===404)return {status:404,error:"Record not found"};
  if(error?.statusCode===403)return {status:403,error:error.code==="PARTICIPATION_PASSWORD_INCORRECT"
    ?"Participation password is incorrect":"Master permission required"};
  if(error?.statusCode===409)return {status:409,error:error.message};
  if(error?.statusCode===429)return {status:429,error:error.message};
  if(error?.statusCode===503)return {status:503,error:error.message==="Mirror audit schema not installed"
    ?"Mirror audit schema not installed":"Account policies unavailable"};
  if(error?.code==="23505")return {status:409,error:"Record already exists"};
  return {status:500,error:"Internal server error"};
}
const sharedAuthLimiter=createAuthRateLimiter();
export async function handleAdminApi(req,res,route,db,resolveSession,getStockQuote,authLimiter=sharedAuthLimiter){
  if(!route.startsWith("/api/admin/")&&route!=="/api/catalog")return false;
  const allowed={
    "/api/admin/login":["POST"],"/api/admin/totp/verify":["POST"],"/api/admin/bootstrap":["POST"],
    "/api/admin/recover-pending-master":["POST"],"/api/admin/logout":["POST"],"/api/admin/me":["GET"],
    "/api/admin/subaccounts":["GET","POST"],"/api/admin/clients":["GET"],
    "/api/admin/subaccount-controls":["GET","PATCH"],"/api/admin/subaccount-control-audit":["GET"],
    "/api/admin/client-controls":["GET","PATCH"],"/api/admin/client-control-audit":["GET"],
    "/api/admin/workflow-requests":["GET","PATCH"],"/api/admin/workflow-audit":["GET"],
    "/api/admin/client-history":["GET"],
    "/api/admin/client-analytics":["GET"],
    "/api/admin/mirror":["GET"],"/api/admin/mirror-audit":["GET"],"/api/admin/mirror-status":["GET"],
    "/api/admin/mirror-purchases":["GET","POST"],
    "/api/admin/stock-position-lock":["PATCH"],
    "/api/admin/stock-quote":["GET"],
    "/api/admin/stock-history":["GET"],
    "/api/admin/listings":["GET","POST","PATCH"],"/api/admin/stock-lookup":["GET"],"/api/catalog":["GET"],
    "/api/admin/commodities":["GET","POST","PATCH"],"/api/admin/commodity-audit":["GET"],
    "/api/admin/support":["GET","POST","PATCH"],"/api/admin/support-thread":["GET"],
    "/api/admin/audit-events":["GET"]
    ,"/api/admin/product-terms":["GET","PATCH"]
    ,"/api/admin/private-data":["GET"]
  };
  if(!allowed[route]){response(res,404,{error:"Not found"});return true;}
  if(!allowed[route].includes(req.method)){response(res,405,{error:"Method not allowed"});return true;}
  try{
    if(["/api/admin/login","/api/admin/totp/verify","/api/admin/bootstrap","/api/admin/recover-pending-master"].includes(route)){
      const ip=clientAddress(req);
      const data=await input(req);
      const emailKey=route==="/api/admin/login"?normalizedEmailKey("admin",data?.email):null;
      const wait=authLimiter.blocked([["ipFailures",ip],["accountFailures",emailKey]]);
      if(wait){sendRateLimited(res,wait);return true;}
      try{
        if(route==="/api/admin/login"){
          const login=await adminLogin(db,data);
          authLimiter.reset("accountFailures",emailKey);
          response(res,200,login);return true;
        }
        if(route==="/api/admin/totp/verify"){
          const verified=await verifyAdminTotp(db,data);
          authLimiter.reset("ipFailures",ip);
          response(res,200,verified);return true;
        }
        if(route==="/api/admin/bootstrap"){response(res,201,await bootstrapMaster(db,data));return true;}
        response(res,200,await recoverPendingMaster(db,data));return true;
      }catch(error){
        // Count wrong passwords and wrong setup proofs; malformed input is not a guess.
        if(error?.statusCode===401||error?.message==="Invalid setup proof")
          authLimiter.record([["ipFailures",ip],["accountFailures",emailKey]]);
        throw error;
      }
    }
    const authorization=req.headers.authorization??"";
    if(!authorization.startsWith("Bearer ")){
      response(res,401,{error:"Authentication required"});return true;
    }
    const session=await resolveSession(authorization.slice(7));
    if(!session?.userId){response(res,401,{error:"Authentication required"});return true;}
    if(route==="/api/admin/logout"){
      const {revokeSession}=await import("./auth.mjs");
      await revokeSession(db,authorization.slice(7));
      response(res,204,{});return true;
    }
    if(route==="/api/catalog"){
      const data=await db.query(`SELECT id,item_type,market,symbol,display_name
        FROM listings WHERE status='PUBLISHED' ORDER BY created_at DESC LIMIT 100`);
      response(res,200,{items:data.rows.map(x=>({
        id:x.id,itemType:x.item_type,market:x.market,symbol:x.symbol,name:x.display_name
      }))});return true;
    }
    const actor=await roleFor(db,session);
    if(!actor){response(res,403,{error:"Administrator session required"});return true;}
    if(route==="/api/admin/stock-history"){
      const url=new URL(req.url??"/","http://localhost");
      try{response(res,200,await getUsStockHistory(url.searchParams.get("symbol")));}
      catch{response(res,503,{error:"US stock history unavailable"});}
      return true;
    }
    if(route==="/api/admin/stock-quote"){
      if(actor.role!=="MASTER"){response(res,403,{error:"Master permission required"});return true;}
      const url=new URL(req.url??"/","http://localhost");
      try{response(res,200,await getStockQuote({market:url.searchParams.get("market"),symbol:url.searchParams.get("symbol")}));}
      catch{response(res,503,{error:"Verified US stock quote unavailable"});}
      return true;
    }
    if(route==="/api/admin/stock-position-lock"){
      response(res,200,{item:await setStockPositionLock(db,actor,await input(req))});return true;
    }
    if(route==="/api/admin/mirror-purchases"){
      if(actor.role!=="MASTER"){response(res,403,{error:"Master permission required"});return true;}
      if(req.method==="GET")response(res,200,{items:await listPublishedInternalProducts(db),stockQuotesConfigured:stockQuotesConfigured()});
      else{
        const result=await purchaseForMirrorClient(db,actor,req.headers["idempotency-key"],await input(req),getStockQuote);
        response(res,result.replayed?200:201,{id:result.purchase.id,replayed:result.replayed});
      }
      return true;
    }
    if(route==="/api/admin/stock-lookup"){
      if(actor.role!=="MASTER"){response(res,403,{error:"Master permission required"});return true;}
      const url=new URL(req.url??"/","http://localhost");
      response(res,200,await lookupStocks(db,url.searchParams.get("code")));return true;
    }
    if(route==='/api/admin/private-data'){
     const url=new URL(req.url??'/','http://localhost'),kind=url.searchParams.get('kind');
     response(res,200,{kind,payload:await readPrivateData(db,actor,kind,url.searchParams.get('id'))});return true;
    }
    if(route==='/api/admin/product-terms'){
      const url=new URL(req.url??'/','http://localhost');
      response(res,200,{item:req.method==='GET'?await readAdminProductTerms(db,actor,url.searchParams.get('kind'),url.searchParams.get('id')):await updateAdminProductTerms(db,actor,await input(req))});return true;
    }
    if(route==="/api/admin/me"){response(res,200,{role:actor.role,userId:actor.userId});return true;}
    if(route==="/api/admin/subaccounts"){
      if(req.method==="POST"){
        if(actor.role!=="MASTER"){response(res,403,{error:"Master permission required"});return true;}
        response(res,201,await createSubadmin(db,actor,await input(req)));return true;
      }
      response(res,200,{items:await listSubadmins(db,actor)});return true;
    }
    if(route==="/api/admin/subaccount-controls"){
      if(req.method==="PATCH"){
        if(actor.role!=="MASTER"){response(res,403,{error:"Master permission required"});return true;}
        response(res,200,{policy:await changeSubadminLogin(db,actor,await input(req))});return true;
      }
      const url=new URL(req.url??"/","http://localhost");
      response(res,200,{policy:await getSubadminPolicy(db,actor,url.searchParams.get("userId"))});return true;
    }
    if(route==="/api/admin/subaccount-control-audit"){
      const url=new URL(req.url??"/","http://localhost");
      response(res,200,{items:await listSubadminControlAudit(db,actor,url.searchParams.get("userId"))});return true;
    }
    if(route==="/api/admin/mirror-status"){
      response(res,200,await getClientMirrorSetupStatus(db,actor));return true;
    }
    if(route==="/api/admin/mirror"){
      const url=new URL(req.url??"/","http://localhost");
      response(res,200,await getClientAppMirror(db,actor,url.searchParams.get("clientId")));return true;
    }
    if(route==="/api/admin/mirror-audit"){
      response(res,200,{items:await listClientMirrorAudit(db,actor)});return true;
    }
    if(route==="/api/admin/clients"){
      response(res,200,{items:await listClients(db,actor)});return true;
    }
    if(route==="/api/admin/client-controls"){
      if(req.method==="PATCH"){
        if(actor.role!=="MASTER"){response(res,403,{error:"Master permission required"});return true;}
        response(res,200,{policy:await changeClientPolicy(db,actor,await input(req))});return true;
      }
      const url=new URL(req.url??"/","http://localhost");
      response(res,200,{policy:await getClientPolicy(db,actor,url.searchParams.get("clientId"))});return true;
    }
    if(route==="/api/admin/client-control-audit"){
      const url=new URL(req.url??"/","http://localhost");
      response(res,200,{items:await listClientPolicyAudit(db,actor,url.searchParams.get("clientId"))});return true;
    }
    if(route==="/api/admin/workflow-requests"){
      if(req.method==="PATCH"){
        const data=await input(req);
        response(res,200,{item:await reviewAdminRequest(db,actor,data.category,{
          id:data.id,expectedStatus:data.expectedStatus,status:data.status,reason:data.reason
        })});return true;
      }
      const url=new URL(req.url??"/","http://localhost");
      response(res,200,{items:await listAdminRequests(db,actor,url.searchParams.get("category"),url.searchParams.get("clientId"))});return true;
    }
    if(route==="/api/admin/client-analytics"){
      const url=new URL(req.url??"/","http://localhost");
      response(res,200,await getAdminClientAnalytics(db,actor,url.searchParams.get("clientId")));return true;
    }
    if(route==="/api/admin/client-history"){
      const url=new URL(req.url??"/","http://localhost");
      const rawLimit=url.searchParams.get("limit");
      const limit=rawLimit===null?20:Number(rawLimit);
      response(res,200,await listAdminClientHistoryPage(db,actor,
        url.searchParams.get("clientId"),{cursor:url.searchParams.get("cursor"),limit}));return true;
    }
    if(route==="/api/admin/workflow-audit"){
      const url=new URL(req.url??"/","http://localhost");
      response(res,200,{items:await listAdminWorkflowAudit(db,actor,url.searchParams.get("clientId"))});return true;
    }
    if(route==="/api/admin/commodities"){
      if(req.method==="POST"){response(res,201,{item:await createCommodityProduct(db,actor,await input(req))});return true;}
      if(req.method==="PATCH"){response(res,200,{item:await updateCommodityProduct(db,actor,await input(req))});return true;}
      response(res,200,await listCommodityProducts(db,actor));return true;
    }
    if(route==="/api/admin/commodity-audit"){
      const url=new URL(req.url??"/","http://localhost");
      response(res,200,await commodityProductAudit(db,actor,url.searchParams.get("id")));return true;
    }
    if(route==="/api/admin/audit-events"){
      const url=new URL(req.url??"/","http://localhost");
      const raw=url.searchParams.get("limit");
      const limit=raw===null?100:Number(raw);
      response(res,200,await listUnifiedAudit(db,actor,{limit}));return true;
    }
    if(route==="/api/admin/support"){
      if(req.method==="POST"){response(res,201,await sendAdminSupportMessage(db,actor,await input(req)));return true;}
      if(req.method==="PATCH"){response(res,200,await changeAdminSupportStatus(db,actor,await input(req)));return true;}
      response(res,200,await listAdminSupportThreads(db,actor));return true;
    }
    if(route==="/api/admin/support-thread"){
      const url=new URL(req.url??"/","http://localhost");
      response(res,200,await getAdminSupportThread(db,actor,url.searchParams.get("threadId")));return true;
    }
    if(route==="/api/admin/listings"){
      if(req.method!=="GET"&&actor.role!=="MASTER"){
        response(res,403,{error:"Master permission required"});return true;
      }
      if(req.method==="POST"){response(res,201,await createListing(db,actor,await input(req)));return true;}
      if(req.method==="PATCH"){response(res,200,await updateListing(db,actor,await input(req)));return true;}
      response(res,200,{items:await listListings(db,actor)});return true;
    }
  }catch(error){
    const result=safeError(error);
    response(res,result.status,{error:result.error});return true;
  }
  response(res,404,{error:"Not found"});return true;
}
