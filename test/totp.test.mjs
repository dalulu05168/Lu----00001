import test from "node:test";
import assert from "node:assert/strict";
import {generateTotpSecret,base32Encode,totpCode,verifyTotpCode,totpUri} from "../src/totp.mjs";

// RFC 4226 Appendix D test vectors (ASCII secret "12345678901234567890").
const RFC4226_SECRET=Buffer.from("12345678901234567890","ascii");
const RFC4226_CODES=["755224","287082","359152","969429","338314","254676","287922","162583","399871","520489"];

test("matches the official RFC 4226 HOTP test vectors at each counter",()=>{
 for(let counter=0;counter<RFC4226_CODES.length;counter++){
  // 30s step, so time = counter*30 lands exactly on that counter.
  assert.equal(totpCode(RFC4226_SECRET,{now:counter*30*1000}),RFC4226_CODES[counter]);
 }
});

test("matches the official RFC 6238 TOTP vector at T=59s (counter 1, truncated to 6 digits)",()=>{
 // RFC 6238 Appendix B gives "94287082" (8 digits) for T=59s with this secret;
 // the last 6 digits of that are the 6-digit truncation used here.
 assert.equal(totpCode(RFC4226_SECRET,{now:59*1000}),"287082");
});

test("accepts a code from one step before/after for clock drift, rejects further drift",()=>{
 const secret=generateTotpSecret();
 const now=1700000000000;
 const current=totpCode(secret,{now});
 const previous=totpCode(secret,{now:now-30000});
 const twoStepsAway=totpCode(secret,{now:now-60000});
 assert.equal(verifyTotpCode(secret,current,{now}),true);
 assert.equal(verifyTotpCode(secret,previous,{now}),true);
 if(twoStepsAway!==current&&twoStepsAway!==previous){
  assert.equal(verifyTotpCode(secret,twoStepsAway,{now}),false);
 }
});

test("rejects malformed codes and codes for a different secret",()=>{
 const secret=generateTotpSecret(),other=generateTotpSecret();
 const now=1700000000000;
 assert.equal(verifyTotpCode(secret,"",{now}),false);
 assert.equal(verifyTotpCode(secret,"12345",{now}),false);
 assert.equal(verifyTotpCode(secret,"1234567",{now}),false);
 assert.equal(verifyTotpCode(secret,"abcdef",{now}),false);
 assert.equal(verifyTotpCode(secret,null,{now}),false);
 const wrongCode=totpCode(other,{now});
 if(wrongCode!==totpCode(secret,{now}))assert.equal(verifyTotpCode(secret,wrongCode,{now}),false);
});

test("base32 encoding round-trips readable groups and otpauth URI carries the issuer and email",()=>{
 const secret=RFC4226_SECRET;
 const encoded=base32Encode(secret);
 assert.match(encoded,/^[A-Z2-7]+=*$/);
 const uri=totpUri(secret,{email:"master@example.test",issuer:"CN Capital Admin"});
 assert.match(uri,/^otpauth:\/\/totp\//);
 assert.match(uri,/secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ/);
 assert.match(uri,/issuer=CN%20Capital%20Admin/);
 assert.match(uri,/master%40example\.test/);
 assert.match(uri,/digits=6/);
 assert.match(uri,/period=30/);
});
