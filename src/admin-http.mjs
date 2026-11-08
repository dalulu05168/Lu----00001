import {
  roleFor,bootstrapMaster,confirmAdminTotp,adminLogin,createSubadmin,
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
  if(error?.statusCode===429)return {status:429,error:"Too many attempts; try again later"};
  if(error instanceof SyntaxError)return {status:400,error:"Invalid JSON"};
  if(error?.statusCode===401)return {status:401,error:"Invalid admin credentials"};
  if(error?.statusCode===400)return {status:400,error:error.message};
  if(error?.code==="23505")return {status:409,error:"Record already exists"};
  return {status:500,error:"Internal server error"};
}
export async function handleAdminApi(req,res,route,db,resolveSession){
  if(!route.startsWith("/api/admin/")&&route!=="/api/catalog")return false;
  const allowed={
    "/api/admin/login":["POST"],"/api/admin/bootstrap":["POST"],
    "/api/admin/activate":["POST"],"/api/admin/me":["GET"],
    "/api/admin/subaccounts":["GET","POST"],"/api/admin/clients":["GET"],
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
    if(route==="/api/admin/activate"){
      const data=await input(req);
      response(res,200,await confirmAdminTotp(db,data));return true;
    }
    const authorization=req.headers.authorization??"";
    if(!authorization.startsWith("Bearer ")){
      response(res,401,{error:"Authentication required"});return true;
    }
    const session=await resolveSession(authorization.slice(7));
    if(!session?.userId){response(res,401,{error:"Authentication required"});return true;}
    if(route==="/api/catalog"){
      const data=await db.query(`SELECT id,item_type,market,symbol,display_name
        FROM listings WHERE status='PUBLISHED' AND market IN ('US','CN') ORDER BY created_at DESC LIMIT 100`);
      response(res,200,{items:data.rows.map(x=>({
        id:x.id,itemType:x.item_type,market:x.market,symbol:x.symbol,name:x.display_name
      }))});return true;
    }
    const actor=await roleFor(db,session);
    if(!actor){response(res,403,{error:"Administrator 2FA session required"});return true;}
    if(route==="/api/admin/me"){response(res,200,{role:actor.role,userId:actor.userId});return true;}
    if(route==="/api/admin/subaccounts"){
      if(req.method==="POST"){
        if(actor.role!=="MASTER"){response(res,403,{error:"Master permission required"});return true;}
        response(res,201,await createSubadmin(db,actor,await input(req)));return true;
      }
      response(res,200,{items:await listSubadmins(db,actor)});return true;
    }
    if(route==="/api/admin/clients"){
      response(res,200,{items:await listClients(db,actor)});return true;
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
