import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {getClientMirrorSetupStatus,getClientAppMirror,listClientMirrorAudit} from "../src/admin-mirror.mjs";

test("missing audit schema blocks privileged mirror reads and audit lists before account data",async()=>{
  const clientId=randomUUID(),actorId=randomUUID(),accountId=randomUUID();
  let dataReads=0;
  const db={query:async(sql)=>{
    if(sql.includes("FROM app_users u"))return {rows:[{user_id:clientId,email:"owner@example.test",account_id:accountId,subadmin_user_id:actorId}]};
    if(sql.includes("to_regclass"))return {rows:[{ready:false}]};
    if(sql.includes("SELECT id,cash_cents"))dataReads++;
    return {rows:[]};
  }};
  const actor={role:"SUBADMIN",userId:actorId};
  assert.deepEqual(await getClientMirrorSetupStatus(db,actor),{ready:false,mode:"READ_ONLY"});
  await assert.rejects(getClientAppMirror(db,actor,clientId),error=>error.statusCode===503);
  await assert.rejects(listClientMirrorAudit(db,actor),error=>error.statusCode===503);
  assert.equal(dataReads,0);
});
test("mirror readiness requires verified admin role",async()=>{
  const db={query:async()=>{throw Error("db should not be used");}};
  await assert.rejects(getClientMirrorSetupStatus(db,{role:"CLIENT",userId:randomUUID()}),error=>error.statusCode===403);
});
