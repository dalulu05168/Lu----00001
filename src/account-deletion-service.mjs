import {randomUUID} from "node:crypto";
import {verifyPassword} from "./auth.mjs";

function safeResponse(row){
 if(!row)return {status:"NONE",requestId:null,requestedAt:null};
 return {status:row.status,requestId:row.id,requestedAt:row.requested_at};
}
export async function getAccountDeletionRequest(db,userId){
 if(!userId)throw new Error("Authentication required");
 const r=await db.query(
  "SELECT id,status,requested_at FROM customer_account_deletion_requests WHERE client_user_id=$1",
  [userId]
 );
 return safeResponse(r.rows[0]);
}
export async function requestAccountDeletion(db,userId,{password,confirmation}={}){
 if(!userId)throw new Error("Authentication required");
 if(typeof password!=="string"||password.length<1||password.length>1024||
    confirmation!=="DELETE MY ACCOUNT")throw new Error("Invalid deletion confirmation");
 const match=await db.query(
  "SELECT password_hash FROM app_users WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM admin_roles WHERE user_id=$1)",
  [userId]
 );
 if(match.rows.length!==1||!await verifyPassword(password,match.rows[0].password_hash))
  throw new Error("Invalid deletion credentials");
 // Idempotent for repeated requests. A rejected request can be reopened by its owner.
 const q=await db.query(`
  INSERT INTO customer_account_deletion_requests(id,client_user_id,status)
  VALUES($1,$2,'REQUESTED')
  ON CONFLICT(client_user_id) DO UPDATE SET
   status=CASE WHEN customer_account_deletion_requests.status='REJECTED'
               THEN 'REQUESTED' ELSE customer_account_deletion_requests.status END,
   requested_at=CASE WHEN customer_account_deletion_requests.status='REJECTED'
                     THEN now() ELSE customer_account_deletion_requests.requested_at END,
   reviewed_at=CASE WHEN customer_account_deletion_requests.status='REJECTED'
                     THEN NULL ELSE customer_account_deletion_requests.reviewed_at END,
   reviewed_by=CASE WHEN customer_account_deletion_requests.status='REJECTED'
                     THEN NULL ELSE customer_account_deletion_requests.reviewed_by END,
   review_note=CASE WHEN customer_account_deletion_requests.status='REJECTED'
                     THEN NULL ELSE customer_account_deletion_requests.review_note END
  RETURNING id,status,requested_at`,[randomUUID(),userId]
 );
 return safeResponse(q.rows[0]);
}

/** Read-only administrator queue. Master sees all; subadmin only clients linked to that user. */
export async function listAdminDeletionRequests(db,actor){
 if(!actor||!["MASTER","SUBADMIN"].includes(actor.role)||!actor.userId){
  throw Object.assign(new Error("Administrator permission required"),{statusCode:403});
 }
 const r=await db.query(`
  SELECT d.id,d.status,d.requested_at,d.client_user_id,u.email
  FROM customer_account_deletion_requests d
  LEFT JOIN app_users u ON u.id=d.client_user_id
  LEFT JOIN client_links l ON l.user_id=d.client_user_id
  WHERE ($1::text='MASTER' OR l.subadmin_user_id=$2::uuid)
  ORDER BY d.requested_at DESC,d.id DESC LIMIT 200`,
  [actor.role,actor.userId]);
 return {items:r.rows.map(row=>({
  id:row.id,clientId:row.client_user_id,email:row.email,
  status:row.status,requestedAt:row.requested_at
 }))};
}
