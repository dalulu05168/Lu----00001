import {randomUUID} from "node:crypto";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function bad(message,statusCode=400){throw Object.assign(new Error(message),{statusCode});}
function id(value){if(typeof value!=="string"||!UUID.test(value))bad("Invalid thread reference");return value;}
function message(value){if(typeof value!=="string"||value.trim().length<1||value.trim().length>4000)bad("Invalid message");return value.trim();}
function actorScope(actor){if(!actor||!UUID.test(actor.userId)||!["MASTER","SUBADMIN"].includes(actor.role))bad("Administrator required",403);}
async function withTransaction(db,fn){const c=await db.connect();let tx=false;try{
 await c.query("BEGIN");tx=true;const result=await fn(c);await c.query("COMMIT");tx=false;return result;
}catch(e){if(tx)await c.query("ROLLBACK");throw e;}finally{c.release();}}
function outThread(r){return {id:r.id,clientId:r.client_user_id,status:r.status,createdAt:r.created_at,updatedAt:r.updated_at};}
function outMessage(r){return {id:r.id,threadId:r.thread_id,senderUserId:r.sender_user_id,body:r.body,createdAt:r.created_at};}
async function ownedThread(db,userId){
 id(userId);
 const q=await db.query("SELECT * FROM support_threads WHERE client_user_id=$1",[userId]);
 return q.rows[0]??null;
}
export async function getCustomerSupport(db,userId){
 const thread=await ownedThread(db,userId);
 if(!thread)return {thread:null,messages:[]};
 const list=await db.query("SELECT id,thread_id,sender_user_id,body,created_at FROM support_messages"+
  " WHERE thread_id=$1 ORDER BY created_at ASC,id ASC LIMIT 200",[thread.id]);
 return {thread:outThread(thread),messages:list.rows.map(outMessage)};
}
export async function sendCustomerSupportMessage(db,userId,body){
 id(userId);const clean=message(body?.message);
 if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some(k=>k!=="message"))
  bad("Invalid message fields");
 return withTransaction(db,async c=>{
  const client=await c.query("SELECT id FROM app_users WHERE id=$1 AND NOT EXISTS"+
   " (SELECT 1 FROM admin_roles WHERE user_id=$1) FOR UPDATE",[userId]);
  if(client.rows.length!==1)bad("Customer account required",403);
  const tid=randomUUID();
  const t=await c.query("INSERT INTO support_threads(id,client_user_id) VALUES($1,$2)"+
   " ON CONFLICT(client_user_id) DO UPDATE SET updated_at=now() RETURNING *",[tid,userId]);
  if(t.rows[0].status==="CLOSED")bad("Conversation closed; contact support to reopen",409);
  const mid=randomUUID();
  const m=await c.query("INSERT INTO support_messages(id,thread_id,sender_user_id,body)"+
   " VALUES($1,$2,$3,$4) RETURNING *",[mid,t.rows[0].id,userId,clean]);
  return {thread:outThread(t.rows[0]),message:outMessage(m.rows[0])};
 });
}
export async function listAdminSupportThreads(db,actor){
 actorScope(actor);
 const r=await db.query("SELECT t.id,t.client_user_id,t.status,t.created_at,t.updated_at,u.email FROM support_threads t"+
  " JOIN app_users u ON u.id=t.client_user_id LEFT JOIN client_links l ON l.user_id=t.client_user_id"+
  " WHERE ($1::text='MASTER' OR l.subadmin_user_id=$2::uuid)"+
  " ORDER BY t.updated_at DESC,t.id DESC LIMIT 200",[actor.role,actor.userId]);
 return {items:r.rows.map(x=>({...outThread(x),clientEmail:x.email}))};
}
async function findScopedThread(db,actor,threadId,lock=false){
 actorScope(actor);id(threadId);
 const r=await db.query("SELECT t.* FROM support_threads t LEFT JOIN client_links l ON l.user_id=t.client_user_id"+
  " WHERE t.id=$1 AND ($2::text='MASTER' OR l.subadmin_user_id=$3::uuid)"+
  (lock?" FOR UPDATE OF t":""),[threadId,actor.role,actor.userId]);
 if(r.rows.length!==1)bad("Thread not found",404);
 return r.rows[0];
}
export async function getAdminSupportThread(db,actor,threadId){
 const thread=await findScopedThread(db,actor,threadId);
 const r=await db.query("SELECT id,thread_id,sender_user_id,body,created_at FROM support_messages"+
  " WHERE thread_id=$1 ORDER BY created_at ASC,id ASC LIMIT 200",[threadId]);
 return {thread:outThread(thread),messages:r.rows.map(outMessage)};
}
export async function sendAdminSupportMessage(db,actor,body){
 actorScope(actor);
 if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some(k=>!["threadId","message"].includes(k)))
  bad("Invalid message fields");
 const threadId=id(body.threadId),clean=message(body.message);
 return withTransaction(db,async c=>{
  const thread=await findScopedThread(c,actor,threadId,true);
  if(thread.status!=="OPEN")bad("Conversation closed",409);
  const r=await c.query("INSERT INTO support_messages(id,thread_id,sender_user_id,body) VALUES($1,$2,$3,$4) RETURNING *",
   [randomUUID(),threadId,actor.userId,clean]);
  await c.query("UPDATE support_threads SET updated_at=now() WHERE id=$1",[threadId]);
  return {message:outMessage(r.rows[0])};
 });
}
export async function changeAdminSupportStatus(db,actor,body){
 actorScope(actor);
 if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some(k=>!["threadId","expectedStatus","status","reason"].includes(k)))
  bad("Invalid support status fields");
 const threadId=id(body.threadId),next=body.status,old=body.expectedStatus;
 if(!["OPEN","CLOSED"].includes(next)||!["OPEN","CLOSED"].includes(old)||next===old)bad("Invalid status transition");
 if(typeof body.reason!=="string"||body.reason.trim().length<12||body.reason.trim().length>400)
  bad("Status reason required");
 return withTransaction(db,async c=>{
  const t=await findScopedThread(c,actor,threadId,true);
  if(t.status!==old)bad("Status changed since refresh",409);
  const r=await c.query("UPDATE support_threads SET status=$2,updated_at=now() WHERE id=$1 RETURNING *",[threadId,next]);
  await c.query("INSERT INTO support_status_audit(thread_id,actor_user_id,previous_status,new_status,reason)"+
   " VALUES($1,$2,$3,$4,$5)",[threadId,actor.userId,old,next,body.reason.trim()]);
  return {thread:outThread(r.rows[0])};
 });
}
