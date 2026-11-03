import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {listAdminClientHistoryPage} from "../src/operational-workflows.mjs";

test("customer history keyset pagination preserves ordering, cursor, and no duplicate records",async()=>{
 const clientId=randomUUID(),actor={role:"SUBADMIN",userId:randomUUID()};
 const firstId=randomUUID(),secondId=randomUUID();
 const entries=[
  {id:firstId,client_user_id:clientId,category:"FUNDING",kind:"DEPOSIT",amount_cents:900,currency:"USD",
   status:"SUBMITTED",created_at:new Date("2026-11-03T10:00:00Z")},
  {id:secondId,client_user_id:clientId,category:"KYC",status:"UNDER_REVIEW",
   created_at:new Date("2026-11-02T10:00:00Z")}
 ];
 const calls=[];
 const db={query:async(sql,params=[])=>{
  calls.push({sql,params});
  if(sql.startsWith("SELECT u.id FROM app_users"))return {rows:[{id:clientId}]};
  if(sql.startsWith("SELECT h.* FROM"))return {rows:params[2]===null?entries:[entries[1]]};
  throw Error("Unexpected SQL "+sql.slice(0,50));
 }};
 const a=await listAdminClientHistoryPage(db,actor,clientId,{limit:1});
 assert.equal(a.items.length,1);
 assert.equal(a.items[0].id,firstId);
 assert.equal(a.hasMore,true);
 assert.equal(typeof a.nextCursor,"string");
 const b=await listAdminClientHistoryPage(db,actor,clientId,{limit:1,cursor:a.nextCursor});
 assert.equal(b.items.length,1);
 assert.equal(b.items[0].id,secondId);
 assert.equal(b.hasMore,false);
 assert.equal(b.nextCursor,null);
 const paginated=calls.filter(c=>c.sql.startsWith("SELECT h.* FROM"));
 assert.equal(paginated.length,2);
 assert.match(paginated[0].sql,/UNION ALL/);
 assert.match(paginated[0].sql,/h\.created_at DESC,h\.id DESC,h\.category DESC/);
 assert.deepEqual(paginated[0].params,[clientId,2,null,null,null]);
 assert.equal(paginated[1].params[1],2);
 assert.equal(paginated[1].params[2],"2026-11-03T10:00:00.000Z");
 assert.equal(paginated[1].params[3],firstId);
 assert.equal(paginated[1].params[4],"FUNDING");
});

test("customer history rejects bad limits and forged cursors before DB reads",async()=>{
 const clientId=randomUUID(),actor={role:"MASTER",userId:randomUUID()};
 const db={query:async()=>{throw Error("DB should not be queried");}};
 for(const limit of [0,-1,51,1.2,NaN]){
  await assert.rejects(listAdminClientHistoryPage(db,actor,clientId,{limit}),e=>e.statusCode===400);
 }
 for(const cursor of ["malformed",Buffer.from("{}").toString("base64url"),
   Buffer.from(JSON.stringify(["2026-11-03T10:00:00.000Z",randomUUID(),"WRONG"])).toString("base64url")]){
  await assert.rejects(listAdminClientHistoryPage(db,actor,clientId,{cursor}),e=>e.statusCode===400);
 }
});

test("customer history denies an unrelated subadmin before reading records",async()=>{
 const clientId=randomUUID(),actor={role:"SUBADMIN",userId:randomUUID()};
 const seen=[];
 const db={query:async(sql,params=[])=>{
  seen.push({sql,params});
  return {rows:[]};
 }};
 await assert.rejects(listAdminClientHistoryPage(db,actor,clientId),e=>e.statusCode===404);
 assert.equal(seen.length,1);
 assert.match(seen[0].sql,/l.subadmin_user_id=\$3::uuid/);
 assert.deepEqual(seen[0].params,[clientId,"SUBADMIN",actor.userId]);
});
