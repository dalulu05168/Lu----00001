const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash, createHmac, randomUUID } = require('node:crypto');
const { Pool } = require('pg');

const port = Number(process.env.CN_ACCEPTANCE_PG_PORT);
const httpPort = Number(process.env.CN_OPS_QA_PORT);
assert(port > 15000 && httpPort > 8800 && process.env.CN_OPS_MASTER_FILE, 'Isolated runner required');
const db = new Pool({ connectionString: 'postgresql://postgres@127.0.0.1:' + port + '/postgres' });
const password = 'FixturePass123456!';
const email = 'qa-mobile@example.test';
const reviewRoute = '/api/admin/requests';
function otp(secret) {
  const bits = [...secret].map(c => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join('');
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest = createHmac('sha1', Buffer.from(bits.match(/.{8}/g).map(x => parseInt(x,2)))).update(time).digest();
  return String((digest.readUInt32BE(digest[19]&15)&0x7fffffff)%1000000).padStart(6,'0');
}
async function call(route, token, body, key) {
  const response = await fetch('http://127.0.0.1:' + httpPort + route, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(key ? {'Idempotency-Key':key} : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, data: await response.json() };
}
async function expectStatus(status, route, token, body, key) {
  const result = await call(route, token, body, key);
  assert.equal(result.status, status, route + ' ' + (result.data.error || ''));
  return result.data;
}
async function run() {
  const { totpSecret } = JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE));
  const { token: master } = await expectStatus(200, '/api/admin/login', null, { email: 'qa-master@example.test', password, otp: otp(totpSecret) });
  const { token: customer } = await expectStatus(200, '/api/auth/login', null, { email, password });
  const { id: account, user_id: user } = (await db.query('SELECT a.id,a.user_id FROM accounts a JOIN app_users u ON u.id=a.user_id WHERE u.email=$1',[email])).rows[0];
  const start = 9007199254740993n;
  await db.query('UPDATE accounts SET cash_cents=$2 WHERE id=$1',[account,start.toString()]);
  await db.query("INSERT INTO cn_profile_documents(user_id,kind,ciphertext,status) VALUES($1,'BANK','fixture','APPROVED'),($1,'IDENTITY','fixture','APPROVED')",[user]);
  await expectStatus(200,'/api/withdrawal-pin',customer,{password,pin:'472863'});
  const create = (kind, amountCents) => expectStatus(201,'/api/requests',customer,{kind,amountCents,...(kind==='WITHDRAW'?{withdrawalPin:'472863'}:{})});
  const snapshot = async () => (await expectStatus(200,'/api/account',customer)).account;
  const ledger = async () => (await db.query('SELECT delta_cents,balance_after_cents FROM cash_ledger WHERE account_id=$1',[account])).rows;
  const state = async id => (await db.query('SELECT status FROM cash_requests WHERE id=$1',[id])).rows[0].status;
  const verifyAudit = async (id, actions) => {
    const rows = (await db.query("SELECT action FROM admin_audit_log WHERE target=$1 AND action LIKE 'cash_request.%'",[id])).rows;
    assert.deepEqual(rows.map(row=>row.action).sort(),actions.slice().sort());
  };

  const deposit = await create('DEPOSIT',5000);
  const first = { id:deposit.id,decision:'APPROVE',expectedStatus:'PENDING' };
  await expectStatus(401,reviewRoute,null,first);
  await expectStatus(403,reviewRoute,customer,first);
  await expectStatus(400,reviewRoute,master,{id:deposit.id,decision:'APPROVE'});
  await db.query("UPDATE user_sessions SET admin_verified_at=now()-interval '6 minutes' WHERE token_hash=$1",[createHash('sha256').update(master).digest('hex')]);
  await expectStatus(428,reviewRoute,master,first);
  await expectStatus(401,'/api/admin/reauth',master,{password:'WrongPassword123!',otp:otp(totpSecret)});
  await expectStatus(428,reviewRoute,master,first);
  assert.equal(await state(deposit.id),'PENDING');
  assert.deepEqual(await ledger(),[]);
  await verifyAudit(deposit.id,[]);
  await expectStatus(200,'/api/admin/reauth',master,{password,otp:otp(totpSecret)});
  console.log('PASS funding authorization, missing stage, expired verification, and failed/successful reauthentication');

  const compete = async body => {
    const results = await Promise.all(Array.from({length:6},()=>call(reviewRoute,master,body)));
    assert.deepEqual(results.map(x=>x.status).sort(),[200,409,409,409,409,409]);
  };
  await compete(first);
  assert.equal(await state(deposit.id),'REVIEWED');
  assert.deepEqual(await ledger(),[]);
  const final = {...first,expectedStatus:'REVIEWED'};
  await compete(final);
  await expectStatus(409,reviewRoute,master,final);
  assert.equal(await state(deposit.id),'APPROVED');
  await verifyAudit(deposit.id,['cash_request.review','cash_request.approve']);
  assert.deepEqual(await ledger(),[{delta_cents:'5000',balance_after_cents:String(start+5000n)}]);
  console.log('PASS concurrent deposit stages and repeated final request produce one ledger credit');

  for (const stage of ['PENDING','REVIEWED']) {
    const request = await create('WITHDRAW',2000);
    if (stage==='REVIEWED') await expectStatus(200,reviewRoute,master,{id:request.id,decision:'APPROVE',expectedStatus:'PENDING'});
    const before = await snapshot();
    assert.equal(before.cashCents,String(start+5000n));
    assert.equal(before.reservedWithdrawalCents,2000);
    assert.equal(before.availableCashCents,String(start+3000n));
    await expectStatus(200,reviewRoute,master,{id:request.id,decision:'REJECT',expectedStatus:stage,reason:'Isolated rejection'});
    const after = await snapshot();
    assert.equal(after.reservedWithdrawalCents,0);
    assert.equal(after.availableCashCents,before.cashCents);
    assert.equal(after.cashCents,before.cashCents);
    assert.equal((await ledger()).length,1);
    await verifyAudit(request.id,stage==='PENDING'?['cash_request.reject']:['cash_request.review','cash_request.reject']);
    console.log('PASS withdrawal rejection releases reservation immediately at '+stage);
  }
  const withdrawal = await create('WITHDRAW',2000);
  await expectStatus(200,reviewRoute,master,{id:withdrawal.id,decision:'APPROVE',expectedStatus:'PENDING'});
  await compete({id:withdrawal.id,decision:'APPROVE',expectedStatus:'REVIEWED'});
  assert.equal((await snapshot()).cashCents,String(start+3000n));
  assert.equal((await snapshot()).reservedWithdrawalCents,0);
  assert.deepEqual((await ledger()).filter(row=>row.delta_cents==='-2000'),[{delta_cents:'-2000',balance_after_cents:String(start+3000n)}]);
  assert.equal((await ledger()).length,2);
  await verifyAudit(withdrawal.id,['cash_request.review','cash_request.approve']);
  console.log('PASS concurrent withdrawal finalization produces one ledger debit');

  await expectStatus(201,'/api/admin/listings',master,{market:'US',itemType:'STOCK',symbol:'AAPL',name:'Apple',status:'PUBLISHED',tradePin:'749286'});
  const order = await expectStatus(201,'/api/orders',customer,{market:'US',symbol:'AAPL',side:'BUY',quantity:1,limitPriceCents:1300,tradePin:'749286'},randomUUID());
  const afterTrade = await expectStatus(200,'/api/account',customer);
  assert.equal(afterTrade.account.cashCents,String(start+1766n));
  assert.equal(afterTrade.totalAssets,'90071992547778.28');
  assert.equal(order.order.amountCents,1234);
  assert.deepEqual((await ledger()).filter(row=>row.delta_cents==='-1234'),[{delta_cents:'-1234',balance_after_cents:String(start+1766n)}]);
  console.log('PASS stock order and account valuation preserve cents above the JavaScript safe integer limit');
}
run().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(()=>db.end());
