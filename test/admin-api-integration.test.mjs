import test from "node:test";
import assert from "node:assert/strict";
import {handleAdminApi} from "../src/admin-http.mjs";

test("missing mirror audit schema reports the mirror dependency without returning account data",async()=>{
 const userId="11111111-1111-4111-8111-111111111111";
 const clientId="22222222-2222-4222-8222-222222222222";
 const db={query:async sql=>{
  if(sql.includes("FROM admin_roles"))return {rows:[{user_id:userId,role:"MASTER"}]};
  if(sql.includes("FROM app_users u"))return {rows:[{user_id:clientId,account_id:"private-account"}]};
  if(sql.includes("to_regclass"))return {rows:[{ready:false}]};
  throw Error("No account data should be read before audit is available");
 }};
 let status,body;
 const response={writeHead(code){status=code},end(value){body=JSON.parse(value)}};
 await handleAdminApi({method:"GET",headers:{authorization:"Bearer test-session"},
  url:"/api/admin/mirror?clientId="+clientId},response,"/api/admin/mirror",db,
  async()=>({userId,adminVerified:true}));
 assert.equal(status,503);
 assert.deepEqual(body,{error:"Mirror audit schema not installed"});
});
