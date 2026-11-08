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
    "/api/admin/listings":["GET","POST","PATCH"],"/api/admin/requests":["GET"],"/api/admin/messages":["GET","POST"],"/api/admin/mirror":["GET"],"/api/catalog":["GET"]
  };
  const requestMatch=route.match(/^\/api\/admin\/requests\/([0-9a-f-]+)$/i);
  const messageMatch=route.match(/^\/api\/admin\/messages\/([0-9a-f-]+)$/i);
  if(!allowed[route]&&!requestMatch&&!messageMatch){response(res,404,{error:"Not found"});return true;}
  if((requestMatch||messageMatch)&&req.method!=="PATCH"&&req.method!=="POST"){response(res,405,{error:"Method not allowed"});return true;}
  if(allowed[route]&&!allowed[route].includes(req.method)){response(res,405,{error:"Method not allowed"});return true;}
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
        FROM listings WHERE status='PUBLISHED' ORDER BY created_at DESC LIMIT 100`);
      response(res,200,{items:data.rows.map(x=>({
        id:x.id,itemType:x.item_type,market:x.market,symbol:x.symbol,name:x.display_name
      }))});return true;
    }
    const actor=await roleFor(db,session);
    if(!actor){response(res,403,{error:"Administrator 2FA session required"});return true;}
    if(route==="/api/admin/mirror"){
      const email=new URL(req.url,"http://localhost").searchParams.get("email")?.trim().toLowerCase();
      if(!email){response(res,400,{error:"Customer email required"});return true;}
      const u=await db.query(`SELECT a.id,u.email,a.cash_cents,a.base_currency FROM app_users u JOIN accounts a ON a.user_id=u.id WHERE u.email=$1`,[email]);
      if(!u.rows.length){response(res,404,{error:"Customer not found"});return true;}
      const account=u.rows[0];
      const [p,o,r,m]=await Promise.all([
        db.query("SELECT market,symbol,quantity FROM positions WHERE account_id=$1 AND quantity>0 ORDER BY market,symbol",[account.id]),
        db.query("SELECT id,market,symbol,side,quantity,price_cents,amount_usd_cents,created_at FROM orders WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100",[account.id]),
        db.query("SELECT id,request_type,amount_cents,payload,status,review_note,created_at,updated_at FROM customer_requests WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100",[account.id]),
        db.query("SELECT id,sender_role,body,created_at,read_at FROM support_messages WHERE account_id=$1 ORDER BY created_at ASC LIMIT 200",[account.id])
      ]);
      response(res,200,{mirror:true,customer:{email:account.email},account:{id:account.id,cashCents:Number(account.cash_cents),currency:account.base_currency},positions:p.rows,orders:o.rows,requests:r.rows,messages:m.rows});return true;
    }
    if(route==="/api/admin/requests"){
      const data=await db.query(`SELECT r.id,r.account_id,r.request_type,r.amount_cents,r.payload,r.status,r.review_note,r.created_at,r.updated_at,u.email FROM customer_requests r JOIN accounts a ON a.id=r.account_id JOIN app_users u ON u.id=a.user_id ORDER BY r.created_at DESC LIMIT 200`);
      response(res,200,{items:data.rows});return true;
    }
    if(requestMatch){
      const body=await input(req),status=String(body.status||"");
      if(!["APPROVED","REJECTED","CANCELLED"].includes(status)){response(res,400,{error:"Invalid status"});return true;}
      const q=await db.query(`SELECT id,account_id,request_type,amount_cents,status FROM customer_requests WHERE id=$1`,[requestMatch[1]]);
      if(!q.rows.length){response(res,404,{error:"Request not found"});return true;}
      if(q.rows[0].status!=="PENDING"){response(res,409,{error:"Request already reviewed"});return true;}
      await db.query(`UPDATE customer_requests SET status=$1,review_note=$2,reviewed_by=$3,updated_at=now() WHERE id=$4`,[status,body.note||null,actor.userId,requestMatch[1]]);
      if(status==="APPROVED"&&q.rows[0].request_type==="DEPOSIT"&&q.rows[0].amount_cents>0){
       const bal=await db.query("SELECT cash_cents FROM accounts WHERE id=$1",[q.rows[0].account_id]);
       const next=Number(bal.rows[0].cash_cents)+Number(q.rows[0].amount_cents);
       await db.query("UPDATE accounts SET cash_cents=$1 WHERE id=$2",[next,q.rows[0].account_id]);
       await db.query("INSERT INTO cash_ledger(account_id,delta_cents,balance_after_cents) VALUES($1,$2,$3)",[q.rows[0].account_id,q.rows[0].amount_cents,next]);
      }
      response(res,200,{ok:true,id:requestMatch[1],status});return true;
    }
    if(route==="/api/admin/messages"){
      const data=await db.query(`SELECT m.id,m.account_id,m.sender_role,m.body,m.created_at,m.read_at,u.email FROM support_messages m JOIN accounts a ON a.id=m.account_id JOIN app_users u ON u.id=a.user_id ORDER BY m.created_at ASC LIMIT 500`);
      response(res,200,{items:data.rows});return true;
    }
    if(messageMatch){
      const body=await input(req);
      if(typeof body.body!=="string"||!body.body.trim()){response(res,400,{error:"Invalid message"});return true;}
      const data=await db.query(`INSERT INTO support_messages(id,account_id,sender_role,body) VALUES(gen_random_uuid(),$1,'ADMIN',$2) RETURNING id,sender_role,body,created_at`,[messageMatch[1],body.body.trim()]);
      response(res,201,{item:data.rows[0]});return true;
    }
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
