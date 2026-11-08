import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {hashPassword} from '../src/auth.mjs';

const url=process.env.TEST_DATABASE_URL;
if(!url||!/admin_stage3_isolated(?:\?|$)/.test(url))
  throw new Error('Refusing backup exercise outside explicitly named disposable admin_stage3_isolated DB');
const restored=process.env.RESTORED_DATABASE_URL;
const rows=[
  {email:'admin-stage3-backup-a@example.test',balance:12045},
  {email:'admin-stage3-backup-b@example.test',balance:9876}
];
const pool=new Pool({connectionString:url});
const action=process.argv[2];
try{
  if(action==='seed'){
    for(const row of rows){
      const userId=randomUUID(),accountId=randomUUID();
      await pool.query('INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3)',
        [userId,row.email,await hashPassword('isolated-stage3-backup-only')]);
      await pool.query('INSERT INTO accounts(id,user_id,cash_cents) VALUES($1,$2,$3)',
        [accountId,userId,row.balance]);
      await pool.query('INSERT INTO cash_ledger(account_id,delta_cents,balance_after_cents) VALUES($1,$2,$3)',
        [accountId,row.balance,row.balance]);
    }
    process.stdout.write('STAGE3_BACKUP_FIXTURE_SEEDED=2\n');
  }else if(action==='verify'){
    if(!restored||!/admin_stage3_restore(?:\?|$)/.test(restored))
      throw new Error('Refusing restore verification outside explicitly named admin_stage3_restore DB');
    const db=new Pool({connectionString:restored});
    try{
      const q=await db.query("SELECT u.email,a.cash_cents AS balance,l.delta_cents,l.balance_after_cents "+
       "FROM app_users u JOIN accounts a ON a.user_id=u.id "+
       "LEFT JOIN LATERAL (SELECT delta_cents,balance_after_cents FROM cash_ledger WHERE account_id=a.id ORDER BY id DESC LIMIT 1) l ON true "+
       "WHERE u.email LIKE 'admin-stage3-backup-%@example.test' ORDER BY u.email");
      if(q.rows.length!==rows.length)throw new Error('Backup fixture row count differs');
      for(let i=0;i<rows.length;i++){
        if(q.rows[i].email!==rows[i].email||
          BigInt(q.rows[i].balance)!==BigInt(rows[i].balance)||
          BigInt(q.rows[i].delta_cents)!==BigInt(rows[i].balance)||
          BigInt(q.rows[i].balance_after_cents)!==BigInt(rows[i].balance))
          throw new Error('Account or ledger data corrupted after restore');
      }
      const schema=await db.query("SELECT to_regclass('public.order_execution_evidence') IS NULL AS no_024, "+
        "NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='admin_roles' AND column_name='last_login_totp_step') AS no_023, "+
        "(SELECT count(*)::int FROM schema_migrations) AS migration_rows");
      if(schema.rows.length!==1||schema.rows[0].no_024!==true||schema.rows[0].no_023!==true||schema.rows[0].migration_rows!==23)
        throw new Error('Restored 001-022 schema does not match pre-migration baseline');
      process.stdout.write('STAGE3_BACKUP_RESTORE_VERIFIED=2_accounts_2_ledger_rows_schema_001_022\n');
    }finally{await db.end();}
  }else throw new Error('Expected seed or verify');
}finally{await pool.end();}
