import {getClientAppMirror,listClientMirrorAudit,getClientMirrorSetupStatus} from "./admin-mirror.mjs";
import {getClientPolicy,changeClientPolicy,listClientPolicyAudit} from "./client-admin-policies.mjs";
import {
  roleFor,bootstrapMaster,recoverPendingMaster,adminLogin,createSubadmin,
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
  if(error?.statusCode===404)return {status:404,error:"Client not found"};
  if(error?.statusCode===403)return {status:403,error:"Master permission required"};
  if(error?.statusCode===409)return {status:409,error:error.message};
  if(error?.statusCode===503)return {status:503,error:"Account policies unavailable"};
  if(error?.statusCode===503)return {status:503,error:"Mirror audit schema not installed"};
  if(error?.code==="23505")return {status:409,error:"Record already exists"};
  return {status:500,error:"Internal server error"};
}
export async function handleAdminApi(req,res,route,db,resolveSession){
  if(!route.startsWith("/api/admin/")&&route!=="/api/catalog")return false;
  const allowed={
    "/api/admin/login":["POST"],"/api/admin/bootstrap":["POST"],
    "/api/admin/recover-pending-master":["POST"],"/api/admin/logout":["POST"],"/api/admin/me":["GET"],
    "/api/admin/subaccounts":["GET","POST"],"/api/admin/clients":["GET"],
    "/api/admin/client-controls":["GET","PATCH"],"/api/admin/client-control-audit":["GET"],
    "/api/admin/mirror":["GET"],"/api/admin/mirror-audit":["GET"],"/api/admin/mirror-status":["GET"],
    "/api/admin/listings":["GET","POST","PATCH"],"/api/catalog":["GET"]
  };
  if(!allowed[route]){response(res,404,{error:"Not found"});return true;}
  if(!allowed[route].includes(req.method)){response(res,405,{error:"Method not allowed"});return true;}
  try{
    if(route==="/api/admin/login"){
      const data=await input(req);
      response(res,200,await adminLogin(db,data));return true;
    }
    if(route==="/api/admin/bootstrap"){
      const data=await input(req);
      response(res,201,await bootstrapMaster(db,data));return true;
    }
    if(route==="/api/admin/recover-pending-master"){
      response(res,200,await recoverPendingMaster(db,await input(req)));return true;
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
    if(route==="/api/admin/me"){response(res,200,{role:actor.role,userId:actor.userId});return true;}
    if(route==="/api/admin/subaccounts"){
      if(req.method==="POST"){
        if(actor.role!=="MASTER"){response(res,403,{error:"Master permission required"});return true;}
        response(res,201,await createSubadmin(db,actor,await input(req)));return true;
      }
      response(res,200,{items:await listSubadmins(db,actor)});return true;
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
