import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {getConsistentInternalStockPortfolio as load} from "../src/internal-account-portfolio.mjs";

const accountId=randomUUID();
function pool(cash){
 const sql=[];let released=false;
 const client={
  async query(statement,params=[]){
   sql.push({statement,params});
   if(statement.startsWith("SELECT cash_cents FROM accounts"))
    return {rows:cash===null?[]:[{cash_cents:cash}]};
   return {rows:[]};
  },
  release(){released=true;}
 };
 return {db:{connect:async()=>client},sql,get released(){return released}};
}
test("account is resolved server-side by UUID before touching PostgreSQL",async()=>{
 let connected=false;
 await assert.rejects(load({
  db:{connect:async()=>{connected=true;throw Error("must not connect")}},
  accountId:"not-a-uuid"
 }),e=>e.statusCode===400);
 assert.equal(connected,false);
});
test("unsafe PostgreSQL bigint cash aborts snapshot before quote/network I/O",async()=>{
 for(const cash of ["9007199254740993",Number.MAX_SAFE_INTEGER+2,"-1"]){
  const f=pool(cash);let quoteCalls=0;
  await assert.rejects(load({
   db:f.db,accountId,resolveQuote:async()=>{quoteCalls++;throw Error("must not quote")}
  }),e=>e.statusCode===503&&e.reason==="CASH_UNREPRESENTABLE");
  assert.equal(quoteCalls,0);
  assert.match(f.sql[0].statement,/REPEATABLE READ READ ONLY/);
  assert.equal(f.sql.at(-1).statement,"ROLLBACK");
  assert.equal(f.released,true);
 }
});
test("unknown account remains 404 without returning synthesized empty holdings",async()=>{
 const f=pool(null);
 await assert.rejects(load({db:f.db,accountId}),
  e=>e.statusCode===404&&/Account not found/.test(e.message));
 assert.equal(f.sql.at(-1).statement,"ROLLBACK");
 assert.equal(f.released,true);
});
