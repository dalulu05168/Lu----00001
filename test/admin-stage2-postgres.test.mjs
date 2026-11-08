import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {hashPassword,sessionTokenHash,createSessionResolver,createSession} from '../src/auth.mjs';
import {adminLogin,verifyAdminTotp} from '../src/admin-service.mjs';
import {adminTotpKey,openTotpSecret} from '../src/admin-totp-storage.mjs';
import {totpCode} from '../src/totp.mjs';
import {createApi} from '../src/http-api.mjs';

const run=process.env.TEST_DATABASE_URL?test:test.skip;
const E='@stage2.invalid';
function bearer(token){return token?{authorization:'Bearer '+token}:{};}
async function seed(db,role,email,password,parentId){
 const userId=randomUUID(),accountId=randomUUID();
 await db.query('INSERT INTO app_users(id,email,password_hash) VALUES ($1,$2,$3)',[userId,email,await hashPassword(password)]);
 await db.query('INSERT INTO accounts(id,user_id,cash_cents) VALUES($1,$2,0)',[accountId,userId]);
 if(role)await db.query('INSERT INTO admin_roles(user_id,role,parent_user_id,password_setup_pending) VALUES($1,$2,$3,false)',
   [userId,role,parentId??null]);
 return {userId,accountId,email,password};
}
async function codeFor(db,userId){
 const r=await db.query('SELECT totp_secret_ciphertext FROM admin_roles WHERE user_id=$1',[userId]);
 return totpCode(openTotpSecret(r.rows[0].totp_secret_ciphertext,adminTotpKey(),userId));
}

