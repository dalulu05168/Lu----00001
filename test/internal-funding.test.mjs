import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {reviewAdminRequest} from '../src/operational-workflows.mjs';

function fixture({cash=5000,kind='DEPOSIT',failLedger=false,bankBound=true}={}){
 const row={id:randomUUID(),client_user_id:randomUUID(),kind,amount_cents:1000,currency:'USD',status:'UNDER_REVIEW'};
 const actor={role:'MASTER',userId:randomUUID()},calls=[];
 const db={connect:async()=>({release(){},async query(sql,p=[]){
  calls.push({sql,p});
  if(sql.includes('SELECT r.*'))return {rows:[row]};
  if(sql.includes('SELECT id,cash_cents FROM accounts'))return {rows:[{id:randomUUID(),cash_cents:cash}]};
  if(sql.includes('FROM client_bank_link_requests'))return {rows:bankBound?[{id:randomUUID()}]:[]};
  if(sql.startsWith('INSERT INTO cash_ledger')){if(failLedger)throw Error('ledger failure');return {rows:[{id:'123'}]};}
  if(sql.startsWith('UPDATE client_funding_requests'))return {rows:[{...row,status:p[1],settlement_status:'INTERNAL_POSTED'}]};
  return {rows:[]};
 }})};
 return {db,row,actor,calls};
}
test('deposit approval accepts no reason and posts cash and unique funding ledger in one transaction',async()=>{
 const f=fixture();
 const result=await reviewAdminRequest(f.db,f.actor,'FUNDING',{id:f.row.id,expectedStatus:'UNDER_REVIEW',status:'APPROVED'});
 assert.equal(result.settlementStatus,'INTERNAL_POSTED');
 const update=f.calls.find(x=>x.sql.startsWith('UPDATE accounts'));
 assert.equal(String(update.p[1]),'6000');
 const ledger=f.calls.find(x=>x.sql.startsWith('INSERT INTO cash_ledger'));
 assert.match(ledger.sql,/funding_request_id/);
 assert.ok(ledger.p.includes(f.row.id));
 assert.equal(f.calls.at(-1).sql,'COMMIT');
});
test('withdrawal approval refuses insufficient internal funds and rolls back',async()=>{
 const f=fixture({cash:500,kind:'WITHDRAWAL'});
 await assert.rejects(reviewAdminRequest(f.db,f.actor,'FUNDING',{id:f.row.id,expectedStatus:'UNDER_REVIEW',status:'APPROVED'}),e=>e.statusCode===409);
 assert.equal(f.calls.at(-1).sql,'ROLLBACK');
 assert.equal(f.calls.some(x=>x.sql.startsWith('UPDATE accounts')),false);
});
test('master may approve a submitted funding request directly without a reason',async()=>{
 const f=fixture();f.row.status='SUBMITTED';
 const result=await reviewAdminRequest(f.db,f.actor,'FUNDING',{id:f.row.id,expectedStatus:'SUBMITTED',status:'APPROVED'});
 assert.equal(result.settlementStatus,'INTERNAL_POSTED');
});
test('ledger failure rolls back approval and balance; stale approval never posts again',async()=>{
 const f=fixture({failLedger:true});
 await assert.rejects(reviewAdminRequest(f.db,f.actor,'FUNDING',{id:f.row.id,expectedStatus:'UNDER_REVIEW',status:'APPROVED'}),/ledger failure/);
 assert.equal(f.calls.at(-1).sql,'ROLLBACK');
 f.row.status='APPROVED';f.calls.length=0;
 await assert.rejects(reviewAdminRequest(f.db,f.actor,'FUNDING',{id:f.row.id,expectedStatus:'UNDER_REVIEW',status:'APPROVED'}),e=>e.statusCode===409);
 assert.equal(f.calls.some(x=>x.sql.startsWith('UPDATE accounts')),false);
});
test('withdrawal approval refuses an account without a bound bank card',async()=>{
 const f=fixture({cash:50000,kind:'WITHDRAWAL',bankBound:false});
 await assert.rejects(reviewAdminRequest(f.db,f.actor,'FUNDING',{id:f.row.id,expectedStatus:'UNDER_REVIEW',status:'APPROVED'}),e=>e.statusCode===409&&/bound bank account/.test(e.message));
 assert.equal(f.calls.at(-1).sql,'ROLLBACK');
 assert.equal(f.calls.some(x=>x.sql.startsWith('UPDATE accounts')),false);
});
