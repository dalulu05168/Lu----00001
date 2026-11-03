import {randomUUID} from "node:crypto";
import {hashPassword,verifyPassword,createSession,revokeSession} from "./auth.mjs";
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export async function registerAccount(db,{email,password,openingCashCents=0,inviteCode}){
 if(typeof email!=="string"||email.length>254||!emailPattern.test(email))throw new Error("Invalid email");
 if(!Number.isSafeInteger(openingCashCents)||openingCashCents<0||openingCashCents>100_000_000_00)throw new Error("Invalid opening balance");
 const passwordHash=await hashPassword(password);
 const client=await db.connect();
 const userId=randomUUID(),accountId=randomUUID();
 let begun=false;
 try{
  await client.query("BEGIN");begun=true;
  // Invitation-only enrollment activates only after its schema is installed.
  const policy=await client.query("SELECT to_regclass('public.registration_policy') AS table_name");
  const inviteSchemaReady=Boolean(policy.rows[0]?.table_name);
  let invitation=null;
  if(inviteSchemaReady){
    const policyResult=await client.query("SELECT invite_required FROM registration_policy WHERE id=1");
    const inviteRequired=policyResult.rows[0]?.invite_required===true;
    if(inviteCode!==undefined||inviteRequired){
      if(typeof inviteCode!=="string"||!/^\d{6}$/.test(inviteCode))throw new Error("Invalid invitation code");
      const invited=await client.query(`SELECT i.id,i.subadmin_user_id FROM invite_codes i
        JOIN admin_roles a ON a.user_id=i.subadmin_user_id AND a.role='SUBADMIN'
        WHERE i.code=$1 AND i.revoked_at IS NULL AND i.expires_at>now()
        AND i.uses<i.max_uses FOR UPDATE OF i`,[inviteCode]);
      if(invited.rows.length!==1)throw new Error("Invalid invitation code");
      invitation=invited.rows[0];
    }
  } else if(inviteCode!==undefined) {
    throw new Error("Invalid invitation code");
  }
  await client.query("INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3)",[userId,email.trim().toLowerCase(),passwordHash]);
  await client.query("INSERT INTO accounts(id,user_id,cash_cents) VALUES($1,$2,$3)",[accountId,userId,openingCashCents]);
  if(invitation){
    await client.query("INSERT INTO client_links(user_id,subadmin_user_id,invite_code_id) VALUES($1,$2,$3)",[userId,invitation.subadmin_user_id,invitation.id]);
    await client.query("UPDATE invite_codes SET uses=uses+1 WHERE id=$1",[invitation.id]);
  }
  if(openingCashCents>0)await client.query("INSERT INTO cash_ledger(account_id,delta_cents,balance_after_cents) VALUES($1,$2,$3)",[accountId,openingCashCents,openingCashCents]);
  await client.query("COMMIT");begun=false;
  return {userId,accountId};
 }catch(err){if(begun)await client.query("ROLLBACK");throw err;}finally{client.release();}
}
export async function loginAccount(db,{email,password}){
 if(typeof email!=="string"||typeof password!=="string")throw new Error("Invalid credentials");
 const r=await db.query(`SELECT u.id,u.password_hash,a.id AS account_id
 FROM app_users u JOIN accounts a ON a.user_id=u.id
 LEFT JOIN admin_roles r ON r.user_id=u.id
 WHERE u.email=$1 AND r.user_id IS NULL`,[email.trim().toLowerCase()]);
 if(r.rows.length!==1||!(await verifyPassword(password,r.rows[0].password_hash)))throw new Error("Invalid credentials");
 const expiresAt=new Date(Date.now()+24*60*60*1000);
 const token=await createSession(db,{userId:r.rows[0].id,accountId:r.rows[0].account_id,expiresAt});
 return {token,expiresAt:expiresAt.toISOString()};
}
export async function logoutAccount(db,token){await revokeSession(db,token);}
export async function getAccountSnapshot(db,accountId){
 const a=await db.query("SELECT id,cash_cents,base_currency FROM accounts WHERE id=$1",[accountId]);
 if(a.rows.length!==1)throw new Error("Account not found");
 const [p,o]=await Promise.all([
  db.query("SELECT market,symbol,quantity FROM positions WHERE account_id=$1 AND quantity>0 ORDER BY market,symbol",[accountId]),
  db.query("SELECT id,market,symbol,side,quantity,price_cents,amount_usd_cents,created_at FROM orders WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100",[accountId])
 ]);
 return {account:{id:a.rows[0].id,cashCents:Number(a.rows[0].cash_cents),currency:a.rows[0].base_currency},positions:p.rows,orders:o.rows,disclosure:"Internal records only; no brokerage orders or real securities ownership."};
}
