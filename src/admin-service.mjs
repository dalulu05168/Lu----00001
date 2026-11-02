import {randomUUID,randomInt} from "node:crypto";
import {hashPassword,verifyPassword,createSession} from "./auth.mjs";
import {newTotpSecret as generateTotpSecret,currentOtp,checkOtp} from "./totp.mjs";
import {protectTotp,unprotectTotp,matchBootstrapKey} from "./admin-secrets.mjs";

const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SYMBOL=/^[A-Z0-9][A-Z0-9.-]{0,23}$/;
const MARKETS=new Set(["US","HK","CN","MY"]);
const TYPES=new Set(["STOCK","FUND","IPO"]);
function invalid(message){const error=new Error(message);error.statusCode=400;throw error;}
function getEmail(value) {
  if(typeof value!=="string"||value.length>254||!EMAIL.test(value))invalid("Invalid email");
  return value.trim().toLowerCase();
}
function safeListing(value,withPassword=true){
  if(!value||typeof value!=="object"||Array.isArray(value))invalid("Invalid listing");
  const {itemType,market,symbol,name,discountPercent,purchasePassword,status="DRAFT"}=value;
  if(!TYPES.has(itemType)||!MARKETS.has(market)||typeof symbol!=="string"||!SYMBOL.test(symbol)||
     typeof name!=="string"||!name.trim()||name.length>120||
     !Number.isInteger(discountPercent)||discountPercent<0||discountPercent>100||
     !["DRAFT","PUBLISHED"].includes(status))invalid("Invalid listing fields");
  if(withPassword&&(typeof purchasePassword!=="string"||purchasePassword.length<12))invalid("Invalid purchase password");
  return {itemType,market,symbol,name:name.trim(),discountBps:discountPercent*100,status,purchasePassword};
}

