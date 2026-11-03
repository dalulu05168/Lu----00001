import {verifyPassword} from "./auth.mjs";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS=Object.freeze({
  loginAllowed:"login_allowed",
  withdrawalRequestsAllowed:"withdrawal_requests_allowed",
  loanRequestsAllowed:"loan_requests_allowed",
  vipTier:"vip_tier",
  accountClass:"account_class"
});
const VIP=new Set(["STANDARD","SILVER","GOLD","PLATINUM"]);
const CLASS=new Set(["SIMULATED","REAL_PENDING","INTERNAL"]);

function fail(message,statusCode=400){
  throw Object.assign(new Error(message),{statusCode});
}
function checkClientId(value){
  if(typeof value!=="string"||!UUID.test(value))fail("Invalid client ID");
  return value;
}
function checkActor(actor){
  if(!actor||!["MASTER","SUBADMIN"].includes(actor.role)||!UUID.test(actor.userId))fail("Administrator authorization required",403);
}
function normalize(row){
  return {
    clientId:row.id||row.user_id,
    loginAllowed:row.login_allowed!==false,
    withdrawalRequestsAllowed:row.withdrawal_requests_allowed!==false,
    loanRequestsAllowed:row.loan_requests_allowed===true,
    vipTier:row.vip_tier||"STANDARD",
    accountClass:row.account_class||"SIMULATED",
    version:Number(row.version??0),
    updatedAt:row.updated_at||null
  };
}
function validValue(field,value){
  if(!Object.hasOwn(FIELDS,field))fail("Unsupported account policy field");
  if(["loginAllowed","withdrawalRequestsAllowed","loanRequestsAllowed"].includes(field)){
    if(typeof value!=="boolean")fail("Invalid account policy value");
  }else if(field==="vipTier"){
    if(!VIP.has(value))fail("Invalid VIP level");
  }else if(!CLASS.has(value))fail("Invalid account classification");
  return value;
}
async function accessibleClient(db,actor,clientId,lock=false){
  checkActor(actor);checkClientId(clientId);
  const sql="SELECT u.id,u.email,c.subadmin_user_id FROM app_users u "+
    "LEFT JOIN client_links c ON c.user_id=u.id "+
    "WHERE u.id=$1 AND NOT EXISTS(SELECT 1 FROM admin_roles a WHERE a.user_id=u.id) "+
    "AND ($2::text='MASTER' OR c.subadmin_user_id=$3::uuid) "+
    (lock?"FOR UPDATE OF u":"");
  const result=await db.query(sql,[clientId,actor.role,actor.userId]);
  if(result.rows.length!==1)fail("Client not found",404);
  return result.rows[0];
}

/** Scopes reads to master or assigned subadmin; missing rows mean safe defaults. */
export async function getClientPolicy(db,actor,clientId){
  const client=await accessibleClient(db,actor,clientId);
  const r=await db.query("SELECT * FROM client_admin_policies WHERE user_id=$1",[clientId]);
  return {...normalize({id:clientId,...r.rows[0]}),email:client.email,subadminUserId:client.subadmin_user_id??null};
}

/** Returns only audit entries for an actor-authorized customer, no passwords or session tokens. */
export async function listClientPolicyAudit(db,actor,clientId){
  await accessibleClient(db,actor,clientId);
  const r=await db.query("SELECT id,actor_user_id,client_user_id,field_name,old_value,new_value,reason,recorded_at "+
    "FROM client_policy_audit WHERE client_user_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT 100",[clientId]);
  return r.rows.map(x=>({
    id:x.id,actorUserId:x.actor_user_id,clientId:x.client_user_id,field:x.field_name,
    previousValue:x.old_value,nextValue:x.new_value,reason:x.reason,recordedAt:x.recorded_at
  }));
}

/**
 * MASTER-only mutation, with password re-authentication, stale-write protection,
 * row locking, and immutable before/after audit. Never changes money or orders.
 */
export async function changeClientPolicy(db,actor,data){
  checkActor(actor);
  if(actor.role!=="MASTER")fail("Master permission required",403);
  if(!data||typeof data!=="object"||Array.isArray(data)||
      Object.keys(data).some(k=>!["clientId","field","value","reason","confirmPassword","expectedVersion"].includes(k)))
    fail("Invalid client policy request");
  const {clientId,field,value,reason,confirmPassword,expectedVersion}=data;
  checkClientId(clientId);validValue(field,value);
  const note=typeof reason==="string"?reason.trim():"";
  if(note.length<12||note.length>400)fail("A change reason of 12 to 400 characters is required");
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)fail("Invalid policy version");
  if(typeof confirmPassword!=="string"||confirmPassword.length<12||confirmPassword.length>1024)
    fail("Administrator confirmation required",401);
  const actorRow=await db.query("SELECT password_hash FROM app_users WHERE id=$1",[actor.userId]);
  if(actorRow.rows.length!==1||!(await verifyPassword(confirmPassword,actorRow.rows[0].password_hash)))
    fail("Administrator confirmation failed",401);

  const conn=await db.connect();
  let active=false;
  try{
    await conn.query("BEGIN");active=true;
    await accessibleClient(conn,actor,clientId,true);
    await conn.query("INSERT INTO client_admin_policies(user_id) VALUES($1) ON CONFLICT (user_id) DO NOTHING",[clientId]);
    const prior=await conn.query("SELECT * FROM client_admin_policies WHERE user_id=$1 FOR UPDATE",[clientId]);
    if(prior.rows.length!==1)fail("Client policy unavailable",503);
    const old=normalize({id:clientId,...prior.rows[0]});
    if(old.version!==expectedVersion)fail("Policy changed; refresh before updating",409);
    if(old[field]===value)fail("Policy value is already set",409);
    const column=FIELDS[field]; // strictly whitelisted SQL column
    const updated=await conn.query("UPDATE client_admin_policies SET "+column+"=$2,version=version+1,"+
      "updated_at=now(),updated_by=$3 WHERE user_id=$1 RETURNING *",[clientId,value,actor.userId]);
    await conn.query("INSERT INTO client_policy_audit(actor_user_id,client_user_id,field_name,old_value,new_value,reason) "+
      "VALUES($1,$2,$3,$4,$5,$6)",
      [actor.userId,clientId,field,String(old[field]),String(value),note]);
    if(field==="loginAllowed"&&value===false){
      await conn.query("UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",[clientId]);
    }
    await conn.query("COMMIT");active=false;
    return {...normalize({id:clientId,...updated.rows[0]}),changedField:field};
  }catch(error){
    if(active)await conn.query("ROLLBACK");
    throw error;
  }finally{conn.release();}
}
