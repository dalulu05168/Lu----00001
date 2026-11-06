import {randomBytes,createCipheriv,createDecipheriv} from "node:crypto";

// Same AES-256-GCM pattern as private-customer-data.mjs's sealPrivateData/
// openPrivateData, but with its own key: an admin's TOTP secret and a
// customer's KYC documents are different trust boundaries, so rotating or
// scoping one key never touches the other.
const fail=(message,statusCode=503)=>Object.assign(new Error(message),{statusCode});

export function adminTotpKey(value=process.env.ADMIN_TOTP_KEY){
 if(typeof value==="string"&&/^[0-9a-f]{64}$/i.test(value))return Buffer.from(value,"hex");
 if(typeof value==="string"&&/^[A-Za-z0-9+/]{43}=$/.test(value))return Buffer.from(value,"base64");
 throw fail("Admin 2FA storage is not configured");
}

function context(userId){return "admin-totp:v1:"+userId;}

export function sealTotpSecret(secret,key,userId){
 const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv);
 cipher.setAAD(Buffer.from(context(userId)));
 const bytes=Buffer.concat([cipher.update(secret),cipher.final()]);
 return ["v1",iv.toString("base64"),cipher.getAuthTag().toString("base64"),bytes.toString("base64")].join(".");
}

export function openTotpSecret(value,key,userId){
 const parts=typeof value==="string"?value.split("."):[];
 if(parts.length!==4||parts[0]!=="v1")throw fail("Stored 2FA secret cannot be opened");
 const iv=Buffer.from(parts[1],"base64"),tag=Buffer.from(parts[2],"base64");
 if(iv.length!==12||tag.length!==16)throw fail("Stored 2FA secret cannot be opened");
 const cipher=createDecipheriv("aes-256-gcm",key,iv);
 cipher.setAuthTag(tag);cipher.setAAD(Buffer.from(context(userId)));
 try{return Buffer.concat([cipher.update(Buffer.from(parts[3],"base64")),cipher.final()]);}
 catch{throw fail("Stored 2FA secret cannot be opened");}
}
