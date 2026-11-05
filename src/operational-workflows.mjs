import {optionalReason} from "./optional-reason.mjs";
import {randomUUID} from "node:crypto";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TABLES=Object.freeze({FUNDING:"client_funding_requests",KYC:"client_kyc_requests",BANK_LINK:"client_bank_link_requests"});
const STATUS=Object.freeze({
 FUNDING:new Set(["SUBMITTED","UNDER_REVIEW","APPROVED","REJECTED"]),
 KYC:new Set(["AWAITING_EVIDENCE","UNDER_REVIEW","NEEDS_INFORMATION","MANUALLY_REVIEWED","REJECTED"]),
 BANK_LINK:new Set(["PENDING_VERIFICATION","NEEDS_INFORMATION","REJECTED"])
});
function bad(message,statusCode=400){throw Object.assign(new Error(message),{statusCode});}
function requireUuid(value){if(typeof value!=="string"||!UUID.test(value))bad("Invalid reference");return value;}
function exact(body,allowed){if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))bad("Invalid request fields");}
function actorScope(actor){if(!actor||!["MASTER","SUBADMIN"].includes(actor.role)||!UUID.test(actor.userId))bad("Administrator permission required",403);}
function requireCategory(category){if(!Object.hasOwn(TABLES,category))bad("Invalid request category");return TABLES[category];}
function publicItem(category,row){
 const x={id:row.id,clientId:row.client_user_id,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,
  category,reviewerId:row.review_actor_user_id??null,reviewReason:row.review_reason??null};
 if(category==="FUNDING")Object.assign(x,{kind:row.kind,amountCents:Number(row.amount_cents),currency:row.currency,settlementStatus:row.settlement_status??"NOT_EXECUTED"});
 if(category==="BANK_LINK")Object.assign(x,{bankLabel:row.bank_label,accountLast4:row.account_last4,verified:false});
 if(category==="KYC")Object.assign(x,{identityVerified:false,documentsStored:false});
 return x;
}
async function recordAudit(db,category,id,userId,actorId,oldStatus,newStatus,reason=null){
 await db.query("INSERT INTO client_workflow_audit(category,request_id,client_user_id,actor_user_id,old_status,new_status,reason)"+
 " VALUES($1,$2,$3,$4,$5,$6,$7)",[category,id,userId,actorId,oldStatus,newStatus,reason]);
}
async function withTxn(db,action){
 const conn=await db.connect();let active=false;
 try{await conn.query("BEGIN");active=true;const value=await action(conn);await conn.query("COMMIT");active=false;return value;}
 catch(e){if(active)await conn.query("ROLLBACK");throw e;}
 finally{conn.release();}
}
export async function submitClientRequest(db,userId,category,data){
 requireUuid(userId);requireCategory(category);
 exact(data,category==="FUNDING"?["kind","amountCents"]:category==="KYC"?[]:["bankLabel","accountLast4"]);
 if(category==="FUNDING"){
  if(!["DEPOSIT","WITHDRAWAL"].includes(data.kind))bad("Invalid funding kind");
  if(!Number.isSafeInteger(data.amountCents)||data.amountCents<100||data.amountCents>100000000)bad("Invalid request amount");
 }
 if(category==="BANK_LINK"&&(
  typeof data.bankLabel!=="string"||data.bankLabel.trim().length<2||data.bankLabel.trim().length>80||
  typeof data.accountLast4!=="string"||!/^[0-9]{4}$/.test(data.accountLast4)
 ))bad("Invalid masked bank details");
 return withTxn(db,async conn=>{
  if(category==="FUNDING"&&data.kind==="WITHDRAWAL"){
   const p=await conn.query("SELECT withdrawal_requests_allowed FROM client_admin_policies WHERE user_id=$1 FOR SHARE",[userId]);
   if(p.rows[0]?.withdrawal_requests_allowed===false)bad("Withdrawal requests disabled",403);
  }
  const id=randomUUID();let item;
  if(category==="FUNDING"){
   item=(await conn.query("INSERT INTO client_funding_requests(id,client_user_id,kind,amount_cents)"+
    " VALUES($1,$2,$3,$4) RETURNING *",[id,userId,data.kind,data.amountCents])).rows[0];
  }else if(category==="KYC"){
   item=(await conn.query("INSERT INTO client_kyc_requests(id,client_user_id) VALUES($1,$2) RETURNING *",[id,userId])).rows[0];
  }else{
   item=(await conn.query("INSERT INTO client_bank_link_requests(id,client_user_id,bank_label,account_last4)"+
    " VALUES($1,$2,$3,$4) RETURNING *",[id,userId,data.bankLabel.trim(),data.accountLast4])).rows[0];
  }
  await recordAudit(conn,category,id,userId,userId,null,item.status);
  return publicItem(category,item);
 });
}
export async function listClientRequests(db,userId,category){
 requireUuid(userId);const table=requireCategory(category);
 const q=await db.query("SELECT * FROM "+table+" WHERE client_user_id=$1 ORDER BY created_at DESC LIMIT 100",[userId]);
 return q.rows.map(row=>publicItem(category,row));
}
export async function listAdminRequests(db,actor,category,clientId=null){
 actorScope(actor);const table=requireCategory(category);
 if(clientId!==null){
  requireUuid(clientId);
  const permitted=await db.query("SELECT u.id FROM app_users u "+
   "LEFT JOIN client_links l ON l.user_id=u.id "+
   "WHERE u.id=$1 AND NOT EXISTS (SELECT 1 FROM admin_roles ar WHERE ar.user_id=u.id) "+
   "AND ($2::text='MASTER' OR l.subadmin_user_id=$3::uuid)",
   [clientId,actor.role,actor.userId]);
  if(permitted.rows.length!==1)bad("Client not found",404);
 }
 const q=await db.query("SELECT r.* FROM "+table+" r LEFT JOIN client_links l ON l.user_id=r.client_user_id "+
  "WHERE ($1::text='MASTER' OR l.subadmin_user_id=$2::uuid) "+
  "AND ($3::uuid IS NULL OR r.client_user_id=$3::uuid) "+
  "ORDER BY r.created_at DESC,r.id DESC LIMIT 300",[actor.role,actor.userId,clientId]);
 return q.rows.map(row=>publicItem(category,row));
}
function nextStatus(category,role,current,target){
 if(!STATUS[category].has(target))bad("Unsupported review status");
 if(category==="FUNDING"){
  if(role==="MASTER"&&current==="SUBMITTED"&&target==="APPROVED")return;
  if(current==="SUBMITTED"&&target==="UNDER_REVIEW")return;
  if(role==="MASTER"&&current==="UNDER_REVIEW"&&["APPROVED","REJECTED"].includes(target))return;
 }else if(category==="KYC"){
  if(current==="AWAITING_EVIDENCE"&&target==="NEEDS_INFORMATION")return;
  if(current==="NEEDS_INFORMATION"&&target==="UNDER_REVIEW")return;
  if(role==="MASTER"&&current==="UNDER_REVIEW"&&["MANUALLY_REVIEWED","REJECTED"].includes(target))return;
 }else if(category==="BANK_LINK"){
  if(current==="PENDING_VERIFICATION"&&target==="NEEDS_INFORMATION")return;
  if(role==="MASTER"&&current==="PENDING_VERIFICATION"&&target==="REJECTED")return;
 }
 bad("Review transition not permitted",403);
}
export async function reviewAdminRequest(db,actor,category,data){
 actorScope(actor);const table=requireCategory(category);
 exact(data,["id","expectedStatus","status","reason"]);
 requireUuid(data.id);
 if(typeof data.expectedStatus!=="string"||!STATUS[category].has(data.expectedStatus))bad("Invalid current status");
 const reason=optionalReason(data.reason);
 return withTxn(db,async conn=>{
  const q=await conn.query("SELECT r.* FROM "+table+" r LEFT JOIN client_links l ON l.user_id=r.client_user_id "+
   "WHERE r.id=$1 AND ($2::text='MASTER' OR l.subadmin_user_id=$3::uuid) FOR UPDATE OF r",
   [data.id,actor.role,actor.userId]);
  if(q.rows.length!==1)bad("Request not found",404);
  const previous=q.rows[0];
  if(previous.status!==data.expectedStatus)bad("Request state changed",409);
  nextStatus(category,actor.role,previous.status,data.status);
  if(category==="FUNDING"&&data.status==="APPROVED"){
   const account=(await conn.query("SELECT id,cash_cents FROM accounts WHERE user_id=$1 FOR UPDATE",[previous.client_user_id])).rows[0];
   if(!account)bad("Account not found",409);
   const delta=BigInt(previous.amount_cents)*(previous.kind==="DEPOSIT"?1n:-1n);
   const balance=BigInt(account.cash_cents)+delta;
   if(balance<0n)bad("Insufficient internal balance",409);
   if(balance>BigInt(Number.MAX_SAFE_INTEGER))bad("Internal balance limit exceeded",409);
   await conn.query("UPDATE accounts SET cash_cents=$2 WHERE id=$1",[account.id,balance.toString()]);
   await conn.query("INSERT INTO cash_ledger(account_id,funding_request_id,delta_cents,balance_after_cents) VALUES($1,$2,$3,$4)",
    [account.id,previous.id,delta.toString(),balance.toString()]);
   await conn.query("UPDATE client_funding_requests SET settlement_status='INTERNAL_POSTED',settled_at=now() WHERE id=$1",[previous.id]);
  }
  const u=await conn.query("UPDATE "+table+" SET status=$2,review_actor_user_id=$3,review_reason=$4,"+
   "updated_at=now() WHERE id=$1 RETURNING *",[data.id,data.status,actor.userId,reason]);
  await recordAudit(conn,category,data.id,previous.client_user_id,actor.userId,previous.status,data.status,reason);
  return publicItem(category,u.rows[0]);
 });
}
export async function listAdminWorkflowAudit(db,actor,clientId){
 actorScope(actor);requireUuid(clientId);
 const allowed=await db.query("SELECT u.id FROM app_users u LEFT JOIN client_links l ON l.user_id=u.id "+
  "WHERE u.id=$1 AND NOT EXISTS(SELECT 1 FROM admin_roles a WHERE a.user_id=u.id) "+
  "AND ($2::text='MASTER' OR l.subadmin_user_id=$3::uuid)",[clientId,actor.role,actor.userId]);
 if(allowed.rows.length!==1)bad("Client not found",404);
 const r=await db.query("SELECT id,category,request_id,actor_user_id,old_status,new_status,reason,event_at "+
  "FROM client_workflow_audit WHERE client_user_id=$1 ORDER BY event_at DESC,id DESC LIMIT 150",[clientId]);
 return r.rows;
}

