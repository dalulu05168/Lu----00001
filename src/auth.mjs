import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash} from "node:crypto";
import {promisify} from "node:util";
const scrypt=promisify(scryptCallback);
const HASH_PREFIX="scrypt";
export async function hashPassword(password){
 if(typeof password!=="string"||password.length<12||Buffer.byteLength(password)>1024)throw new Error("Invalid password");
 const salt=randomBytes(16);
 const derived=await scrypt(password,salt,64);
 return [HASH_PREFIX,salt.toString("hex"),derived.toString("hex")].join("$");
}
export async function verifyPassword(password,stored){
 if(typeof password!=="string"||typeof stored!=="string")return false;
 const [method,salt,hash,...extra]=stored.split("$");
 if(method!==HASH_PREFIX||extra.length||!/^[0-9a-f]{32}$/.test(salt)||!/^[0-9a-f]{128}$/.test(hash))return false;
 const expected=Buffer.from(hash,"hex");
 const actual=await scrypt(password,Buffer.from(salt,"hex"),expected.length);
 return timingSafeEqual(actual,expected);
}
export function generateSessionToken(){return randomBytes(32).toString("base64url");}
export function sessionTokenHash(token){
 if(typeof token!=="string"||token.length<32||token.length>256)throw new Error("Invalid session token");
 return createHash("sha256").update(token).digest("hex");
}
export async function createSession(db,{userId,accountId,expiresAt,adminVerified=false}){
 if(!userId||!accountId||!(expiresAt instanceof Date)||expiresAt<=new Date())throw new Error("Invalid session");
 const token=generateSessionToken();
 await db.query(adminVerified
    ? "INSERT INTO user_sessions(token_hash,user_id,account_id,expires_at,admin_verified_at) VALUES($1,$2,$3,$4,now())"
    : "INSERT INTO user_sessions(token_hash,user_id,account_id,expires_at) VALUES($1,$2,$3,$4)",
  [sessionTokenHash(token),userId,accountId,expiresAt]);
 return token;
}
export function createSessionResolver(db){
 return async function resolveSession(token){
  let tokenHash;
  try{tokenHash=sessionTokenHash(token);}catch{return null;}
  const r=await db.query(`SELECT s.account_id,s.user_id,s.admin_verified_at FROM user_sessions s
   JOIN accounts a ON a.id=s.account_id AND a.user_id=s.user_id
   LEFT JOIN client_admin_policies p ON p.user_id=s.user_id
   WHERE s.token_hash=$1 AND s.expires_at>now() AND s.revoked_at IS NULL
   AND (s.admin_verified_at IS NOT NULL OR COALESCE(p.login_allowed,true)=true)`,[tokenHash]);
  return r.rows.length===1?{accountId:r.rows[0].account_id,userId:r.rows[0].user_id,adminVerified:Boolean(r.rows[0].admin_verified_at)}:null;
 };
}
export async function revokeSession(db,token){
 await db.query("UPDATE user_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL",[sessionTokenHash(token)]);
}
