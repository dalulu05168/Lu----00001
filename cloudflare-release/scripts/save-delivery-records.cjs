
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{
const root=path.resolve(__dirname,'..'),run=path.resolve(process.argv[2]||'');
assert(process.argv[2]&&run.startsWith(path.join(root,'artifacts')+path.sep),'Pass the exact acceptance run');
const report=JSON.parse(fs.readFileSync(path.join(run,'results.json'),'utf8'));
const manifest=require('../release-manifest.json');
assert.equal(report.sourceSha256,manifest.sourceSha256,'Tests must match the released source');
assert.equal(report.sourceUnchanged,true);
assert(report.results.length>=12&&report.results.every(x=>x.code===0),'Every required suite must pass in this run');
const target=path.join(root,'records','delivery-2026-11-10');fs.mkdirSync(target,{recursive:true});
for(const result of report.results){
const dir=path.join(run,result.name);
for(const file of ['qa.log','audit-summary.json','results.json','http-results.json'])if(fs.existsSync(path.join(dir,file)))fs.copyFileSync(path.join(dir,file),path.join(target,result.name+'-'+file));
const db=new PGlite(path.join(dir,'database'));await db.waitReady;
const names=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(x=>x.tablename).filter(x=>/^(accounts|orders|positions|cash_ledger|cash_requests|admin_audit_log|commodity_reference_order_prices|product_.*|cn_fund_contracts|cn_bulk_order_terms)$/.test(x)&&/^[a-z_]+$/.test(x));
const records={};for(const name of names)records[name]=(await db.query('SELECT * FROM "'+name+'"')).rows;
fs.writeFileSync(path.join(target,result.name+'-database.json'),JSON.stringify(records,(_,v)=>typeof v==='bigint'?v.toString():v,2));await db.close();
}
fs.writeFileSync(path.join(target,'acceptance.json'),JSON.stringify({...report,publishedVersion:manifest.version},null,2));
if(fs.existsSync(path.join(root,'artifacts/delivery-live-quotes.json')))fs.copyFileSync(path.join(root,'artifacts/delivery-live-quotes.json'),path.join(target,'live-reference-quotes.json'));
console.log('Saved exact-source acceptance and isolated order, cash, holdings and fund records: '+target);
})().catch(e=>{console.error(e.stack);process.exitCode=1});

