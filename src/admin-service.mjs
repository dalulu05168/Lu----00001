import {randomUUID,randomInt,timingSafeEqual,createHash} from "node:crypto";
import {hashPassword,verifyPassword,createSession,rejectUnknownAccount,generateSessionToken} from "./auth.mjs";
import {enableNewProductPurchases} from './internal-products.mjs';
import {generateTotpSecret,verifyTotpCode,totpUri,base32Encode} from "./totp.mjs";
import {adminTotpKey,sealTotpSecret,openTotpSecret} from "./admin-totp-storage.mjs";


const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function matchBootstrapKey(value){
  const proof=process.env.ADMIN_BOOTSTRAP_SECRET;
  if(typeof value!=="string"||typeof proof!=="string"||proof.length<32)return false;
  const a=Buffer.from(value),b=Buffer.from(proof);
  return a.length===b.length&&timingSafeEqual(a,b);
}
const SYMBOL=/^[A-Z0-9][A-Z0-9.-]{0,23}$/;
// HK/CN/MY withdrawn: no working free quote source was found for them, so
// no new listings can be published under those markets. Existing rows (if
// any) in the database are untouched by this change.
const MARKETS=new Set(["US","RO"]);
const TYPES=new Set(["STOCK","FUND","IPO"]);
function invalid(message){const error=new Error(message);error.statusCode=400;throw error;}
function getEmail(value) {
  if(typeof value!=="string"||value.length>254||!EMAIL.test(value))invalid("Invalid email");
  return value.trim().toLowerCase();
}
function safeListing(value){
  if(!value||typeof value!=="object"||Array.isArray(value))invalid("Invalid listing");
  if(Object.keys(value).some(key=>!["itemType","market","symbol","name","status"].includes(key)))invalid("Unexpected listing fields");
  const {itemType,market,symbol,name,status="DRAFT"}=value;
  if(!TYPES.has(itemType)||!MARKETS.has(market)||typeof symbol!=="string"||!SYMBOL.test(symbol)||
     typeof name!=="string"||!name.trim()||name.length>120||
     !["DRAFT","PUBLISHED"].includes(status))invalid("Invalid listing fields");
  return {itemType,market,symbol,name:name.trim(),status};
}

export async function roleFor(db,session) {
  if(!session?.userId||session.adminVerified!==true)return null;
  const r=await db.query(`SELECT user_id,role,parent_user_id FROM admin_roles
    WHERE user_id=$1`,[session.userId]);
  return r.rows.length===1 ? {
    userId:r.rows[0].user_id,role:r.rows[0].role,parentUserId:r.rows[0].parent_user_id
  }:null;
}
export async function bootstrapMaster(db,{email,password,setupKey}){
  const allowed=process.env.ADMIN_MASTER_EMAIL?.trim().toLowerCase();
  const normalized=getEmail(email);
  if(!allowed||normalized!==allowed||!matchBootstrapKey(setupKey))invalid("Invalid setup proof");
  const passwordHash=await hashPassword(password),userId=randomUUID(),accountId=randomUUID();
  const c=await db.connect();let tx=false;
  try{
    await c.query("BEGIN");tx=true;
    const exists=await c.query("SELECT user_id FROM admin_roles WHERE role='MASTER' FOR UPDATE");
    if(exists.rows.length)invalid("Master already provisioned");
    const occupied=await c.query("SELECT id FROM app_users WHERE email=$1 FOR UPDATE",[normalized]);
    if(occupied.rows.length)invalid("Master email is already registered");
    await c.query("INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3)",[userId,normalized,passwordHash]);
    await c.query("INSERT INTO accounts(id,user_id,cash_cents) VALUES($1,$2,0)",[accountId,userId]);
    await c.query("INSERT INTO admin_roles(user_id,role,password_setup_pending) VALUES($1,'MASTER',false)",[userId]);
    await c.query("COMMIT");tx=false;
    return {role:"MASTER",ready:true};
  }catch(error){if(tx)await c.query("ROLLBACK");throw error;}
  finally{c.release();}
}
export async function recoverPendingMaster(db,{email,password,setupKey}){
  const normalized=getEmail(email);
  const allowed=process.env.ADMIN_MASTER_EMAIL?.trim().toLowerCase();
  if(!allowed||normalized!==allowed||!matchBootstrapKey(setupKey))invalid("Invalid setup proof");
  const hash=await hashPassword(password);
  const c=await db.connect();let tx=false;
  try{
    await c.query("BEGIN");tx=true;
    const r=await c.query(`SELECT a.user_id,a.password_setup_pending FROM admin_roles a
      JOIN app_users u ON u.id=a.user_id WHERE a.role='MASTER' AND u.email=$1
      FOR UPDATE OF a,u`,[normalized]);
    if(r.rows.length!==1||r.rows[0].password_setup_pending!==true)
      invalid("Account recovery unavailable");
    const userId=r.rows[0].user_id;
    await c.query("UPDATE app_users SET password_hash=$2 WHERE id=$1",[userId,hash]);
    await c.query("UPDATE admin_roles SET password_setup_pending=false WHERE user_id=$1",[userId]);
    await c.query("UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",[userId]);
    await c.query("COMMIT");tx=false;
    return {role:"MASTER",ready:true};
  }catch(error){if(tx)await c.query("ROLLBACK");throw error;}
  finally{c.release();}
}
const TOTP_CHALLENGE_TTL_MS=10*60*1000;
const TOTP_MAX_ATTEMPTS=5;
function challengeTokenHash(token){return createHash("sha256").update(token).digest("hex");}

