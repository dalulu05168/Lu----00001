import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {submitClientRequest,listClientRequests,listAdminRequests,reviewAdminRequest} from "../src/operational-workflows.mjs";

test("operational intake validates amounts, bank privacy, and never receives a balance field",async()=>{
 const id=randomUUID();
 const db={connect(){throw Error("should not reach database")}};
 await assert.rejects(submitClientRequest(db,id,"FUNDING",{kind:"DEPOSIT",amountCents:0}),e=>e.statusCode===400);
 await assert.rejects(submitClientRequest(db,id,"FUNDING",{kind:"WITHDRAWAL",amountCents:123.45}),e=>e.statusCode===400);
 await assert.rejects(submitClientRequest(db,id,"FUNDING",{kind:"DEPOSIT",amountCents:400,balance:1000}),e=>e.statusCode===400);
 await assert.rejects(submitClientRequest(db,id,"BANK_LINK",{bankLabel:"Bank",accountLast4:"0000000000123456"}),e=>e.statusCode===400);
 await assert.rejects(submitClientRequest(db,id,"KYC",{passport:"secret"}),e=>e.statusCode===400);
 await assert.rejects(submitClientRequest(db,id,"UNKNOWN",{}),e=>e.statusCode===400);
});
test("subadmin review cannot approve a money request or bypass scoped ownership",async()=>{
 const clientId=randomUUID(),requestId=randomUUID(),owner={role:"SUBADMIN",userId:randomUUID()};
 const wrong={role:"SUBADMIN",userId:randomUUID()};
 const previous={id:requestId,client_user_id:clientId,kind:"DEPOSIT",amount_cents:1000,currency:"USD",status:"SUBMITTED"};
 const q=[];
 const connection={
  async query(sql,params=[]){
   q.push({sql,params});
   if(sql.includes("SELECT r.*")&&sql.includes("FOR UPDATE OF r"))return {rows:params[2]===owner.userId?[previous]:[]};
   return {rows:[]};
  },
  release(){}
 };
 const db={connect:async()=>connection,query:async()=>({rows:[]})};
 const body={id:requestId,expectedStatus:"SUBMITTED",status:"APPROVED",reason:"Checked payment request against internal checklist"};
 await assert.rejects(reviewAdminRequest(db,owner,"FUNDING",body),e=>e.statusCode===403);
 await assert.rejects(reviewAdminRequest(db,wrong,"FUNDING",{...body,status:"UNDER_REVIEW"}),e=>e.statusCode===404);
 await assert.rejects(reviewAdminRequest(db,owner,"FUNDING",{...body,status:"UNDER_REVIEW",reason:"short"}),e=>e.statusCode===400);
 assert.equal(q.filter(x=>x.sql==="ROLLBACK").length,2);
 assert.equal(q.some(x=>x.sql.includes("UPDATE client_funding_requests")),false);
});
test("client list reads only the authenticated user and admin dashboard filters by linkage",async()=>{
 const id=randomUUID(),actor={role:"SUBADMIN",userId:randomUUID()},sql=[];
 const db={query:async(s,p)=>{sql.push({s,p});return {rows:[]}}};
 assert.deepEqual(await listClientRequests(db,id,"FUNDING"),[]);
 assert.deepEqual(await listAdminRequests(db,actor,"FUNDING"),[]);
 assert.deepEqual(await listAdminRequests(db,actor,"FUNDING",id),[]);
 await assert.rejects(listAdminRequests(db,actor,"FUNDING","invalid"),e=>e.statusCode===400);
 assert.match(sql[0].s,/WHERE client_user_id=\$1/);assert.deepEqual(sql[0].p,[id]);
 assert.match(sql[1].s,/l.subadmin_user_id=\$2::uuid/);
 assert.match(sql[1].s,/r.client_user_id=\$3::uuid/);
 assert.deepEqual(sql[1].p,["SUBADMIN",actor.userId,null]);
 assert.deepEqual(sql[2].p,["SUBADMIN",actor.userId,id]);
});
