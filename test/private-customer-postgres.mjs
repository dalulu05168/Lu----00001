import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {submitPrivateData,readPrivateData} from '../src/private-customer-data.mjs';
import {listClientRequests,reviewAdminRequest} from '../src/operational-workflows.mjs';
import {createApi} from '../src/http-api.mjs';
export async function verifyPrivateCustomerData(){
 const db=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:6});
 const key=randomBytes(32),userId=randomUUID(),otherId=randomUUID(),accountId=randomUUID();
 let app;const oldKey=process.env.CUSTOMER_DATA_KEY;
 try{
  const master=(await db.query("SELECT a.id AS account_id,r.user_id FROM admin_roles r JOIN accounts a ON a.user_id=r.user_id WHERE r.role='MASTER'")).rows[0];
  const actor={role:'MASTER',userId:master.user_id};
  await db.query('INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3),($4,$5,$3)',[userId,userId+'@example.test','synthetic-only',otherId,otherId+'@example.test']);
  await db.query('INSERT INTO accounts(id,user_id) VALUES($1,$2),($3,$3)',[accountId,userId,otherId]);
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  const image={mime:'image/png',base64:png};
  const identity=await submitPrivateData(db,userId,'KYC',{front:image,back:image},{key});
  assert.equal(identity.documentsStored,true);assert.equal(identity.status,'UNDER_REVIEW');
  const bank=await submitPrivateData(db,userId,'BANK_LINK',{bankName:'Synthetic Bank',accountNumber:'123456789012'},{key});
  assert.equal(bank.accountLast4,'9012');assert.equal(bank.accountNumber,undefined);
  const stored=(await db.query('SELECT encrypted_payload FROM private_customer_submissions WHERE user_id=$1',[userId])).rows;
  assert.ok(stored.every(x=>!x.encrypted_payload.includes(png)&&!x.encrypted_payload.includes('123456789012')));
  for(const role of ['CLIENT','SUBADMIN'])await assert.rejects(readPrivateData(db,{role,userId:otherId},'KYC',identity.id,{key}),e=>e.statusCode===404);
  const own=await readPrivateData(db,{role:'CLIENT',userId},'BANK_LINK',bank.id,{key});assert.equal(own.accountNumber,'123456789012');
  const admin=await readPrivateData(db,actor,'KYC',identity.id,{key});assert.equal(admin.front.base64,png);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM private_customer_access_audit WHERE client_user_id=$1',[userId])).rows[0].n,2);
  assert.equal((await listClientRequests(db,userId,'KYC'))[0].documentsStored,true);
  const confirmed=await reviewAdminRequest(db,actor,'BANK_LINK',{id:bank.id,expectedStatus:'PENDING_VERIFICATION',status:'MANUALLY_REVIEWED',reason:'Synthetic manual bank binding review only'});
  assert.equal(confirmed.bound,true);assert.equal(confirmed.verified,false);
  const fault='private_fault_'+randomUUID().replaceAll('-','');
  await db.query(`CREATE FUNCTION ${fault}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.client_user_id='${userId}'::uuid THEN RAISE EXCEPTION 'synthetic private audit failure'; END IF; RETURN NEW; END $$`);
  try{
   await db.query(`CREATE TRIGGER ${fault} BEFORE INSERT ON private_customer_access_audit FOR EACH ROW EXECUTE FUNCTION ${fault}()`);
   await assert.rejects(readPrivateData(db,actor,'KYC',identity.id,{key}),/synthetic private audit failure/);
  }finally{await db.query(`DROP TRIGGER IF EXISTS ${fault} ON private_customer_access_audit`);await db.query(`DROP FUNCTION ${fault}()`);}
  const submissions=await Promise.allSettled(Array.from({length:6},()=>submitPrivateData(db,userId,'BANK_LINK',{bankName:'Synthetic Bank',accountNumber:'999999999999'},{key})));
  assert.equal(submissions.filter(x=>x.status==='fulfilled').length,3);assert.ok(submissions.filter(x=>x.status==='rejected').every(x=>x.reason.statusCode===429));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM private_customer_submissions WHERE user_id=$1',[userId])).rows[0].n,5);
  process.env.CUSTOMER_DATA_KEY=key.toString('hex');
  app=createApi({db,resolveSession:async token=>token==='synthetic-private-owner'?{userId,accountId}:token==='synthetic-private-other'?{userId:otherId,accountId:otherId}:null});
  await new Promise(done=>app.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+app.address().port;
  const headers={authorization:'Bearer synthetic-private-owner'};
  assert.equal((await fetch(origin+'/api/private-data?kind=KYC&id='+identity.id)).status,401);
  assert.equal((await fetch(origin+'/api/private-data?kind=KYC&id='+identity.id,{headers:{authorization:'Bearer synthetic-private-other'}})).status,404);
  assert.equal((await (await fetch(origin+'/api/private-data/status',{headers})).json()).ready,true);
  delete process.env.CUSTOMER_DATA_KEY;
  assert.equal((await (await fetch(origin+'/api/private-data/status',{headers})).json()).ready,false);
  assert.equal((await fetch(origin+'/api/private-data?kind=BANK_LINK',{method:'POST',headers,body:'{}'})).status,503);
 }finally{if(oldKey===undefined)delete process.env.CUSTOMER_DATA_KEY;else process.env.CUSTOMER_DATA_KEY=oldKey;if(app)await new Promise(done=>app.close(done));await db.end();}
}
