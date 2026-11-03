import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createApi} from "../src/http-api.mjs";
import {createListing,updateListing,adminLogin,recoverPendingMaster} from "../src/admin-service.mjs";
import {hashPassword} from "../src/auth.mjs";

test("master and subadmin authenticate with password only and reject wrong password",async()=>{
  const userId=randomUUID(),accountId=randomUUID(),hash=await hashPassword("correct-password-2026");
  const queries=[];
  const db={query:async(sql,params)=>{
    queries.push(sql);
    if(sql.includes("SELECT u.id,u.password_hash"))return {rows:[{id:userId,account_id:accountId,password_hash:hash,role:"MASTER"}]};
    return {rows:[]};
  }};
  const signed=await adminLogin(db,{email:"admin@example.test",password:"correct-password-2026"});
  assert.equal(signed.role,"MASTER");assert.ok(signed.token.length>=32);
  assert.ok(queries.some(sql=>sql.includes("admin_verified_at")));
  await assert.rejects(adminLogin(db,{email:"admin@example.test",password:"wrong-password-2026"}),e=>e.statusCode===401);
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
