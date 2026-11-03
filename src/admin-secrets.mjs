import {createCipheriv,createDecipheriv,randomBytes,timingSafeEqual} from "node:crypto";

function key() {
  const value=process.env.ADMIN_TOTP_ENCRYPTION_KEY;
  if(typeof value!=="string")throw new Error("Admin encryption key is not configured");
  // The existing 64-hex secret remains byte-for-byte compatible.
  if(/^[a-fA-F0-9]{64}$/.test(value))return Buffer.from(value,"hex");
  // Render's generateValue produces a base64-encoded 256-bit random secret.
  if(/^[A-Za-z0-9+/]{43}=$/.test(value)){
    const decoded=Buffer.from(value,"base64");
    if(decoded.length===32&&decoded.toString("base64")===value)return decoded;
  }
  throw new Error("Admin encryption key is not configured");
}
export function protectTotp(value){
  if(typeof value!=="string"||value.length!==32)throw new Error("Invalid 2FA setup");
  const iv=randomBytes(12);
  const cipher=createCipheriv("aes-256-gcm",key(),iv);
  const encrypted=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
  return [iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),encrypted.toString("base64url")].join(".");
}
export function unprotectTotp(value){
  const parts=typeof value==="string"?value.split("."):[];
  if(parts.length!==3)throw new Error("Invalid protected configuration");
  const [iv,tag,data]=parts.map(x=>Buffer.from(x,"base64url"));
  if(iv.length!==12||tag.length!==16)throw new Error("Invalid protected configuration");
  const cipher=createDecipheriv("aes-256-gcm",key(),iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data),cipher.final()]).toString("utf8");
}
export function matchBootstrapKey(given){
  const expected=process.env.ADMIN_BOOTSTRAP_SECRET;
  if(typeof given!=="string"||typeof expected!=="string"||expected.length<32)return false;
  const a=Buffer.from(given),b=Buffer.from(expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}
