import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {reviewAdminRequest,submitClientRequest} from '../src/operational-workflows.mjs';
export async function verifyInternalFunding(){
 const db=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:4});
 try{
  let master=(await db.query("SELECT user_id FROM admin_roles WHERE role='MASTER'")).rows[0]?.user_id;
  if(!master){
   master=randomUUID();
   await db.query('INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3)',[master,master+'@example.test','synthetic-not-a-login-hash']);
   await db.query("INSERT INTO admin_roles(user_id,role) VALUES($1,'MASTER')",[master]);
  }
  const actor={userId:master,role:'MASTER'},userId=randomUUID(),accountId=randomUUID();
  await db.query('INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3)',[userId,userId+'@example.test','synthetic-not-a-login-hash']);
  await db.query('INSERT INTO accounts(id,user_id) VALUES($1,$2)',[accountId,userId]);
  const request=await submitClientRequest(db,userId,'FUNDING',{kind:'DEPOSIT',amountCents:25000});
  await reviewAdminRequest(db,actor,'FUNDING',{id:request.id,expectedStatus:'SUBMITTED',status:'UNDER_REVIEW',reason:'Synthetic local funding test review'});
  const approval={id:request.id,expectedStatus:'UNDER_REVIEW',status:'APPROVED'};
  const results=await Promise.allSettled([reviewAdminRequest(db,actor,'FUNDING',approval),reviewAdminRequest(db,actor,'FUNDING',approval)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.find(x=>x.status==='rejected').reason.statusCode,409);
  assert.equal(results.find(x=>x.status==='fulfilled').value.settlementStatus,'INTERNAL_POSTED');
  const snapshot=await db.query('SELECT cash_cents FROM accounts WHERE id=$1',[accountId]);
  assert.equal(snapshot.rows[0].cash_cents,'25000');
  const ledger=await db.query('SELECT delta_cents,balance_after_cents FROM cash_ledger WHERE funding_request_id=$1',[request.id]);
  assert.deepEqual(ledger.rows,[{delta_cents:'25000',balance_after_cents:'25000'}]);
  const withdrawal=await submitClientRequest(db,userId,'FUNDING',{kind:'WITHDRAWAL',amountCents:30000});
  await reviewAdminRequest(db,actor,'FUNDING',{id:withdrawal.id,expectedStatus:'SUBMITTED',status:'UNDER_REVIEW',reason:'Synthetic local withdrawal test review'});
  await assert.rejects(reviewAdminRequest(db,actor,'FUNDING',{id:withdrawal.id,expectedStatus:'UNDER_REVIEW',status:'APPROVED'}),e=>e.statusCode===409);
  assert.equal((await db.query('SELECT cash_cents FROM accounts WHERE id=$1',[accountId])).rows[0].cash_cents,'25000');
  assert.equal((await db.query('SELECT status FROM client_funding_requests WHERE id=$1',[withdrawal.id])).rows[0].status,'UNDER_REVIEW');
  const payable=await submitClientRequest(db,userId,'FUNDING',{kind:'WITHDRAWAL',amountCents:1000});
  await reviewAdminRequest(db,actor,'FUNDING',{id:payable.id,expectedStatus:'SUBMITTED',status:'APPROVED'});
  assert.equal((await db.query('SELECT cash_cents FROM accounts WHERE id=$1',[accountId])).rows[0].cash_cents,'24000');
  assert.equal((await db.query('SELECT delta_cents FROM cash_ledger WHERE funding_request_id=$1',[payable.id])).rows[0].delta_cents,'-1000');
  const failing=await submitClientRequest(db,userId,'FUNDING',{kind:'DEPOSIT',amountCents:1000});
  // Fault injection is confined to this generated account in the disposable local database.
  const trigger='funding_failure_'+randomUUID().replaceAll('-','');
  await db.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   IF NEW.account_id='${accountId}'::uuid THEN RAISE EXCEPTION 'synthetic funding ledger failure'; END IF;
   RETURN NEW; END $$`);
  try{
   await db.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON cash_ledger FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
   await assert.rejects(reviewAdminRequest(db,actor,'FUNDING',{id:failing.id,expectedStatus:'SUBMITTED',status:'APPROVED'}),/synthetic funding ledger failure/);
   assert.equal((await db.query('SELECT cash_cents FROM accounts WHERE id=$1',[accountId])).rows[0].cash_cents,'24000');
   assert.equal((await db.query('SELECT status FROM client_funding_requests WHERE id=$1',[failing.id])).rows[0].status,'SUBMITTED');
   assert.equal((await db.query('SELECT count(*)::int AS n FROM client_workflow_audit WHERE request_id=$1 AND new_status=\'APPROVED\'',[failing.id])).rows[0].n,0);
  }finally{
   await db.query(`DROP TRIGGER IF EXISTS ${trigger} ON cash_ledger`);
   await db.query(`DROP FUNCTION ${trigger}()`);
  }
 }finally{await db.end();}
}