/**
 * Password-only step 1 of login. Returns neither a usable session nor any
 * secret for an already-enrolled admin; the caller must still pass the TOTP
 * challenge via verifyAdminTotp before getting a real, adminVerified session.
 */
export async function adminLogin(db,{email,password}){
  if(typeof password!=="string")invalid("Invalid admin login");
  const r=await db.query(`SELECT u.id,u.password_hash,a.id AS account_id,r.role,
      r.totp_secret_ciphertext,r.totp_confirmed_at
    FROM app_users u JOIN accounts a ON a.user_id=u.id
    JOIN admin_roles r ON r.user_id=u.id
    LEFT JOIN admin_subaccount_policies sp ON sp.user_id=u.id
    WHERE u.email=$1 AND COALESCE(sp.login_allowed,true)=true`,[getEmail(email)]);
  const valid=r.rows.length===1?await verifyPassword(password,r.rows[0].password_hash):await rejectUnknownAccount(password);
  if(!valid){
    const error=new Error("Invalid admin credentials");error.statusCode=401;throw error;
  }
  const row=r.rows[0];
  await db.query("UPDATE admin_roles SET password_setup_pending=false WHERE user_id=$1 AND password_setup_pending=true",[row.id]);
  const key=adminTotpKey();
  const setup=row.totp_confirmed_at===null;
  let secretCipher=row.totp_secret_ciphertext,otpauthUri,secretDisplay;
  if(setup){
    // Reuse an already-generated-but-unconfirmed secret so a prior failed
    // attempt doesn't force the admin to re-scan a brand new QR code.
    if(!secretCipher){
      const secret=generateTotpSecret();
      secretCipher=sealTotpSecret(secret,key,row.id);
      await db.query("UPDATE admin_roles SET totp_secret_ciphertext=$2 WHERE user_id=$1",[row.id,secretCipher]);
    }
    const secret=openTotpSecret(secretCipher,key,row.id);
    secretDisplay=base32Encode(secret);
    otpauthUri=totpUri(secret,{email:getEmail(email)});
  }
  const pendingToken=generateSessionToken();
  const expiresAt=new Date(Date.now()+TOTP_CHALLENGE_TTL_MS);
  await db.query(`INSERT INTO admin_totp_challenges(id,user_id,token_hash,setup,expires_at)
    VALUES($1,$2,$3,$4,$5)`,[randomUUID(),row.id,challengeTokenHash(pendingToken),setup,expiresAt]);
  return setup
    ? {totpSetupRequired:true,secret:secretDisplay,otpauthUri,pendingToken,expiresAt:expiresAt.toISOString()}
    : {totpRequired:true,pendingToken,expiresAt:expiresAt.toISOString()};
}

