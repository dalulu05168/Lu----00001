import test from 'node:test';
import assert from 'node:assert/strict';
import {getAdminClientAnalytics} from '../src/admin-client-analytics.mjs';

const MASTER='11111111-1111-4111-8111-111111111111';
const SUBADMIN='22222222-2222-4222-8222-222222222222';
const CLIENT='33333333-3333-4333-8333-333333333333';
const ACCOUNT='44444444-4444-4444-8444-444444444444';
const actor=(role,userId=role==='MASTER'?MASTER:SUBADMIN)=>({role,userId});
const computed={historyAvailable:true,method:'FIFO',currency:'USD',realizedPnlCents:500,
  positionCostCents:1000,portfolioValueCents:null,reason:null};
function fixture({allowed=true,auditFails=false,analytics=computed,ready=true}={}){
 const calls=[];
 const db={async query(sql,params){
   calls.push({sql,params});
   if(sql.includes('SELECT a.id AS account_id'))return {rows:allowed?[{account_id:ACCOUNT}]:[]};
   if(sql.includes('INSERT INTO admin_mirror_access_log')){
     if(auditFails)throw new Error('audit unavailable');
     return {rowCount:1};
   }
   throw new Error('Unexpected SQL');
 }};
 const counts={analytics:0,readiness:0};
 const deps={
   readAnalytics:async(_db,id)=>{counts.analytics++;assert.equal(id,ACCOUNT);return analytics;},
   mirrorStatus:async()=>{counts.readiness++;return {ready};}
 };
 return {db,calls,counts,deps};
}

async function expectStatus(promise,status){await assert.rejects(promise,e=>e.statusCode===status);}

test('MASTER reads only confirmed DB analytics, and financial access is audited',async()=>{
 const f=fixture();const result=await getAdminClientAnalytics(f.db,actor('MASTER'),CLIENT,f.deps);
 assert.deepEqual(result,{clientId:CLIENT,analytics:computed,mode:'READ_ONLY'});
 assert.equal(f.counts.analytics,1);
 assert.equal(f.counts.readiness,1);
 assert.equal(f.calls.length,2);
 assert.deepEqual(f.calls[0].params,[CLIENT,'MASTER',MASTER]);
 assert.match(f.calls[0].sql,/NOT EXISTS\s*\(SELECT 1 FROM admin_roles/i);
 assert.match(f.calls[0].sql,/c\.subadmin_user_id=\$3::uuid/);
 assert.deepEqual(f.calls[1].params,[MASTER,CLIENT]);
 assert.match(f.calls[1].sql,/INSERT INTO admin_mirror_access_log/);
});

test('SUBADMIN gets only its customers by server SQL, never frontend role claims',async()=>{
 const f=fixture();await getAdminClientAnalytics(f.db,actor('SUBADMIN'),CLIENT,f.deps);
 assert.deepEqual(f.calls[0].params,[CLIENT,'SUBADMIN',SUBADMIN]);
 assert.equal(f.counts.analytics,1);
});

test('unauthorized role never queries clients or analytics',async()=>{
 const f=fixture();await expectStatus(getAdminClientAnalytics(f.db,actor('CLIENT'),CLIENT,f.deps),403);
 await expectStatus(getAdminClientAnalytics(f.db,{role:'MASTER',userId:'bad-id'},CLIENT,f.deps),403);
 assert.equal(f.calls.length,0);assert.equal(f.counts.analytics,0);
});

test('invalid client id rejected without database access',async()=>{
 const f=fixture();await expectStatus(getAdminClientAnalytics(f.db,actor('MASTER'),'bad-id',f.deps),400);
 assert.equal(f.calls.length,0);
});

test('out-of-scope client gives 404 and no financial read',async()=>{
 const f=fixture({allowed:false});
 await expectStatus(getAdminClientAnalytics(f.db,actor('SUBADMIN'),CLIENT,f.deps),404);
 assert.equal(f.calls.length,1);assert.equal(f.counts.analytics,0);
 assert.equal(f.counts.readiness,0);
});

test('missing audit schema fails closed before reading finance',async()=>{
 const f=fixture({ready:false});
 await expectStatus(getAdminClientAnalytics(f.db,actor('MASTER'),CLIENT,f.deps),503);
 assert.equal(f.counts.analytics,0);
 assert.equal(f.calls.length,1);
});

test('audit insert failure never returns sensitive results',async()=>{
 const f=fixture({auditFails:true});
 await assert.rejects(getAdminClientAnalytics(f.db,actor('MASTER'),CLIENT,f.deps),/audit unavailable/);
 assert.equal(f.counts.analytics,1);
 assert.equal(f.calls.length,2);
});

test('unknown ledger history stays null, rather than synthesized profit',async()=>{
 const unavailable={historyAvailable:false,realizedPnlCents:null,portfolioValueCents:null,
   positionCostCents:null,reason:'LEDGER_HISTORY_UNAVAILABLE'};
 const f=fixture({analytics:unavailable});
 const result=await getAdminClientAnalytics(f.db,actor('MASTER'),CLIENT,f.deps);
 assert.deepEqual(result.analytics,unavailable);
 assert.equal(result.analytics.realizedPnlCents,null);
});

test('analytics read errors fail without audit-success response',async()=>{
 const f=fixture();f.deps.readAnalytics=async()=>{throw Object.assign(new Error('read failed'),{statusCode:503});};
 await expectStatus(getAdminClientAnalytics(f.db,actor('MASTER'),CLIENT,f.deps),503);
 assert.equal(f.calls.length,1);
});
