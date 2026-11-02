import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createApi} from "../src/http-api.mjs";
import {newTotpSecret,currentOtp,checkOtp} from "../src/totp.mjs";
import {protectTotp,unprotectTotp,matchBootstrapKey} from "../src/admin-secrets.mjs";
import {createListing} from "../src/admin-service.mjs";

test("administrator 2FA is six digits and refuses invalid or expired codes",()=>{
  const secret=newTotpSecret(),instant=Date.UTC(2026,10,2,12,0,0);
  assert.match(secret,/^[A-Z2-7]{32}$/);
  const code=currentOtp(secret,instant);
  assert.match(code,/^[0-9]{6}$/);
  assert.equal(checkOtp(secret,code,instant),true);
  assert.equal(checkOtp(secret,code,instant+31000),true);
  assert.equal(checkOtp(secret,code,instant+120000),false);
  assert.equal(checkOtp(secret,"abcdef",instant),false);
});
test("2FA values are encrypted and bootstrap proofs must match",()=>{
  const previousKey=process.env.ADMIN_TOTP_ENCRYPTION_KEY;
  const previousProof=process.env.ADMIN_BOOTSTRAP_SECRET;
  try {
    process.env.ADMIN_TOTP_ENCRYPTION_KEY="a".repeat(64);
    process.env.ADMIN_BOOTSTRAP_SECRET="b".repeat(64);
    const secret=newTotpSecret(),ciphertext=protectTotp(secret);
    assert.equal(ciphertext.includes(secret),false);
    assert.equal(unprotectTotp(ciphertext),secret);
    const tampered=ciphertext.split(".");tampered[1]="AAAAAAAAAAAAAAAAAAAAAA";
    assert.throws(()=>unprotectTotp(tampered.join(".")));
    assert.equal(matchBootstrapKey("b".repeat(64)),true);
    assert.equal(matchBootstrapKey("c".repeat(64)),false);
  }finally{
    if(previousKey===undefined)delete process.env.ADMIN_TOTP_ENCRYPTION_KEY;
    else process.env.ADMIN_TOTP_ENCRYPTION_KEY=previousKey;
    if(previousProof===undefined)delete process.env.ADMIN_BOOTSTRAP_SECRET;
    else process.env.ADMIN_BOOTSTRAP_SECRET=previousProof;
  }
});
test("master can publish a directory entry without purchase or discount fields",async()=>{
  const queries=[];
  const result=await createListing({query:async(sql,params)=>{queries.push({sql,params});return {rows:[]};}},
    {role:"MASTER",userId:randomUUID()},
    {itemType:"STOCK",market:"US",symbol:"AAPL",name:"Apple Inc.",status:"PUBLISHED"});
  assert.equal(result.status,"PUBLISHED");
  assert.equal("simulationOnly" in result,false);
  assert.equal("discountPercent" in result,false);
  assert.equal(queries.length,1);
  assert.equal(queries[0].params[5],0);
});
test("subaccounts cannot publish stock fund or IPO listings",async()=>{
  for(const type of ["STOCK","FUND","IPO"]){
    await assert.rejects(createListing({}, {role:"SUBADMIN",userId:randomUUID()}, {
      itemType:type,market:"US",symbol:"AAPL",name:"Test",discountPercent:25,purchasePassword:"secure-test-password"
    }),/Only master/);
  }
});
async function withServer(resolveSession,fn){
  const db={query:async()=>({rows:[]}),connect:async()=>({query:async()=>({rows:[]}),release(){}})};
  const app=createApi({db,resolveSession});
  await new Promise(done=>app.listen(0,"127.0.0.1",done));
  try{await fn("http://127.0.0.1:"+app.address().port)}
  finally{await new Promise(done=>app.close(done))}
}
test("administrator API rejects missing and ordinary customer tokens",async()=>{
  await withServer(async token=>token==="customer"?{accountId:"acct",userId:"user",adminVerified:false}:null,async base=>{
    for(const path of ["/api/admin/me","/api/admin/subaccounts","/api/admin/clients","/api/admin/listings"]){
      const missing=await fetch(base+path);
      assert.equal(missing.status,401);
      const customer=await fetch(base+path,{headers:{authorization:"Bearer customer"}});
      assert.equal(customer.status,403);
    }
  });
});
