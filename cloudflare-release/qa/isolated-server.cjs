const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');
const { Pool } = require('pg');
(async () => {
 const root = path.resolve(__dirname,'..');
 const dir = process.env.CN_QA_SAVE_DIR;
 if (!dir || !process.env.CN_ACCEPTANCE_PG_PORT) throw Error('Isolated runner required');
 const db = new PGlite(path.join(dir,'database'));
 await db.waitReady;
 await db.exec('CREATE TABLE schema_migrations(filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
 const files = fs.readdirSync(path.join(root,'db'));
 const migrations = [...files.filter(f=>/^\d/.test(f)).sort(), ...files.filter(f=>f.startsWith('migration-')).sort(), 'product-settlement-schema.sql','product-settlement-workflows.sql','commodity-reference-order-prices.sql'];
 for (const name of migrations) {
  await db.exec(fs.readFileSync(path.join(root,'db',name),'utf8').replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/ig,''));
 }
 const socket = new PGLiteSocketServer({db,host:'127.0.0.1',port:Number(process.env.CN_ACCEPTANCE_PG_PORT)});
 await socket.start();
 const pool = new Pool({connectionString:'postgresql://postgres@127.0.0.1:'+process.env.CN_ACCEPTANCE_PG_PORT+'/postgres',max:1});
 pool.on('connect',client=>{
  const query=client.query.bind(client);
  client.query=function(sql,values,...rest){
   if(typeof sql==='string'&&/INSERT INTO admin_audit_log/i.test(sql)&&values?.[2]==='subaccount.password.reset'&&fs.existsSync(path.join(dir,'reject-audit'))){
    return Promise.reject(new Error('Isolated audit write failure'));
   }
   if(typeof sql==='string'&&sql.includes("'client.delegated.action'")&&fs.existsSync(path.join(dir,'reject-delegated-audit')))return Promise.reject(Error('Isolated delegated audit failure'));
   if(typeof sql==='string'&&sql.includes('cn_fund_contracts')&&fs.existsSync(path.join(dir,'force-maturity'))){fs.unlinkSync(path.join(dir,'force-maturity'));return query("UPDATE cn_fund_contracts SET due_at=now()-interval '1 minute'").then(()=>query(sql,values,...rest));}
   if(typeof sql==='string'&&sql.includes("status='MATURED'")&&fs.existsSync(path.join(dir,'reject-maturity')))return Promise.reject(Error('Isolated maturity failure'));
   return query(sql,values,...rest);
  };
 });
 const source=fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8').replace('import { handleAsNodeRequest } from "cloudflare:node";','')+'\nexport {createApi,createSessionResolver,bootstrapMaster,registerAccount,createCommodityReferencePrice};';
 const runtime=path.join(dir,'runtime.mjs'); fs.writeFileSync(runtime,source);
 const app=await import(pathToFileURL(runtime));
 const email='qa-master@example.test',password='FixturePass123456!',setupKey=randomBytes(24).toString('hex');
 Object.assign(process.env,{ADMIN_MASTER_EMAIL:email,ADMIN_BOOTSTRAP_SECRET:setupKey,ADMIN_TOTP_ENCRYPTION_KEY:randomBytes(32).toString('hex'),CN_PROFILE_ENCRYPTION_KEY:randomBytes(32).toString('hex')});
 const master=await app.bootstrapMaster(pool,{email,password,setupKey});
 await pool.query("UPDATE admin_roles SET twofa_confirmed_at=now() WHERE role='MASTER'");
 for(const name of ['mobile','desktop','mobile-pending'])await app.registerAccount(pool,{email:'qa-'+name+'@example.test',password,openingCashCents:0});
 fs.writeFileSync(process.env.CN_OPS_MASTER_FILE,JSON.stringify({totpSecret:master.totpSecret}));
 let reference;
 if(process.env.CN_REFERENCE_FIXTURE==='1'){
  const rows=JSON.parse(fs.readFileSync(path.join(root,'qa','reference-quotes.json'),'utf8')).results;
  reference=app.createCommodityReferencePrice({COMMODITY_REFERENCE_EXECUTION_ENABLED:'true',EULERPOOL_API_KEY:'isolated-fixture'},async(url)=>{
   const id=new URL(url).pathname.split('/').at(-1);
   const row=rows.find(x=>x.profile.isin===id);
   if(!row)return new Response(null,{status:404});
   return Response.json(url.includes('/profile/')?row.profile:[row.last]);
  },()=>Math.max(...rows.map(x=>x.last[0]))+1000);
 }
 // Historical replay retains recorded prices; its execution clock is relative to this isolated run.
 const listener=app.createApi({db:pool,resolveSession:app.createSessionResolver(pool),resolveExecutionPrice:reference?undefined:async({side,symbol})=>['AAPL','NVDA','SPY'].includes(symbol)?{priceCents:side==='BUY'?1234:1233,fxUsdMicros:1000000,timestampMs:Date.now()}:null,resolveCommodityReferencePrice:reference?async input=>({...await reference(input),timestampMs:Date.now()-60000}):undefined,resolveProductQuote:async({symbol,market})=>({symbol,market,name:symbol==='AAPL'?'Apple Inc':'NVIDIA Corp',priceCents:35069,timestampMs:Date.now()-60000})}).listen(Number(process.env.CN_OPS_QA_PORT),'127.0.0.1',()=>console.log('Isolated local QA API ready'));
 process.on('message',async()=>{
  listener.close();
  const audit=(await pool.query('SELECT action,count(*)::int AS count FROM admin_audit_log GROUP BY action ORDER BY action')).rows;
  fs.writeFileSync(path.join(dir,'audit-summary.json'),JSON.stringify(audit,null,2));
  if(!audit.some(x=>x.action==='admin.login'))throw Error('Audit login missing');
  await pool.end(); await socket.stop(); await db.close(); process.exit(0);
 });
})().catch(error=>{console.error(error.stack);process.exit(1)});
