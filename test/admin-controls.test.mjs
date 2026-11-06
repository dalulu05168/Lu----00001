import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createApi} from "../src/http-api.mjs";
import {createListing,updateListing,adminLogin,verifyAdminTotp,recoverPendingMaster} from "../src/admin-service.mjs";
import {hashPassword} from "../src/auth.mjs";
import {adminTotpKey,openTotpSecret} from "../src/admin-totp-storage.mjs";
import {totpCode} from "../src/totp.mjs";

function makeAdminDb({userId,accountId,passwordHash,role}){
  const state={totpSecretCiphertext:null,totpConfirmedAt:null,challenge:null,clientQueries:[]};
  const db={
    query:async(sql,params)=>{
      if(sql.includes("SELECT u.id,u.password_hash"))return {rows:[{
        id:userId,password_hash:passwordHash,account_id:accountId,role,
        totp_secret_ciphertext:state.totpSecretCiphertext,totp_confirmed_at:state.totpConfirmedAt
      }]};
      if(sql.includes("UPDATE admin_roles SET totp_secret_ciphertext")){state.totpSecretCiphertext=params[1];return {rows:[]};}
      if(sql.includes("INSERT INTO admin_totp_challenges")){
        state.challenge={id:params[0],userId:params[1],tokenHash:params[2],setup:params[3],expiresAt:params[4],attempts:0};
        return {rows:[]};
      }
      return {rows:[]};
    },
    connect:async()=>({
      query:async(sql,params)=>{
        state.clientQueries.push(sql);
        if(sql.includes("FROM admin_totp_challenges c"))
          return state.challenge&&state.challenge.tokenHash===params[0]
            ?{rows:[{id:state.challenge.id,user_id:state.challenge.userId,setup:state.challenge.setup,
                attempts:state.challenge.attempts,expires_at:state.challenge.expiresAt,
                role,totp_secret_ciphertext:state.totpSecretCiphertext,account_id:accountId}]}
            :{rows:[]};
        if(sql.includes("UPDATE admin_totp_challenges SET attempts")){state.challenge.attempts++;return {rows:[]};}
        if(sql.includes("UPDATE admin_roles SET totp_confirmed_at")){state.totpConfirmedAt=new Date();return {rows:[]};}
        if(sql.includes("DELETE FROM admin_totp_challenges")){state.challenge=null;return {rows:[]};}
        return {rows:[]};
      },
      release(){}
    })
  };
  return {db,state};
}

test("master authenticates with password then a TOTP code, rejecting wrong password and wrong code",async()=>{
  const previousKey=process.env.ADMIN_TOTP_KEY;
  process.env.ADMIN_TOTP_KEY="a".repeat(64);
  try{
    const userId=randomUUID(),accountId=randomUUID(),hash=await hashPassword("correct-password-2026");
    const {db,state}=makeAdminDb({userId,accountId,passwordHash:hash,role:"MASTER"});
    await assert.rejects(adminLogin(db,{email:"admin@example.test",password:"wrong-password-2026"}),e=>e.statusCode===401);

    const step1=await adminLogin(db,{email:"admin@example.test",password:"correct-password-2026"});
    assert.equal(step1.totpSetupRequired,true);
    assert.ok(step1.secret);assert.ok(step1.pendingToken);

    const secret=openTotpSecret(state.totpSecretCiphertext,adminTotpKey(),userId);
    const realCode=totpCode(secret),wrongCode=realCode==="000000"?"111111":"000000";
    await assert.rejects(verifyAdminTotp(db,{pendingToken:step1.pendingToken,code:wrongCode}),e=>e.statusCode===401);

    const signed=await verifyAdminTotp(db,{pendingToken:step1.pendingToken,code:realCode});
    assert.equal(signed.role,"MASTER");assert.ok(signed.token.length>=32);
    assert.ok(state.clientQueries.some(sql=>sql.includes("admin_verified_at")));
  }finally{
    if(previousKey===undefined)delete process.env.ADMIN_TOTP_KEY;
    else process.env.ADMIN_TOTP_KEY=previousKey;
  }
});

test("an already-enrolled admin's second login only asks for a TOTP code, not setup",async()=>{
  const previousKey=process.env.ADMIN_TOTP_KEY;
  process.env.ADMIN_TOTP_KEY="a".repeat(64);
  try{
    const userId=randomUUID(),accountId=randomUUID(),hash=await hashPassword("correct-password-2026");
    const {db,state}=makeAdminDb({userId,accountId,passwordHash:hash,role:"MASTER"});
    await adminLogin(db,{email:"admin@example.test",password:"correct-password-2026"});
    const enrolled=await adminLogin(db,{email:"admin@example.test",password:"correct-password-2026"});
    assert.equal(enrolled.totpSetupRequired,true,"reused secret until confirmed");
    const secret=openTotpSecret(state.totpSecretCiphertext,adminTotpKey(),userId);
    await verifyAdminTotp(db,{pendingToken:enrolled.pendingToken,code:totpCode(secret)});

    const step1=await adminLogin(db,{email:"admin@example.test",password:"correct-password-2026"});
    assert.equal(step1.totpRequired,true);
    assert.equal(step1.totpSetupRequired,undefined);
    assert.equal(step1.secret,undefined);
    const signed=await verifyAdminTotp(db,{pendingToken:step1.pendingToken,code:totpCode(secret)});
    assert.equal(signed.role,"MASTER");
  }finally{
    if(previousKey===undefined)delete process.env.ADMIN_TOTP_KEY;
    else process.env.ADMIN_TOTP_KEY=previousKey;
  }
});

test("pending-master reset requires strong setup proof and refuses wrong credentials",async()=>{
  const previousEmail=process.env.ADMIN_MASTER_EMAIL;
  const previousSecret=process.env.ADMIN_BOOTSTRAP_SECRET;
  process.env.ADMIN_MASTER_EMAIL="master@example.test";
  process.env.ADMIN_BOOTSTRAP_SECRET="b".repeat(64);
  try{
    await assert.rejects(recoverPendingMaster({connect(){throw Error("should not reach db")}},{
      email:"master@example.test",password:"new-long-password-2026",setupKey:"bad-proof"
    }),/Invalid setup proof/);
  }finally{
    if(previousEmail===undefined)delete process.env.ADMIN_MASTER_EMAIL;
    else process.env.ADMIN_MASTER_EMAIL=previousEmail;
    if(previousSecret===undefined)delete process.env.ADMIN_BOOTSTRAP_SECRET;
    else process.env.ADMIN_BOOTSTRAP_SECRET=previousSecret;
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
  assert.match(queries[0].sql,/VALUES\(\$1,\$2,\$3,\$4,\$5,0,\$6,\$7,\$8\)/);
  assert.equal(typeof queries[0].params[5],"string");
});
test("securities directory rejects legacy purchase and discount fields",async()=>{
  const actor={role:"MASTER",userId:randomUUID()};
  await assert.rejects(createListing({},actor,{
    itemType:"STOCK",market:"US",symbol:"AAPL",name:"Apple Inc.",discountPercent:12
  }),/Unexpected listing fields/);
  await assert.rejects(createListing({},actor,{
    itemType:"STOCK",market:"US",symbol:"AAPL",name:"Apple Inc.",purchasePassword:"long-password-123"
  }),/Unexpected listing fields/);
  await assert.rejects(updateListing({},actor,{
    id:randomUUID(),status:"PUBLISHED",purchasePassword:"long-password-123"
  }),/Invalid listing update/);
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