run('isolated PostgreSQL: admin replay gate, scoped analytics, audit fail closed and legacy modules',async()=>{
 const db=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:8});
 const oldKey=process.env.ADMIN_TOTP_KEY,oldFlag=process.env.ADMIN_TOTP_REPLAY_GUARD_ENABLED;
 const password='stage2-only-admin-password';
 process.env.ADMIN_TOTP_KEY='a'.repeat(64);
 process.env.ADMIN_TOTP_REPLAY_GUARD_ENABLED='true';
 let app;
 try{
  const sql=await readFile(new URL('../migration-candidates/023_admin_totp_replay.sql',import.meta.url),'utf8');
  // This applies ONLY to the disposable PostgreSQL service in the standalone CI job.
  await db.query(sql);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='admin_roles' AND column_name='last_login_totp_step'")).rows[0].n,1);
  const stamp=randomUUID().slice(0,8);
  const master=await seed(db,'MASTER','master-'+stamp+E,password);
  const sub=await seed(db,'SUBADMIN','sub-'+stamp+E,password,master.userId);
  const client=await seed(db,null,'client-'+stamp+E,password);
  const unassigned=await seed(db,null,'unassigned-'+stamp+E,password);
  await db.query('INSERT INTO invite_codes(id,subadmin_user_id,code,expires_at,max_uses) VALUES($1,$2,$3,now()+interval \'1 day\',100)',
    [randomUUID(),sub.userId,'123456']);
  const invite=(await db.query('SELECT id FROM invite_codes WHERE subadmin_user_id=$1',[sub.userId])).rows[0].id;
  await db.query('INSERT INTO client_links(user_id,subadmin_user_id,invite_code_id) VALUES($1,$2,$3)',
    [client.userId,sub.userId,invite]);

  // The existing step-1 API still issues two independent pending challenges.
  const a=await adminLogin(db,{email:master.email,password});
  const b=await adminLogin(db,{email:master.email,password});
  assert.equal(a.totpSetupRequired,true);
  assert.equal(typeof a.pendingToken,'string');
  const code=await codeFor(db,master.userId);
  const concurrent=await Promise.allSettled([
   verifyAdminTotp(db,{pendingToken:a.pendingToken,code}),
   verifyAdminTotp(db,{pendingToken:b.pendingToken,code})
  ]);
  assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1,
    'only one verified session for one TOTP time step across distinct challenges');
  assert.equal(concurrent.filter(x=>x.status==='rejected'&&x.reason.statusCode===401).length,1);
  const token=concurrent.find(x=>x.status==='fulfilled').value.token;
  const sessionCount=(await db.query('SELECT count(*)::int AS n FROM user_sessions WHERE user_id=$1 AND admin_verified_at IS NOT NULL',[master.userId])).rows[0].n;
  assert.equal(sessionCount,1);
  const step=(await db.query('SELECT last_login_totp_step FROM admin_roles WHERE user_id=$1',[master.userId])).rows[0].last_login_totp_step;
  assert.ok(Number(step)>0);
  const third=await adminLogin(db,{email:master.email,password});
  await assert.rejects(verifyAdminTotp(db,{pendingToken:third.pendingToken,code}),error=>error.statusCode===401);
  const expired=await adminLogin(db,{email:master.email,password});
  await db.query("UPDATE admin_totp_challenges SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[sessionTokenHash(expired.pendingToken)]);
  await assert.rejects(verifyAdminTotp(db,{pendingToken:expired.pendingToken,code}),error=>error.statusCode===401);

  const subChallenge=await adminLogin(db,{email:sub.email,password});
  const subToken=(await verifyAdminTotp(db,{pendingToken:subChallenge.pendingToken,code:await codeFor(db,sub.userId)})).token;
  const clientToken=await createSession(db,{userId:client.userId,accountId:client.accountId,expiresAt:new Date(Date.now()+60_000)});
  app=createApi({db,resolveSession:createSessionResolver(db)});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+app.address().port;
  async function request(path,{token:authToken,method='GET'}={}){
   const response=await fetch(url+path,{method,headers:bearer(authToken)});
   return {status:response.status,data:await response.json()};
  }
  const path='/api/admin/client-analytics?clientId='+client.userId;
  assert.equal((await request(path)).status,401);
  assert.equal((await request(path,{method:'POST',token})).status,405);
  assert.equal((await request(path,{token:clientToken})).status,403);
  assert.equal((await request('/api/admin/client-analytics?clientId=bad',{token})).status,400);
  assert.equal((await request('/api/admin/client-analytics?clientId='+unassigned.userId,{token:subToken})).status,404);
  assert.equal((await request('/api/admin/client-analytics?clientId='+master.userId,{token})).status,404);

  const masterResult=await request(path,{token});
  assert.equal(masterResult.status,200,JSON.stringify(masterResult.data));
  assert.equal(masterResult.data.clientId,client.userId);
  assert.equal(masterResult.data.analytics.currency,'USD');
  assert.equal(masterResult.data.analytics.historyAvailable,true);
  assert.equal(masterResult.data.analytics.realizedPnlCents,0);
  assert.equal(masterResult.data.analytics.portfolioValueCents,0);
  const subResult=await request(path,{token:subToken});
  assert.equal(subResult.status,200,JSON.stringify(subResult.data));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM admin_mirror_access_log WHERE client_user_id=$1 AND actor_user_id IN ($2,$3)',
    [client.userId,master.userId,sub.userId])).rows[0].n,2);

  // A real PostgreSQL trigger failure must NOT leak the computed financial JSON.
  await db.query("CREATE FUNCTION stage2_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'test-audit-unavailable'; END$$");
  await db.query('CREATE TRIGGER stage2_reject_audit BEFORE INSERT ON admin_mirror_access_log FOR EACH ROW EXECUTE FUNCTION stage2_reject_audit()');
  const denied=await request(path,{token});
  assert.equal(denied.status,500);
  assert.equal(denied.data.analytics,undefined);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM admin_mirror_access_log WHERE client_user_id=$1',[client.userId])).rows[0].n,2);
  await db.query('DROP TRIGGER stage2_reject_audit ON admin_mirror_access_log');
  await db.query('DROP FUNCTION stage2_reject_audit()');

  // Keep the existing admin API surface, rather than replacing it with a slimmed-down backend.
  for(const endpoint of ['/api/admin/me','/api/admin/clients','/api/admin/workflow-requests?category=FUNDING',
   '/api/admin/subaccounts','/api/admin/audit-events']){
   assert.equal((await request(endpoint,{token})).status,200,endpoint);
  }
  const html=await readFile(new URL('../web/admin.html',import.meta.url),'utf8');
  assert.equal((html.match(/data-admin-page=/g)??[]).length,10);
 }finally{
  if(app)await new Promise(resolve=>app.close(resolve));
  if(oldKey===undefined)delete process.env.ADMIN_TOTP_KEY;else process.env.ADMIN_TOTP_KEY=oldKey;
  if(oldFlag===undefined)delete process.env.ADMIN_TOTP_REPLAY_GUARD_ENABLED;else process.env.ADMIN_TOTP_REPLAY_GUARD_ENABLED=oldFlag;
  await db.end();
 }
});
