import { randomBytes, createHmac } from "node:crypto";
const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newTotpSecret(){
  const source=randomBytes(20);let bits=0,number=0,output="";
  for(const byte of source){
    number=(number<<8)|byte;bits+=8;
    while(bits>=5){bits-=5;output+=alphabet[(number>>>bits)&31];}
  }
  return output;
}
function bytesFromBase32(secret){
  if(typeof secret!=="string"||!/^[A-Z2-7]{32}$/.test(secret))throw Error("Invalid OTP configuration");
  let bits=0,number=0,bytes=[];
  for(const ch of secret){
    number=(number<<5)|alphabet.indexOf(ch);bits+=5;
    if(bits>=8){bits-=8;bytes.push((number>>>bits)&255);}
  }
  return Buffer.from(bytes);
}
export function currentOtp(secret,at=Date.now()){
  const time=Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(Math.floor(at/30000)));
  const hash=createHmac("sha1",bytesFromBase32(secret)).update(time).digest();
  const position=hash[19]&15;
  return String((hash.readUInt32BE(position)&0x7fffffff)%1000000).padStart(6,"0");
}
export function matchingTotpStep(secret,code,at=Date.now()){
  if(typeof code!=="string"||!/^\\d{6}$/.test(code))return null;
  const nowStep=Math.floor(at/30000);
  // Most recent matching time step first; avoid accepting a reused older step.
  for(const offset of [1,0,-1]){
    const candidate=(nowStep+offset)*30000;
    if(candidate>=0 && currentOtp(secret,candidate)===code)return nowStep+offset;
  }
  return null;
}
export function checkOtp(secret,code,at=Date.now()){
  return matchingTotpStep(secret,code,at)!==null;
}
