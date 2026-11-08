import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
const connection=process.env.TEST_DATABASE_URL;
const run=connection&&/admin_stage3_isolated(?:\?|$)/.test(connection)?test:test.skip;
const candidates=[
  'migration-candidates/023_admin_totp_replay.sql',
  'migration-candidates/024_internal_order_quote_evidence.sql'
];
const errorCode=(code)=>(e)=>e?.code===code;
run('stage3 disposable PG16: 023 then 024 constraints, financial preservation, transactional rollback',async()=>{
  const db=new Pool({connectionString:connection,max:3});
  try{
    const before=await db.query("SELECT (SELECT count(*)::int FROM schema_migrations) AS migrations, "+
      "(SELECT count(*)::int FROM accounts) AS accounts, "+
      "(SELECT count(*)::int FROM cash_ledger) AS ledger, "+
      "(SELECT coalesce(sum(cash_cents),0)::numeric FROM accounts) AS cash");
    assert.equal(before.rows[0].migrations,23);
    assert.equal(before.rows[0].accounts,2);
    assert.equal(before.rows[0].ledger,2);
    assert.equal((await db.query("SELECT to_regclass('public.order_execution_evidence') IS NULL AS absent")).rows[0].absent,true);
    for(const path of candidates){
      const source=await readFile(new URL('../'+path,import.meta.url),'utf8');
      assert.match(source,/BEGIN;\s*/);
      assert.match(source,/COMMIT;\s*$/);
      await db.query(source);
    }
    const objects=await db.query("SELECT (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='admin_roles' AND column_name='last_login_totp_step') AS totp_col, "+
      "to_regclass('public.order_execution_evidence') IS NOT NULL AS evidence_table");
    assert.equal(objects.rows[0].totp_col,1);
    assert.equal(objects.rows[0].evidence_table,true);
    const after=await db.query("SELECT (SELECT count(*)::int FROM schema_migrations) AS migrations, "+
      "(SELECT count(*)::int FROM accounts) AS accounts, "+
      "(SELECT count(*)::int FROM cash_ledger) AS ledger, "+
      "(SELECT coalesce(sum(cash_cents),0)::numeric FROM accounts) AS cash");
    assert.deepEqual(after.rows,before.rows,'023/024 must not mutate existing money, accounts, or migration journal');

    const conn=await db.connect();
    try{
      await conn.query('BEGIN');
      const ref=(await conn.query("SELECT id FROM accounts ORDER BY created_at,id LIMIT 1")).rows[0]?.id;
      assert.ok(ref);
      const order=randomUUID();
      await conn.query("INSERT INTO orders(id,account_id,idempotency_key,market,symbol,side,quantity,price_cents,fx_usd_micros,amount_usd_cents) "+
        "VALUES($1,$2,$3,'CN','600000','BUY',1,100,100000,10)",
        [order,ref,'stage3-temp-'+randomUUID()]);
      await conn.query("INSERT INTO order_execution_evidence(order_id,account_id,market,symbol,quote_currency,quote_price_cents,quote_at,quote_source,quote_license_ref,session_rule_ref,fx_usd_micros,fx_at,fx_source,fx_license_ref) "+
        "VALUES($1,$2,'CN','600000','CNY',100,now(),'isolated-fixture','fixture-license-not-production','fixture-session-rule',100000,now(),'fixture-FX','fixture-FX-license')",
        [order,ref]);
      await conn.query('SAVEPOINT bad_fx');
      await assert.rejects(conn.query("INSERT INTO order_execution_evidence(order_id,account_id,market,symbol,quote_currency,quote_price_cents,quote_at,quote_source,quote_license_ref,session_rule_ref,fx_usd_micros) "+
        "VALUES($1,$2,'US','TEST','CNY',100,now(),'fixture','fixture','fixture',1000000)",
        [randomUUID(),ref]),errorCode('23503')); // no order FK, so rejects before publishing
      await conn.query('ROLLBACK TO SAVEPOINT bad_fx');
      const q=await conn.query("SELECT market,quote_currency,fx_source FROM order_execution_evidence WHERE order_id=$1",[order]);
      assert.equal(q.rows.length,1);
      assert.equal(q.rows[0].market,'CN');
      assert.equal(q.rows[0].quote_currency,'CNY');
      await conn.query('ROLLBACK');
      assert.equal((await db.query('SELECT count(*)::int AS n FROM order_execution_evidence')).rows[0].n,0);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM orders WHERE id=$1',[order])).rows[0].n,0);
    }finally{conn.release();}
    // The exercise explicitly verifies a clean DDL rollback in a disposable DB.
    await db.query('DROP TABLE order_execution_evidence');
    await db.query('ALTER TABLE admin_roles DROP CONSTRAINT admin_last_login_totp_step_nonnegative');
    await db.query('ALTER TABLE admin_roles DROP COLUMN last_login_totp_step');
    const rolled=await db.query("SELECT to_regclass('public.order_execution_evidence') IS NULL AS evidence_absent, "+
      "NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='admin_roles' AND column_name='last_login_totp_step') AS totp_absent");
    assert.equal(rolled.rows[0].evidence_absent,true);
    assert.equal(rolled.rows[0].totp_absent,true);
    const final=await db.query("SELECT (SELECT count(*)::int FROM schema_migrations) AS migrations, "+
      "(SELECT count(*)::int FROM accounts) AS accounts, "+
      "(SELECT count(*)::int FROM cash_ledger) AS ledger, "+
      "(SELECT coalesce(sum(cash_cents),0)::numeric FROM accounts) AS cash");
    assert.deepEqual(final.rows,before.rows);
    process.stdout.write('STAGE3_023_024_MIGRATE_ROLLBACK_PRESERVED_LEDGER=true\n');
  }finally{await db.end();}
});
