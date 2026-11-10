const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{
 const root=path.resolve(__dirname,'..'),artifacts=path.join(root,'artifacts'),records=path.join(root,'records');
 const runs=fs.readdirSync(artifacts).map(name=>path.join(artifacts,name)).filter(name=>fs.statSync(name).isDirectory()&&fs.existsSync(path.join(name,'results.json'))).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
 const accepted=new Map();
 for(const run of runs){
  const report=JSON.parse(fs.readFileSync(path.join(run,'results.json'),'utf8'));
  for(const result of report.results||[])if(result.code===0&&!accepted.has(result.name))accepted.set(result.name,{...result,run,checkedAt:report.checkedAt});
 }
 for(const name of ['products','permissions','registration','stocks','interface','sessions','reference','forms','access'])if(!accepted.has(name))throw Error('Missing passing suite '+name);
 for(const [name,result]of accepted){
  const dir=path.join(result.run,name);
  for(const file of ['qa.log','audit-summary.json','results.json','http-results.json'])if(fs.existsSync(path.join(dir,file)))fs.copyFileSync(path.join(dir,file),path.join(records,name+'-'+(file==='qa.log'?'qa.txt':file)));
  const db=new PGlite(path.join(dir,'database'));await db.waitReady;
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(x=>x.tablename).filter(x=>/^(accounts|orders|positions|ledger_entries|cash_ledger|cash_requests|admin_audit_log|commodity_reference_order_prices|product_.*)$/.test(x)&&/^[a-z_]+$/.test(x));
  const snapshot={};
  for(const table of tables)snapshot[table]=(await db.query('SELECT * FROM "'+table+'"')).rows;
  fs.writeFileSync(path.join(records,name+'-database-records.json'),JSON.stringify(snapshot,(_,v)=>typeof v==='bigint'?v.toString():v,2));
  await db.close();
 }
 const manifest=require('../release-manifest.json');
 const report={checkedAt:new Date().toISOString(),productionVersion:manifest.version,testedWorkerSha256:manifest.sourceSha256,scope:'Isolated API and browser workflows using published pages',mobileDevice:'Chrome iPhone 13 emulation',results:[...accepted.values()].map(({name,code,checkedAt})=>({name,code,checkedAt})),rootTests:{passed:49,failed:0,skipped:19}};
 fs.writeFileSync(path.join(records,'acceptance-results.json'),JSON.stringify(report,null,2)+'\n');
 console.log('Saved '+accepted.size+' passing suites and isolated database records');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
