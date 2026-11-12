const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),{randomUUID}=require('node:crypto'),{Pool}=require('pg');
(async()=>{
const dir=process.env.CN_QA_SAVE_DIR;assert(dir&&process.env.CN_ACCEPTANCE_PG_PORT);const db=new Pool({connectionString:'postgresql://postgres@127.0.0.1:'+process.env.CN_ACCEPTANCE_PG_PORT+'/postgres',max:1});const checks=[];
try{
const file=path.join(dir,'trade-runtime.mjs');fs.writeFileSync(file,fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8').replace('import { handleAsNodeRequest } from "cloudflare:node";','')+'\nexport {placeInternalOrder,cnReplayInternalOrder,cnOrderIntent,getAccountSnapshot};');const app=await import(pathToFileURL(file));
const account=(await db.query("SELECT a.id FROM accounts a JOIN app_users u ON u.id=a.user_id WHERE u.email='qa-mobile@example.test'")).rows[0].id;
await db.query('UPDATE accounts SET cash_cents=100000 WHERE id=$1',[account]);
await db.query(fs.readFileSync(path.resolve(__dirname,'../db/migration-trade-evidence.sql'),'utf8'));checks.push('additive migration repeat safe');
const intent=app.cnOrderIntent({market:'US',symbol:'AAPL',side:'BUY',quantity:2,limitPriceCents:1500});const input={market:'US',symbol:'AAPL',side:'BUY',quantity:2,priceCents:1234,fxUsdMicros:1000000,requestIntent:intent,quoteEvidence:{timestampMs:Date.now(),maxAgeMs:60000,source:'ISOLATED',priceCents:1234,fxUsdMicros:1000000}};
const key=randomUUID();await app.placeInternalOrder(db,account,key,input,randomUUID());const saved=(await db.query('SELECT request_intent,quote_evidence FROM orders WHERE account_id=$1 AND idempotency_key=$2',[account,key])).rows[0];assert.deepEqual(saved.request_intent,intent);assert.equal(saved.quote_evidence.source,'ISOLATED');checks.push('intent and quote evidence committed atomically');
await assert.rejects(app.cnReplayInternalOrder(db,account,key,{...input,requestIntent:{...intent,limitPriceCents:1400}}),/mismatch/);checks.push('changed limit cannot replay old order');
await assert.rejects(app.placeInternalOrder(db,account,key,{...input,requestIntent:{...intent,limitPriceCents:1400}},randomUUID()),/mismatch/);checks.push('transaction replay rejects conflicting intent');
const before=await db.query('SELECT cash_cents FROM accounts WHERE id=$1',[account]);const count=await db.query('SELECT count(*)::int n FROM orders WHERE account_id=$1',[account]);
const failDb={connect:async()=>{const c=await db.connect();return {query:(sql,args)=>sql.includes('INSERT INTO cash_ledger')?Promise.reject(Error('Injected ledger failure')):c.query(sql,args),release:()=>c.release()}}};
await assert.rejects(app.placeInternalOrder(failDb,account,randomUUID(),input,randomUUID()),/Injected ledger/);assert.equal((await db.query('SELECT cash_cents FROM accounts WHERE id=$1',[account])).rows[0].cash_cents,before.rows[0].cash_cents);assert.equal((await db.query('SELECT count(*)::int n FROM orders WHERE account_id=$1',[account])).rows[0].n,count.rows[0].n);assert.equal(Number((await db.query('SELECT quantity FROM positions WHERE account_id=$1',[account])).rows[0].quantity),2);checks.push('ledger failure rolls back balance position order and evidence');
const slowDb={connect:async()=>{const c=await db.connect();return {query:async(sql,args)=>{const r=await c.query(sql,args);if(sql.includes('SELECT cash_cents FROM accounts'))await new Promise(r=>setTimeout(r,30));return r},release:()=>c.release()}}};
await assert.rejects(app.placeInternalOrder(slowDb,account,randomUUID(),{...input,quoteEvidence:{timestampMs:Date.now(),maxAgeMs:10}},randomUUID()),/pricing expired/);assert.equal((await db.query('SELECT count(*)::int n FROM orders WHERE account_id=$1',[account])).rows[0].n,1);checks.push('quote expires during account wait without debit');
await assert.rejects(app.placeInternalOrder(db,account,randomUUID(),{...input,side:'SELL',quantity:3},randomUUID()));checks.push('unheld sell rejected');
const snapshot=await app.getAccountSnapshot(db,account);assert.equal(snapshot.account.cashCents,97532);assert.equal(snapshot.positions.length,1);assert.equal(snapshot.orders.length,1);assert.equal(Number(snapshot.positions[0].quantity),2);assert(snapshot.disclosure.includes('平台内部记账权益'));checks.push('database snapshot balance holdings orders and Chinese disclosure agree');
// Exercise the actual snapshot inside the same savepoint adapter used by delegated actions.
const outer=await db.connect();
try{
 await outer.query('BEGIN');
 await outer.query('UPDATE accounts SET cash_cents=90000 WHERE id=$1',[account]);
 let seq=0;
 const proxy={connect:async()=>{const name='snapshot_test_'+(++seq);return {query:(sql,args)=>sql==='BEGIN'?outer.query('SAVEPOINT '+name):sql==='COMMIT'?outer.query('RELEASE SAVEPOINT '+name):sql==='ROLLBACK'?outer.query('ROLLBACK TO SAVEPOINT '+name).then(()=>outer.query('RELEASE SAVEPOINT '+name)):outer.query(sql,args),release(){}}}};
 const nested=await app.getAccountSnapshot(proxy,account);assert.equal(nested.account.cashCents,90000);
 await outer.query('ROLLBACK');
}finally{outer.release()}
assert.equal((await db.query('SELECT cash_cents FROM accounts WHERE id=$1',[account])).rows[0].cash_cents,'97532');checks.push('nested snapshot uses savepoint and does not commit outer delegated transaction');
let rolledBack=false,released=false;
const brokenReader={connect:async()=>{const c=await db.connect();return {query:async(sql,args)=>{if(sql.includes('active_fund_principal_cents'))throw Error('Injected snapshot read failure');if(sql==='ROLLBACK')rolledBack=true;return c.query(sql,args)},release(){released=true;c.release()}}}};
await assert.rejects(app.getAccountSnapshot(brokenReader,account),/Injected snapshot read failure/);assert(rolledBack&&released);assert.equal((await app.getAccountSnapshot(db,account)).account.cashCents,97532);checks.push('failed snapshot rolls back releases connection and permits later reads');
// Isolated runner requires one admin login in its audit summary; existing contract suite covers authentication. Record no fake login here.
const secret=JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE)).totpSecret,{createHmac}=require('node:crypto');const bits=[...secret].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join(''),t=Buffer.alloc(8);t.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const mac=createHmac('sha1',Buffer.from(bits.match(/.{8}/g).map(x=>parseInt(x,2)))).update(t).digest(),otp=String((mac.readUInt32BE(mac[19]&15)&0x7fffffff)%1000000).padStart(6,'0');const login=await fetch('http://127.0.0.1:'+process.env.CN_OPS_QA_PORT+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'qa-master@example.test',password:'FixturePass123456!',otp})});assert.equal(login.status,200);
fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify({passed:true,checks},null,2));console.log(checks.join('\n'));
}finally{await db.end()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
