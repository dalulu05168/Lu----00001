import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {createSession,createSessionResolver} from "../src/auth.mjs";
import {handleMobileSession} from "../src/mobile-session.mjs";

const run=process.env.TEST_DATABASE_URL?test:test.skip;
run("PostgreSQL mobile handoff is consumed once by concurrent requests",async()=>{
 const db=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:4});
 const userId=randomUUID(),accountId=randomUUID();
 const previous=process.env.MOBILE_ORIGIN;
 const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}});
 try{
  process.env.MOBILE_ORIGIN="https://m.nuvexapro.com";
  await db.query("INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,'test-only-hash')",[userId,"mobile-"+userId+"@example.test"]);
  await db.query("INSERT INTO accounts(id,user_id,cash_cents) VALUES($1,$2,0)",[accountId,userId]);
  const token=await createSession(db,{userId,accountId,expiresAt:new Date(Date.now()+600000)});
  const resolver=createSessionResolver(db);
  const issue=response();
  await handleMobileSession({method:"POST",headers:{host:"www.nuvexapro.com",origin:"https://www.nuvexapro.com",authorization:"Bearer "+token}},issue,db,resolver);
  assert.equal(issue.status,200);
  const authorization="Handoff "+issue.body.handoff;
  const request={method:"POST",headers:{host:"m.nuvexapro.com",origin:"https://m.nuvexapro.com",authorization}};
  const responses=[response(),response()];
  await Promise.all(responses.map(res=>handleMobileSession(request,res,db,resolver)));
  assert.deepEqual(responses.map(res=>res.status).sort(),[200,401]);
  assert.equal(await resolver(token),null);
  const winner=responses.find(res=>res.status===200);
  assert.equal((await resolver(winner.body.token)).accountId,accountId);
  const sessions=await db.query("SELECT * FROM user_sessions WHERE user_id=$1 AND revoked_at IS NULL",[userId]);
  assert.equal(sessions.rows.length,1);
  const replay=response();await handleMobileSession(request,replay,db,resolver);
  assert.equal(replay.status,401);
 }finally{
  try{await db.query("DELETE FROM app_users WHERE id=$1",[userId]);}
  finally{await db.end();if(previous===undefined)delete process.env.MOBILE_ORIGIN;else process.env.MOBILE_ORIGIN=previous;}
 }
});
