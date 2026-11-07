import test from "node:test";
import assert from "node:assert/strict";
import {handleAdminApi} from "../src/admin-http.mjs";

const MASTER="11111111-1111-4111-8111-111111111111";
const THREAD="22222222-2222-4222-8222-222222222222";

test("inaccessible support thread uses a generic 404 response",async()=>{
 let reply;
 const db={query:async(sql)=>{
  if(sql.includes("FROM admin_roles"))return {rows:[{user_id:MASTER,role:"MASTER",parent_user_id:null}]};
  if(sql.includes("FROM support_threads"))return {rows:[]};
  throw new Error("Unexpected query: "+sql);
 }};
 const req={headers:{authorization:"Bearer synthetic-admin-token"},method:"GET",
  url:"/api/admin/support-thread?threadId="+THREAD};
 const res={writeHead(status,headers){reply={status,headers};},end(body){reply.body=body;}};
 const handled=await handleAdminApi(req,res,"/api/admin/support-thread",db,
  async token=>token==="synthetic-admin-token"?{userId:MASTER,adminVerified:true}:null,()=>{});
 assert.equal(handled,true);
 assert.equal(reply.status,404);
 assert.equal(JSON.parse(reply.body).error,"Record not found");
});
