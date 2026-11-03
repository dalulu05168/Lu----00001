import test from "node:test";
import assert from "node:assert/strict";
import {hashPassword} from "../src/auth.mjs";
import {getAccountDeletionRequest,requestAccountDeletion} from "../src/account-deletion-service.mjs";
import {createApi} from "../src/http-api.mjs";

const UUID="7ee43590-c724-45b2-b5c4-2aa0f9ee681e";
async function makeDb(){
 const hash=await hashPassword("a-test-password-123");
 const queries=[];
 const db={
  queries,
  async query(sql,values=[]){
   queries.push({sql,values});
   if(sql.includes("SELECT password_hash FROM app_users"))
     return {rows:values[0]===UUID?[{password_hash:hash}]:[]};
   if(sql.includes("INSERT INTO customer_account_deletion_requests"))
     return {rows:[{id:"request-id-1",status:"REQUESTED",requested_at:new Date("2026-11-04T00:00:00Z")}]};
   if(sql.includes("SELECT id,status,requested_at FROM customer_account_deletion_requests"))
     return {rows:[]};
   throw new Error("Unexpected DB query: "+sql);
  }
 };
 return db;
}
test("password confirmation is required and user ID is server-scoped",async()=>{
 const db=await makeDb();
 await assert.rejects(()=>requestAccountDeletion(db,UUID,{password:"bad-password",confirmation:"DELETE MY ACCOUNT"}),/Invalid deletion credentials/);
 await assert.rejects(()=>requestAccountDeletion(db,UUID,{password:"a-test-password-123",confirmation:"YES"}),/Invalid deletion confirmation/);
 const result=await requestAccountDeletion(db,UUID,{password:"a-test-password-123",confirmation:"DELETE MY ACCOUNT"});
 assert.equal(result.status,"REQUESTED");
 assert.equal(result.requestId,"request-id-1");
 const mutation=db.queries.find(x=>x.sql.includes("INSERT INTO customer_account_deletion_requests"));
 assert.equal(mutation.values[1],UUID);
 assert.equal(mutation.values.length,2);
 assert.match(mutation.sql,/ON CONFLICT\(client_user_id\)/);
});
test("status is NONE when no deletion request exists",async()=>{
 const db=await makeDb();
 assert.deepEqual(await getAccountDeletionRequest(db,UUID),{status:"NONE",requestId:null,requestedAt:null});
});
test("HTTP deletion endpoints enforce valid Bearer session, prevent impersonation and reflect request states",async()=>{
 const db=await makeDb();
 const server=createApi({db,resolveSession:async token=>token==="regular-token"?{userId:UUID,accountId:UUID}:token==="admin-token"?{userId:UUID,accountId:UUID,adminVerified:true}:null});
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const url="http://127.0.0.1:"+server.address().port;
 try{
   const anon=await fetch(url+"/api/account/deletion-request");
   assert.equal(anon.status,401);
   const admin=await fetch(url+"/api/account/deletion-request",{headers:{authorization:"Bearer admin-token"}});
   assert.equal(admin.status,403);
   const status=await fetch(url+"/api/account/deletion-request",{headers:{authorization:"Bearer regular-token"}});
   assert.deepEqual(await status.json(),{status:"NONE",requestId:null,requestedAt:null});
   const wrong=await fetch(url+"/api/account/deletion-request",{method:"POST",headers:{authorization:"Bearer regular-token","content-type":"application/json"},
     body:JSON.stringify({password:"nope",confirmation:"DELETE MY ACCOUNT"})});
   assert.equal(wrong.status,401);
   const injected=await fetch(url+"/api/account/deletion-request",{method:"POST",headers:{authorization:"Bearer regular-token","content-type":"application/json"},
     body:JSON.stringify({password:"a-test-password-123",confirmation:"DELETE MY ACCOUNT",clientId:"other-account"})});
   assert.equal(injected.status,400);
   const okay=await fetch(url+"/api/account/deletion-request",{method:"POST",headers:{authorization:"Bearer regular-token","content-type":"application/json"},
     body:JSON.stringify({password:"a-test-password-123",confirmation:"DELETE MY ACCOUNT"})});
   assert.equal(okay.status,202);
   assert.equal((await okay.json()).status,"REQUESTED");
   const page=await fetch(url+"/account-deletion");
   assert.equal(page.status,200);
   assert.match(await page.text(),/NuvexaPro/);
   const javascript=await fetch(url+"/account-deletion.mjs");
   assert.equal(javascript.status,200);
   assert.match(javascript.headers.get("content-type")||"",/javascript/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test("administrator deletion queue is role-scoped and cannot be read without a verified role",async()=>{
 const {listAdminDeletionRequests}=await import("../src/account-deletion-service.mjs");
 const observed=[];
 const db={query:async(sql,params)=>{
   observed.push({sql,params});
   return {rows:[{id:"request-2",client_user_id:UUID,email:"customer@example.org",
     status:"REQUESTED",requested_at:"2026-11-04T00:00:00Z"}]};
 }};
 await assert.rejects(()=>listAdminDeletionRequests(db,null),/permission required/i);
 const own=await listAdminDeletionRequests(db,{role:"SUBADMIN",userId:"subadmin-uuid"});
 assert.equal(own.items.length,1);
 assert.equal(own.items[0].email,"customer@example.org");
 assert.deepEqual(observed[0].params,["SUBADMIN","subadmin-uuid"]);
 assert.match(observed[0].sql,/l\.subadmin_user_id=\$2::uuid/);
 const all=await listAdminDeletionRequests(db,{role:"MASTER",userId:"master-uuid"});
 assert.equal(all.items.length,1);
 assert.deepEqual(observed[1].params,["MASTER","master-uuid"]);
});
test("admin risk pane exposes only queued deletion status, not fake deletion controls",async()=>{
 const {readFile}=await import("node:fs/promises");
 const html=await readFile(new URL("../web/admin.html",import.meta.url),"utf8");
 const js=await readFile(new URL("../web/admin.mjs",import.meta.url),"utf8");
 assert.match(html,/id="deletionQueueItems"/);
 assert.match(js,/refreshDeletionQueue/);
 assert.match(js,/textContent=.*item\.email/);
 assert.doesNotMatch(html,/id="completeCustomerErasure"/);
});
