import test from "node:test";
import assert from "node:assert/strict";
import {registerAccount,getAccountSnapshot} from "../src/account-service.mjs";
test("registration writes user and account atomically",async()=>{
 const statements=[];let released=false;
 const db={connect:async()=>({query:async(sql,params)=>{statements.push({sql,params});return {rows:[]}},release(){released=true}})};
 const r=await registerAccount(db,{email:"TEST@example.com",password:"a secure password",openingCashCents:5000});
 assert.ok(r.accountId);assert.ok(r.userId);
 assert.equal(statements.at(-1).sql,"COMMIT");
 assert.equal(statements.find(s=>s.sql.startsWith("INSERT INTO app_users")).params[1],"test@example.com");
 assert.equal(statements.filter(s=>s.sql.startsWith("INSERT INTO cash_ledger")).length,1);
 assert.equal(released,true);
});
test("registration accepts an international phone as the login identifier",async()=>{
 const statements=[];
 const db={connect:async()=>({query:async(sql,params)=>{statements.push({sql,params});return {rows:[]}},release(){}})};
 await registerAccount(db,{email:"+40700000001",password:"a secure password"});
 assert.equal(statements.find(s=>s.sql.startsWith("INSERT INTO app_users")).params[1],"+40700000001");
 await assert.rejects(registerAccount(db,{email:"0700000001",password:"a secure password"}),/Invalid email/);
});
test("invalid opening balance cannot create an account",async()=>{
 await assert.rejects(registerAccount({}, {email:"x@example.com",password:"a secure password",openingCashCents:-1}),/Invalid opening balance/);
});
test("account snapshot returns scoped records",async()=>{
 const seen=[];const db={query:async(sql,params)=>{seen.push(params);return {rows:sql.startsWith("SELECT id,cash")?[{id:"acct",cash_cents:1000,base_currency:"USD"}]:[]}}};
 const r=await getAccountSnapshot(db,"acct");assert.equal(r.account.cashCents,1000);
 assert.ok(seen.every(x=>x[0]==="acct"));
});