/** Step 2: spend the pending challenge for a real, adminVerified session. */
export async function verifyAdminTotp(db,{pendingToken,code}){
  if(typeof pendingToken!=="string"||pendingToken.length<32||pendingToken.length>256||
     typeof code!=="string"||!/^\d{6}$/.test(code)){
    const error=new Error("Invalid 2FA verification");error.statusCode=400;throw error;
  }
  const client=await db.connect();let tx=false;
  try{
    await client.query("BEGIN");tx=true;
    const c=await client.query(`SELECT c.id,c.user_id,c.setup,c.attempts,c.expires_at,
        r.role,r.totp_secret_ciphertext,a.id AS account_id
      FROM admin_totp_challenges c
      JOIN admin_roles r ON r.user_id=c.user_id
      JOIN accounts a ON a.user_id=c.user_id
      WHERE c.token_hash=$1 FOR UPDATE OF c`,[challengeTokenHash(pendingToken)]);
    if(c.rows.length!==1){
      const error=new Error("2FA session expired; please sign in again");error.statusCode=401;throw error;
    }
    const row=c.rows[0];
    if(new Date(row.expires_at)<=new Date()||row.attempts>=TOTP_MAX_ATTEMPTS||!row.totp_secret_ciphertext){
      await client.query("DELETE FROM admin_totp_challenges WHERE id=$1",[row.id]);
      await client.query("COMMIT");tx=false;
      const error=new Error("2FA session expired; please sign in again");error.statusCode=401;throw error;
    }
    const secret=openTotpSecret(row.totp_secret_ciphertext,adminTotpKey(),row.user_id);
    if(!verifyTotpCode(secret,code)){
      await client.query("UPDATE admin_totp_challenges SET attempts=attempts+1 WHERE id=$1",[row.id]);
      await client.query("COMMIT");tx=false;
      const error=new Error("Invalid 2FA code");error.statusCode=401;throw error;
    }
    if(row.setup)await client.query("UPDATE admin_roles SET totp_confirmed_at=now() WHERE user_id=$1",[row.user_id]);
    await client.query("DELETE FROM admin_totp_challenges WHERE id=$1",[row.id]);
    const expiresAt=new Date(Date.now()+30*60*1000);
    const token=await createSession(client,{userId:row.user_id,accountId:row.account_id,expiresAt,adminVerified:true});
    await client.query("COMMIT");tx=false;
    return {token,role:row.role,expiresAt:expiresAt.toISOString()};
  }catch(error){if(tx)await client.query("ROLLBACK");throw error;}
  finally{client.release();}
}
export async function createSubadmin(db,actor,{email,password}){
  if(actor?.role!=="MASTER")invalid("Only master can create subadmins");
  const normalized=getEmail(email),passwordHash=await hashPassword(password);
  const userId=randomUUID(),accountId=randomUUID(),inviteId=randomUUID();
  const client=await db.connect();let begun=false;
  try{
    await client.query("BEGIN");begun=true;
    await client.query("INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3)",[userId,normalized,passwordHash]);
    await client.query("INSERT INTO accounts(id,user_id,cash_cents) VALUES($1,$2,0)",[accountId,userId]);
    await client.query(`INSERT INTO admin_roles(user_id,role,parent_user_id,password_setup_pending)
      VALUES($1,'SUBADMIN',$2,false)`,[userId,actor.userId]);
    // Randomized public enrollment code, never used as an authentication factor.
    let inviteCode;
    for(let tries=0;tries<10;tries++){
      const candidate=String(randomInt(0,1000000)).padStart(6,"0");
      const exists=await client.query("SELECT 1 FROM invite_codes WHERE code=$1",[candidate]);
      if(!exists.rows.length){inviteCode=candidate;break;}
    }
    if(!inviteCode)throw new Error("No invitation code available");
    await client.query(`INSERT INTO invite_codes(id,subadmin_user_id,code,expires_at,max_uses)
      VALUES($1,$2,$3,now()+interval '30 days',100)`,[inviteId,userId,inviteCode]);
    await client.query("COMMIT");begun=false;
    return {userId,email:normalized,inviteCode};
  }catch(error){if(begun)await client.query("ROLLBACK");throw error;}
  finally{client.release();}
}
export async function listSubadmins(db,actor){
  if(actor?.role==="MASTER"){
    const r=await db.query(`SELECT a.user_id,u.email,i.code,i.expires_at,i.uses,i.max_uses
      FROM admin_roles a JOIN app_users u ON u.id=a.user_id
      LEFT JOIN invite_codes i ON i.subadmin_user_id=a.user_id
      WHERE a.role='SUBADMIN' AND a.parent_user_id=$1 ORDER BY a.created_at DESC`,[actor.userId]);
    return r.rows;
  }
  if(actor?.role==="SUBADMIN"){
    const r=await db.query(`SELECT a.user_id,u.email,i.code,i.expires_at,i.uses,i.max_uses
      FROM admin_roles a JOIN app_users u ON u.id=a.user_id
      LEFT JOIN invite_codes i ON i.subadmin_user_id=a.user_id WHERE a.user_id=$1`,[actor.userId]);
    return r.rows;
  }
  return [];
}
export async function listClients(db,actor){
  if(actor.role==="MASTER"){
    const r=await db.query(`SELECT u.id,u.email,c.subadmin_user_id,COALESCE(c.created_at,u.created_at) AS created_at
      FROM app_users u LEFT JOIN client_links c ON c.user_id=u.id
      WHERE NOT EXISTS (SELECT 1 FROM admin_roles a WHERE a.user_id=u.id)
      ORDER BY COALESCE(c.created_at,u.created_at) DESC LIMIT 500`);
    return r.rows;
  }
  if(actor.role==="SUBADMIN"){
    const r=await db.query(`SELECT u.id,u.email,c.subadmin_user_id,c.created_at
      FROM client_links c JOIN app_users u ON u.id=c.user_id
      WHERE c.subadmin_user_id=$1 ORDER BY c.created_at DESC LIMIT 500`,[actor.userId]);
    return r.rows;
  }
  return [];
}
export async function createListing(db,actor,data){
  if(actor?.role!=="MASTER")invalid("Only master can publish listings");
  const {purchaseTerms,...metadata}=data??{};
  const item=safeListing(metadata);
  // Legacy non-null purchase_password_hash is retained in the database schema,
  // but no purchase flow reads it. Store an unreachable random hash, not a user credential.
  const hash=await hashPassword(randomUUID()),id=randomUUID();
  const insert=target=>target.query(`INSERT INTO listings(id,item_type,market,symbol,display_name,discount_bps,purchase_password_hash,status,created_by)
    VALUES($1,$2,$3,$4,$5,0,$6,$7,$8)`,[id,item.itemType,item.market,item.symbol,item.name,hash,item.status,actor.userId]);
  if(purchaseTerms===undefined)await insert(db);
  else{
    const client=await db.connect();
    try{
      await client.query('BEGIN');await insert(client);
      await enableNewProductPurchases(client,actor,'LISTING',id,purchaseTerms,item.status);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  }
  return {id,itemType:item.itemType,market:item.market,symbol:item.symbol,name:item.name,status:item.status};
}
export async function listListings(db,actor){
  if(!actor)return [];
  const r=await db.query(`SELECT id,item_type,market,symbol,display_name,status,created_at
    FROM listings ORDER BY created_at DESC LIMIT 300`);
  return r.rows.map(x=>({id:x.id,itemType:x.item_type,market:x.market,symbol:x.symbol,
    name:x.display_name,status:x.status}));
}
export async function updateListing(db,actor,data){
  if(actor?.role!=="MASTER")invalid("Only master can edit listings");
  if(!data||typeof data!=="object"||Array.isArray(data)||
    Object.keys(data).some(key=>!["id","itemType","market","symbol","name","status"].includes(key)))
    invalid("Invalid listing update");
  const {id,...changes}=data;
  if(typeof id!=="string"||!/^[0-9a-f-]{36}$/.test(id)||Object.keys(changes).length===0)
    invalid("Invalid listing update");
  const allowedColumns={itemType:"item_type",market:"market",symbol:"symbol",name:"display_name",status:"status"};
  const prepared={};
  for(const [key,value] of Object.entries(changes)){
    if(key==="itemType" && !TYPES.has(value))invalid("Invalid listing update");
    if(key==="market" && !MARKETS.has(value))invalid("Invalid listing update");
    if(key==="symbol" && (typeof value!=="string"||!SYMBOL.test(value)))invalid("Invalid listing update");
    if(key==="name" && (typeof value!=="string"||!value.trim()||value.trim().length>120))
      invalid("Invalid listing update");
    if(key==="status" && !["DRAFT","PUBLISHED"].includes(value))invalid("Invalid listing update");
    prepared[key]=key==="name"?value.trim():value;
  }
  // Published instrument metadata cannot change until the master withdraws it.
  // This also prevents a concurrent publish from racing with a metadata edit.
  const changesMetadata=Object.keys(prepared).some(key=>key!=="status");
  const keys=Object.keys(prepared);
  const updates=keys.map((key,index)=>allowedColumns[key]+"=$"+(index+2));
  const identityChecks=keys.flatMap((key,index)=>["itemType","market","symbol"].includes(key)?
    [allowedColumns[key]+" IS NOT DISTINCT FROM $"+(index+2)]:[]);
  const params=[id,...keys.map(key=>prepared[key])];
  const sql="UPDATE listings SET "+updates.join(",")+",updated_at=now() WHERE id=$1"+
    (changesMetadata?" AND status='DRAFT'":"")+
    (identityChecks.length?" AND (("+identityChecks.join(" AND ")+") OR NOT EXISTS (SELECT 1 FROM internal_purchases p JOIN internal_product_terms t ON t.id=p.terms_id WHERE t.listing_id=listings.id))":"")+
    " RETURNING id";
  const r=await db.query(sql,params);
  if(r.rows.length!==1)invalid(changesMetadata?"Listing not found, not a draft, or traded identity is protected":"Listing not found");
  return {id,...prepared};
}
