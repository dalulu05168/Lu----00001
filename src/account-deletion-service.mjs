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
