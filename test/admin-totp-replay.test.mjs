import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {totpCode} from '../src/totp.mjs';
import {matchedAdminTotpStep,claimAdminTotpStep} from '../src/admin-totp-replay.mjs';

const secret=Buffer.from('12345678901234567890','ascii');
const now=1_700_000_000_000;
const counter=Math.floor(now/30_000);

test('TOTP step matcher returns accepted step across permitted drift',()=>{
  for(const drift of [-1,0,1]){
    const code=totpCode(secret,{now:(counter+drift)*30_000});
    const matched=matchedAdminTotpStep(secret,code,{now});
    // Six-digit collisions are possible, but matched step must always verify.
    assert.notEqual(matched,null);
    assert.ok(Math.abs(matched-counter)<=1);
  }
  const far=totpCode(secret,{now:(counter-3)*30_000});
  if(![-1,0,1].some(d=>totpCode(secret,{now:(counter+d)*30_000})===far))
    assert.equal(matchedAdminTotpStep(secret,far,{now}),null);
  assert.equal(matchedAdminTotpStep(secret,'abc123',{now}),null);
  assert.equal(matchedAdminTotpStep(secret,'12345',{now}),null);
  assert.equal(matchedAdminTotpStep(secret,'123456',{now:-1,step:0}),null);
});

test('atomic DB claim rejects same and older time steps across concurrent challenges',async()=>{
  let used=null;
  const queries=[];
  const client={async query(sql,[userId,step]){
    queries.push({sql,userId,step});
    const didClaim=used===null||step>used;
    if(didClaim)used=step;
    return {rowCount:didClaim?1:0};
  }};
  const pair=await Promise.all([
    claimAdminTotpStep(client,'admin-1',counter),
    claimAdminTotpStep(client,'admin-1',counter)
  ]);
  assert.deepEqual(pair.sort(),[false,true]);
  assert.equal(await claimAdminTotpStep(client,'admin-1',counter-1),false);
  assert.equal(await claimAdminTotpStep(client,'admin-1',counter+1),true);
  assert.equal(used,counter+1);
  assert.ok(queries.every(q=>q.sql.includes('RETURNING user_id')&&q.sql.includes('last_login_totp_step < $2')));
  assert.deepEqual(queries.map(q=>q.userId),Array(4).fill('admin-1'));
  await assert.rejects(claimAdminTotpStep(client,'',counter),TypeError);
  await assert.rejects(claimAdminTotpStep(client,'admin-1',-1),TypeError);
});

test('candidate migration is isolated, nullable and constrains negative steps',async()=>{
  const sql=await readFile(new URL('../db/023_admin_totp_replay.sql',import.meta.url),'utf8');
  assert.match(sql,/ALTER TABLE admin_roles/);
  assert.match(sql,/ADD COLUMN last_login_totp_step bigint/);
  assert.match(sql,/CHECK \(last_login_totp_step IS NULL OR last_login_totp_step >= 0\)/);
  assert.doesNotMatch(sql,/DROP TABLE|TRUNCATE|DELETE FROM/i);
});

test('admin TOTP login uses the atomic step claim before session creation',async()=>{
  const source=await readFile(new URL('../src/admin-service.mjs',import.meta.url),'utf8');
  const claim=source.indexOf('claimAdminTotpStep(client,row.user_id,acceptedStep)');
  const session=source.indexOf('const token=await createSession(client,',claim);
  assert.ok(claim>0&&session>claim);
});
