import {randomBytes,createHmac,timingSafeEqual} from "node:crypto";

// RFC 4226 (HOTP) / RFC 6238 (TOTP), implemented with only node:crypto so no
// new dependency is introduced. Secrets are raw bytes; base32 is used only
// for display (manual entry into an authenticator app), never for storage.
const BASE32_ALPHABET="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS=30;
const DIGITS=6;

export function generateTotpSecret(){return randomBytes(20);}

export function base32Encode(buffer){
 let bits="",out="";
 for(const byte of buffer)bits+=byte.toString(2).padStart(8,"0");
 for(let i=0;i+5<=bits.length;i+=5)out+=BASE32_ALPHABET[parseInt(bits.slice(i,i+5),2)];
 const rem=bits.length%5;
 if(rem)out+=BASE32_ALPHABET[parseInt(bits.slice(-rem).padEnd(5,"0"),2)];
 while(out.length%8!==0)out+="=";
 return out;
}

function hotp(secret,counter){
 const counterBuffer=Buffer.alloc(8);
 counterBuffer.writeBigUInt64BE(BigInt(counter));
 const hmac=createHmac("sha1",secret).update(counterBuffer).digest();
 const offset=hmac[hmac.length-1]&0x0f;
 const bin=((hmac[offset]&0x7f)<<24)|((hmac[offset+1]&0xff)<<16)|((hmac[offset+2]&0xff)<<8)|(hmac[offset+3]&0xff);
 return String(bin%(10**DIGITS)).padStart(DIGITS,"0");
}

export function totpCode(secret,{now=Date.now(),step=STEP_SECONDS}={}){
 return hotp(secret,Math.floor(now/1000/step));
}

function timingSafeEqualStrings(a,b){
 const bufA=Buffer.from(a),bufB=Buffer.from(b);
 return bufA.length===bufB.length&&timingSafeEqual(bufA,bufB);
}

/**
 * Accepts a code from the current 30s step or one step either side, so a
 * slightly slow device/clock drift doesn't lock the admin out. Each
 * candidate is compared with a timing-safe comparison.
 */
export function verifyTotpCode(secret,code,{now=Date.now(),step=STEP_SECONDS,window=1}={}){
 if(typeof code!=="string"||!/^\d{6}$/.test(code))return false;
 const counter=Math.floor(now/1000/step);
 for(let drift=-window;drift<=window;drift++){
  if(timingSafeEqualStrings(hotp(secret,counter+drift),code))return true;
 }
 return false;
}

/** otpauth:// URI for authenticator apps that support "scan or paste a link". */
export function totpUri(secret,{email,issuer="CN Capital Admin"}={}){
 const label=encodeURIComponent(issuer)+":"+encodeURIComponent(email);
 return "otpauth://totp/"+label+"?secret="+base32Encode(secret)+
  "&issuer="+encodeURIComponent(issuer)+"&algorithm=SHA1&digits="+DIGITS+"&period="+STEP_SECONDS;
}
