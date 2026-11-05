import {optionalReason} from "./optional-reason.mjs";
import {verifyPassword} from "./auth.mjs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function invalid(message,statusCode=400){throw Object.assign(new Error(message),{statusCode});}
function check(actor,subadminId){
 if(!actor||!["MASTER","SUBADMIN"].includes(actor.role)||!UUID.test(actor.userId))invalid("Invalid administrator",403);
 if(typeof subadminId!=="string"||!UUID.test(subadminId))invalid("Invalid subaccount ID");
}
async function permittedSubadmin(db,actor,subadminId,lock=false){
 check(actor,subadminId);
 const query="SELECT a.user_id,u.email,a.parent_user_id FROM admin_roles a JOIN app_users u ON u.id=a.user_id "+
 "WHERE a.user_id=$1 AND a.role='SUBADMIN' AND "+
 "(( $2::text='MASTER' AND a.parent_user_id=$3::uuid ) OR ( $2::text='SUBADMIN' AND a.user_id=$3::uuid ))"+
 (lock?" FOR UPDATE OF a":"");
 const r=await db.query(query,[subadminId,actor.role,actor.userId]);
 if(r.rows.length!==1)invalid("Subaccount not found",404);
 return r.rows[0];
}
function normalize(row){
 return {userId:row.user_id,loginAllowed:row.login_allowed!==false,version:Number(row.version??0),updatedAt:row.updated_at??null};
}
export async function getSubadminPolicy(db,actor,subadminId){
 const sub=await permittedSubadmin(db,actor,subadminId);
 const q=await db.query("SELECT * FROM admin_subaccount_policies WHERE user_id=$1",[subadminId]);
 const counts=await db.query(
 "SELECT "+
 "(SELECT count(*)::int FROM client_links c WHERE c.subadmin_user_id=$1) AS client_count,"+
 "(SELECT count(*)::int FROM client_funding_requests f JOIN client_links c ON c.user_id=f.client_user_id WHERE c.subadmin_user_id=$1) AS request_count,"+
 "(SELECT count(*)::int FROM client_funding_requests f JOIN client_links c ON c.user_id=f.client_user_id WHERE c.subadmin_user_id=$1 AND f.status IN ('SUBMITTED','UNDER_REVIEW')) AS pending_count",
 [subadminId]);
 return {...normalize({user_id:subadminId,...q.rows[0]}),email:sub.email,
  clientCount:counts.rows[0]?.client_count??0,requestCount:counts.rows[0]?.request_count??0,
  pendingRequestCount:counts.rows[0]?.pending_count??0};
}
export async function listSubadminControlAudit(db,actor,subadminId){
 await permittedSubadmin(db,actor,subadminId);
 const r=await db.query(
 "SELECT id,actor_user_id,old_login_allowed,new_login_allowed,reason,recorded_at "+
 "FROM admin_subaccount_control_audit WHERE subadmin_user_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT 50",[subadminId]);
 return r.rows.map(row=>({
  id:row.id,actorUserId:row.actor_user_id,oldLoginAllowed:row.old_login_allowed,
  newLoginAllowed:row.new_login_allowed,reason:row.reason,recordedAt:row.recorded_at
 }));
}
export async function changeSubadminLogin(db,actor,data){
 if(actor?.role!=="MASTER")invalid("Master permission required",403);
 if(!data||typeof data!=="object"||Array.isArray(data)||
  Object.keys(data).some(k=>!["userId","loginAllowed","expectedVersion","reason","confirmPassword"].includes(k)))
  invalid("Invalid subaccount control request");
 const {userId,loginAllowed,expectedVersion,reason,confirmPassword}=data;
 check(actor,userId);
 if(typeof loginAllowed!=="boolean")invalid("Invalid login permission");
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)invalid("Invalid version");
 const note=optionalReason(reason);
 if(typeof confirmPassword!=="string"||confirmPassword.length<12||confirmPassword.length>1024)
  invalid("Administrator confirmation required",401);
 const r=await db.query("SELECT password_hash FROM app_users WHERE id=$1",[actor.userId]);
 if(r.rows.length!==1||!(await verifyPassword(confirmPassword,r.rows[0].password_hash)))
  invalid("Administrator confirmation failed",401);
 const conn=await db.connect();let active=false;
 try{
  await conn.query("BEGIN");active=true;
  await permittedSubadmin(conn,actor,userId,true);
  await conn.query("INSERT INTO admin_subaccount_policies(user_id) VALUES($1) ON CONFLICT (user_id) DO NOTHING",[userId]);
  const before=(await conn.query("SELECT * FROM admin_subaccount_policies WHERE user_id=$1 FOR UPDATE",[userId])).rows[0];
  if(!before)invalid("Subaccount policy unavailable",503);
  const current=normalize(before);
  if(current.version!==expectedVersion)invalid("Subaccount policy changed",409);
  if(current.loginAllowed===loginAllowed)invalid("Subaccount already in requested state",409);
  const updated=(await conn.query("UPDATE admin_subaccount_policies SET login_allowed=$2,version=version+1,"+
   "updated_by=$3,updated_at=now() WHERE user_id=$1 RETURNING *",[userId,loginAllowed,actor.userId])).rows[0];
  await conn.query("INSERT INTO admin_subaccount_control_audit(actor_user_id,subadmin_user_id,old_login_allowed,new_login_allowed,reason)"+
   " VALUES($1,$2,$3,$4,$5)",[actor.userId,userId,current.loginAllowed,loginAllowed,note]);
  if(loginAllowed===false){
   await conn.query("UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",[userId]);
  }
  await conn.query("COMMIT");active=false;
  return normalize(updated);
 }catch(error){if(active)await conn.query("ROLLBACK");throw error;}
 finally{conn.release();}
}