/**
 * Keyset pagination across all three customer application types.
 * Confirm ownership before querying records; no offset caps or cross-user data.
 */
export async function listAdminClientHistoryPage(db,actor,clientId,{cursor=null,limit=20}={}){
 actorScope(actor);requireUuid(clientId);
 if(!Number.isSafeInteger(limit)||limit<1||limit>50)bad("Invalid history page size");
 let pointer=null;
 if(cursor!==null){
  if(typeof cursor!=="string"||cursor.length<12||cursor.length>240||!/^[A-Za-z0-9_-]+$/.test(cursor))
   bad("Invalid history cursor");
  try{pointer=JSON.parse(Buffer.from(cursor,"base64url").toString("utf8"));}
  catch{bad("Invalid history cursor");}
  if(!Array.isArray(pointer)||pointer.length!==3||
   typeof pointer[0]!=="string"||!Number.isFinite(Date.parse(pointer[0]))||
   !UUID.test(pointer[1])||!Object.hasOwn(TABLES,pointer[2]))
   bad("Invalid history cursor");
 }
 const access=await db.query("SELECT u.id FROM app_users u LEFT JOIN client_links l ON l.user_id=u.id "+
  "WHERE u.id=$1 AND NOT EXISTS(SELECT 1 FROM admin_roles ar WHERE ar.user_id=u.id) "+
  "AND ($2::text='MASTER' OR l.subadmin_user_id=$3::uuid)",[clientId,actor.role,actor.userId]);
 if(access.rows.length!==1)bad("Client not found",404);
 const sql=String.raw`SELECT h.* FROM (
 SELECT id,client_user_id,'FUNDING'::text AS category,status,created_at,updated_at,review_actor_user_id,review_reason,
        kind,amount_cents,currency,NULL::text AS bank_label,NULL::char(4) AS account_last4,settlement_status
 FROM client_funding_requests WHERE client_user_id=$1
 UNION ALL
 SELECT id,client_user_id,'KYC'::text AS category,status,created_at,updated_at,review_actor_user_id,review_reason,
        NULL::text,NULL::bigint,NULL::char(3),NULL::text,NULL::char(4),NULL::text
 FROM client_kyc_requests WHERE client_user_id=$1
 UNION ALL
 SELECT id,client_user_id,'BANK_LINK'::text AS category,status,created_at,updated_at,review_actor_user_id,review_reason,
        NULL::text,NULL::bigint,NULL::char(3),bank_label,account_last4,NULL::text
 FROM client_bank_link_requests WHERE client_user_id=$1
) h WHERE ($3::timestamptz IS NULL OR
  (h.created_at,h.id,h.category) < ($3::timestamptz,$4::uuid,$5::text))
ORDER BY h.created_at DESC,h.id DESC,h.category DESC LIMIT $2`;
 const params=[clientId,limit+1,pointer?.[0]??null,pointer?.[1]??null,pointer?.[2]??null];
 const result=await db.query(sql,params);
 const hasMore=result.rows.length>limit;
 const page=result.rows.slice(0,limit);
 const last=page.at(-1);
 const nextCursor=hasMore && last
  ?Buffer.from(JSON.stringify([new Date(last.created_at).toISOString(),last.id,last.category]),"utf8").toString("base64url")
  :null;
 return {items:page.map(row=>publicItem(row.category,row)),hasMore,nextCursor,pageSize:limit};
}
