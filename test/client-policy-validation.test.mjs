import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {hashPassword} from "../src/auth.mjs";
import {getClientPolicy,changeClientPolicy,listClientPolicyAudit} from "../src/client-admin-policies.mjs";

test("client policy rejects out-of-scope readers and unauthorized subadmin mutations",async()=>{
  const target=randomUUID(),master={role:"MASTER",userId:randomUUID()};
  const linked={role:"SUBADMIN",userId:randomUUID()};
  const other={role:"SUBADMIN",userId:randomUUID()};
  const db={query:async(sql,params)=>{
    if(sql.startsWith("SELECT u.id,u.email,c.subadmin_user_id")){
      return {rows:params[2]===other.userId?[]:[{id:target,email:"client@example.test",subadmin_user_id:linked.userId}]};
    }
    if(sql.startsWith("SELECT * FROM client_admin_policies"))return {rows:[]};
    if(sql.startsWith("SELECT id,actor_user_id"))return {rows:[]};
    throw Error("Unexpected query "+sql);
  }};
  const p=await getClientPolicy(db,linked,target);
  assert.equal(p.loginAllowed,true);assert.equal(p.vipTier,"STANDARD");assert.equal(p.accountClass,"SIMULATED");
  assert.equal(p.version,0);
  await assert.rejects(getClientPolicy(db,other,target),e=>e.statusCode===404);
  await assert.rejects(listClientPolicyAudit(db,other,target),e=>e.statusCode===404);
  await assert.rejects(changeClientPolicy(db,linked,{clientId:target,field:"vipTier",value:"GOLD"}),e=>e.statusCode===403);
  await assert.rejects(getClientPolicy(db,master,"not-uuid"),e=>e.statusCode===400);
});

test("client policy validates requested field, value, reason and confirmation before writes",async()=>{
  const actor={role:"MASTER",userId:randomUUID()},clientId=randomUUID();
  const db={query:async()=>({rows:[]}),connect:()=>{throw Error("Unexpected transaction");}};
  const base={clientId,field:"vipTier",value:"GOLD",reason:"Risk-adjusted user permission change",expectedVersion:0,confirmPassword:"long-invalid-password"};
  await assert.rejects(changeClientPolicy(db,actor,{...base,field:"cashCents"}),e=>e.statusCode===400);
  await assert.rejects(changeClientPolicy(db,actor,{...base,value:"UNSUPPORTED"}),e=>e.statusCode===400);
  await assert.rejects(changeClientPolicy(db,actor,{...base,expectedVersion:-1}),e=>e.statusCode===400);
  await assert.rejects(changeClientPolicy(db,actor,{...base,reason:"x".repeat(401)}),e=>e.statusCode===400);
  await assert.rejects(changeClientPolicy(db,actor,{...base,unexpected:true}),e=>e.statusCode===400);
  await assert.rejects(changeClientPolicy(db,actor,{...base,confirmPassword:"wrong"}),e=>e.statusCode===401);
});

test("master edits are atomic, audited and login blocks revoke existing sessions",async()=>{
  const actor={role:"MASTER",userId:randomUUID()},clientId=randomUUID();
  const secret="long-master-password-2026";
  const hash=await hashPassword(secret);
  const changes=[];
  let policy={user_id:clientId,login_allowed:true,withdrawal_requests_allowed:true,loan_requests_allowed:false,vip_tier:"STANDARD",account_class:"SIMULATED",version:0};
  const conn={
    async query(sql,params=[]){
      changes.push({sql,params});
      if(sql.startsWith("SELECT u.id,u.email,c.subadmin_user_id"))return {rows:[{id:clientId,email:"client@example.test",subadmin_user_id:null}]};
      if(sql.startsWith("SELECT * FROM client_admin_policies"))return {rows:[{...policy}]};
      if(sql.startsWith("UPDATE client_admin_policies SET")){
        policy={...policy,login_allowed:params[1],version:policy.version+1};
        return {rows:[{...policy}]};
      }
      return {rows:[]};
    },
    release(){changes.push({sql:"RELEASE"});}
  };
  const db={query:async(sql)=>({rows:sql.startsWith("SELECT password_hash")?[{password_hash:hash}]:[]}),connect:async()=>conn};
  const r=await changeClientPolicy(db,actor,{clientId,field:"loginAllowed",value:false,reason:"Verified account-security case review",expectedVersion:0,confirmPassword:secret});
  assert.equal(r.loginAllowed,false);assert.equal(r.version,1);
  assert.ok(changes.some(x=>x.sql.startsWith("INSERT INTO client_policy_audit")&&x.params[3]==="true"&&x.params[4]==="false"));
  assert.ok(changes.some(x=>x.sql.startsWith("UPDATE user_sessions SET revoked_at=now()")));
  assert.ok(changes.some(x=>x.sql==="COMMIT"));
  assert.equal(changes.some(x=>x.sql.includes("cash_cents")||x.sql.includes("INSERT INTO orders")),false);
  await assert.rejects(changeClientPolicy(db,actor,{clientId,field:"loginAllowed",value:true,reason:"Verified account-security case review",expectedVersion:0,confirmPassword:secret}),e=>e.statusCode===409);
  assert.ok(changes.some(x=>x.sql==="ROLLBACK"));
});