export async function roleFor(db,session) {
  if(!session?.userId||session.adminVerified!==true)return null;
  const r=await db.query(`SELECT user_id,role,parent_user_id FROM admin_roles
    WHERE user_id=$1 AND twofa_confirmed_at IS NOT NULL`,[session.userId]);
  return r.rows.length===1 ? {
    userId:r.rows[0].user_id,role:r.rows[0].role,parentUserId:r.rows[0].parent_user_id
  }:null;
}
export async function bootstrapMaster(db,{email,password,setupKey}){
  const authorizedEmail=process.env.ADMIN_MASTER_EMAIL?.trim().toLowerCase();
  if(!authorizedEmail)invalid("Master setup is not configured");
  const normalized=getEmail(email);
  if(normalized!==authorizedEmail)invalid("Master account is not authorized");
  if(!matchBootstrapKey(setupKey))invalid("Invalid setup proof");
  const passwordHash=await hashPassword(password);
  const secret=generateTotpSecret(),protectedSecret=protectTotp(secret);
  const userId=randomUUID(),accountId=randomUUID();
  const client=await db.connect();
  let begun=false;
  try{
    await client.query("BEGIN");begun=true;
    // A unique partial index enforces one master even for simultaneous requests.
    const exists=await client.query("SELECT user_id FROM admin_roles WHERE role='MASTER' FOR UPDATE");
    if(exists.rows.length)invalid("Master already provisioned");
    const occupied=await client.query("SELECT id FROM app_users WHERE email=$1 FOR UPDATE",[normalized]);
    if(occupied.rows.length)invalid("Master email is already registered");
    await client.query("INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3)",[userId,normalized,passwordHash]);
    await client.query("INSERT INTO accounts(id,user_id,cash_cents) VALUES($1,$2,0)",[accountId,userId]);
    await client.query("INSERT INTO admin_roles(user_id,role,totp_secret_ciphertext) VALUES($1,'MASTER',$2)",[userId,protectedSecret]);
    await client.query("COMMIT");begun=false;
    return {role:"MASTER",totpSecret:secret,
      setupUri:"otpauth://totp/GlobalStockPlatform:"+encodeURIComponent(normalized)+
        "?secret="+secret+"&issuer=GlobalStockPlatform"};
  }catch(error){if(begun)await client.query("ROLLBACK");throw error;}
  finally{client.release();}
}
export async function confirmAdminTotp(db,{email,password,otp}){
  if(typeof password!=="string"||typeof otp!=="string")invalid("Invalid enrollment credentials");
  const normalized=getEmail(email);
  const r=await db.query(`SELECT a.user_id,a.role,a.totp_secret_ciphertext,
    a.twofa_confirmed_at,u.password_hash
    FROM admin_roles a JOIN app_users u ON u.id=a.user_id WHERE u.email=$1`,[normalized]);
  if(r.rows.length!==1||r.rows[0].twofa_confirmed_at)invalid("Admin enrollment unavailable");
  if(!(await verifyPassword(password,r.rows[0].password_hash)) ||
      !checkOtp(unprotectTotp(r.rows[0].totp_secret_ciphertext),otp)){
    const error=new Error("Invalid enrollment credentials");error.statusCode=401;throw error;
  }
  await db.query("UPDATE admin_roles SET twofa_confirmed_at=now() WHERE user_id=$1 AND twofa_confirmed_at IS NULL",[r.rows[0].user_id]);
  // Do not block new customer registrations until a subadmin invite is ready.
  if(r.rows[0].role==="SUBADMIN")
    await db.query("UPDATE registration_policy SET invite_required=true WHERE id=1");
  return {activated:true,role:r.rows[0].role};
}
export async function adminLogin(db,{email,password,otp}){
  if(typeof password!=="string"||typeof otp!=="string")invalid("Invalid admin login");
  const r=await db.query(`SELECT u.id,u.password_hash,a.id AS account_id,r.role,r.totp_secret_ciphertext
    FROM app_users u JOIN accounts a ON a.user_id=u.id
    JOIN admin_roles r ON r.user_id=u.id AND r.twofa_confirmed_at IS NOT NULL
    WHERE u.email=$1`,[getEmail(email)]);
  if(r.rows.length!==1||!(await verifyPassword(password,r.rows[0].password_hash))||
     !checkOtp(unprotectTotp(r.rows[0].totp_secret_ciphertext),otp)) {
    const error=new Error("Invalid admin credentials");error.statusCode=401;throw error;
  }
  const row=r.rows[0],expiresAt=new Date(Date.now()+30*60*1000);
  const token=await createSession(db,{userId:row.id,accountId:row.account_id,expiresAt,adminVerified:true});
  return {token,role:row.role,expiresAt:expiresAt.toISOString()};
}
export async function createSubadmin(db,actor,{email,password}){
  if(actor?.role!=="MASTER")invalid("Only master can create subadmins");
  const normalized=getEmail(email),passwordHash=await hashPassword(password);
  const secret=generateTotpSecret(),encrypted=protectTotp(secret);
  const userId=randomUUID(),accountId=randomUUID(),inviteId=randomUUID();
  const client=await db.connect();let begun=false;
  try{
    await client.query("BEGIN");begun=true;
    await client.query("INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3)",[userId,normalized,passwordHash]);
    await client.query("INSERT INTO accounts(id,user_id,cash_cents) VALUES($1,$2,0)",[accountId,userId]);
    await client.query(`INSERT INTO admin_roles(user_id,role,parent_user_id,totp_secret_ciphertext)
      VALUES($1,'SUBADMIN',$2,$3)`,[userId,actor.userId,encrypted]);
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
    return {userId,email:normalized,inviteCode,totpSecret:secret,
      setupUri:"otpauth://totp/GlobalStockPlatform:"+encodeURIComponent(normalized)+
        "?secret="+secret+"&issuer=GlobalStockPlatform"};
  }catch(error){if(begun)await client.query("ROLLBACK");throw error;}
  finally{client.release();}
}
export async function listSubadmins(db,actor){
  if(actor?.role==="MASTER"){
    const r=await db.query(`SELECT a.user_id,u.email,a.twofa_confirmed_at,i.code,i.expires_at,i.uses,i.max_uses
      FROM admin_roles a JOIN app_users u ON u.id=a.user_id
      LEFT JOIN invite_codes i ON i.subadmin_user_id=a.user_id
      WHERE a.role='SUBADMIN' AND a.parent_user_id=$1 ORDER BY a.created_at DESC`,[actor.userId]);
    return r.rows;
  }
  if(actor?.role==="SUBADMIN"){
    const r=await db.query(`SELECT a.user_id,u.email,a.twofa_confirmed_at,i.code,i.expires_at,i.uses,i.max_uses
      FROM admin_roles a JOIN app_users u ON u.id=a.user_id
      LEFT JOIN invite_codes i ON i.subadmin_user_id=a.user_id WHERE a.user_id=$1`,[actor.userId]);
    return r.rows;
  }
  return [];
}
export async function listClients(db,actor){
  const params=actor.role==="MASTER" ? [] : [actor.userId];
  const where=actor.role==="MASTER" ? "" : "WHERE c.subadmin_user_id=$1";
  const r=await db.query(`SELECT u.id,u.email,c.subadmin_user_id,c.created_at FROM client_links c
    JOIN app_users u ON u.id=c.user_id ${where} ORDER BY c.created_at DESC LIMIT 500`,params);
  return r.rows;
}
export async function createListing(db,actor,data){
  if(actor?.role!=="MASTER")invalid("Only master can publish listings");
  const item=safeListing(data);
  const hash=await hashPassword(item.purchasePassword),id=randomUUID();
  await db.query(`INSERT INTO listings(id,item_type,market,symbol,display_name,discount_bps,purchase_password_hash,status,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id,item.itemType,item.market,item.symbol,item.name,item.discountBps,hash,item.status,actor.userId]);
  return {id,itemType:item.itemType,market:item.market,symbol:item.symbol,name:item.name,
    discountPercent:item.discountBps/100,status:item.status,simulationOnly:true};
}
export async function listListings(db,actor){
  if(!actor)return [];
  const r=await db.query(`SELECT id,item_type,market,symbol,display_name,discount_bps,status,created_at
    FROM listings ORDER BY created_at DESC LIMIT 300`);
  return r.rows.map(x=>({id:x.id,itemType:x.item_type,market:x.market,symbol:x.symbol,
    name:x.display_name,discountPercent:x.discount_bps/100,status:x.status,simulationOnly:true}));
}
export async function updateListing(db,actor,{id,discountPercent,status,purchasePassword}){
  if(actor?.role!=="MASTER")invalid("Only master can edit listings");
  if(typeof id!=="string"||!/^[0-9a-f-]{36}$/.test(id)||
     !Number.isInteger(discountPercent)||discountPercent<0||discountPercent>100||
     !["DRAFT","PUBLISHED"].includes(status))invalid("Invalid listing update");
  let hash=null;
  if(purchasePassword!==undefined)hash=await hashPassword(purchasePassword);
  const r=await db.query(`UPDATE listings SET discount_bps=$2,status=$3,
    purchase_password_hash=COALESCE($4,purchase_password_hash),updated_at=now()
    WHERE id=$1 RETURNING id`,[id,discountPercent*100,status,hash]);
  if(r.rows.length!==1)invalid("Listing not found");
  return {id,discountPercent,status,simulationOnly:true};
}
