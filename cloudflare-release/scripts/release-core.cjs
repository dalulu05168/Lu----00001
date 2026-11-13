'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const stable=x=>JSON.stringify(canonical(x));
function canonical(x){return Array.isArray(x)?x.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;}
const production=['nuvexapro.com','m.nuvexapro.com','admin.maacropierce.com','lu----00001.dalulu05168.workers.dev'];
function files(dir,prefix=''){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{assert(!e.isSymbolicLink(),'Symlink forbidden');const name=prefix+e.name;return e.isDirectory()?files(path.join(dir,e.name),name+'/'):[name];}).sort();}
function inventory(dir){return Object.fromEntries(files(dir).map(p=>[p,sha(fs.readFileSync(path.join(dir,p)))]));}
function artifactCheck(dir=path.join(root,'dist')){
 const lock=read(path.join(root,'candidate-lock.json'));
 assert.deepEqual(inventory(dir),lock.files,'Artifact inventory/hash mismatch; rebuild accepted candidate');
 const accepted=read(path.join(root,'docs/release-review-58/artifact-manifest.json'));
 for(const [file,hash] of Object.entries(accepted.files))assert.equal(lock.files[file],hash,'Accepted artifact differs: '+file);
 return lock;
}
function targetCheck(t){
 assert.equal(t.environment,'staging','Only staging is supported');
 assert(/^nuvexa-staging-[a-z0-9-]+$/.test(t.worker),'Independent staging Worker required');
 assert(/^[a-f0-9]{32}$/.test(t.accountId),'Account ID required');
 assert.equal(Object.keys(t.hosts).sort().join(','),'admin,client,mobile,workersDev');
 const hosts=Object.values(t.hosts);assert.equal(new Set(hosts).size,4,'Distinct hosts required');
 for(const host of hosts){assert(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host),'Invalid test hostname');assert(!production.some(p=>host===p||host.endsWith('.'+p)),'Production hostname forbidden');}
 assert(t.hosts.workersDev.startsWith(t.worker+'.')&&t.hosts.workersDev.endsWith('.workers.dev'),'workers.dev does not match Worker');
 assert(/^[a-f0-9]{32}$/.test(t.zoneId),'Explicit test zone required');
 assert(t.neon.projectId&&t.neon.branchId&&t.neon.endpointId&&t.neon.database&&t.neon.role,'Neon isolation identity required');
 assert(t.neon.isolated===true&&t.neon.syntheticDataOnly===true,'Synthetic isolated DB required');
 assert(!t.neon.productionBranchIds.includes(t.neon.branchId)&&t.neon.productionBranchIds.length>0,'Production branch forbidden/unknown');
 assert(!t.neon.productionEndpointHosts.includes(t.neon.endpointHost)&&t.neon.productionEndpointHosts.length>0,'Production endpoint forbidden/unknown');
 assert(/^ep-[a-z0-9-]+(?:-pooler)?\.[a-z0-9.-]+\.neon\.tech$/.test(t.neon.endpointHost),'Neon endpoint required');
 assert.equal(t.crons.length,0,'Staging cron is disabled until separately approved');
 assert.equal(t.wranglerVersion,'4.134.0','Pinned Wrangler version required');
 return t;
}
function databaseCheck(t,value){
 const u=new URL(value);assert(['postgres:','postgresql:'].includes(u.protocol));
 assert.equal(u.hostname,t.neon.endpointHost,'DB host differs from isolated endpoint');
 assert.equal(decodeURIComponent(u.pathname.slice(1)),t.neon.database,'DB name mismatch');
 assert.equal(decodeURIComponent(u.username),t.neon.role,'DB role mismatch');
 assert.equal(u.searchParams.get('sslmode'),'require','DB TLS required');assert(u.password,'DB password required');
}
function prepare(t,out){
 targetCheck(t);const lock=artifactCheck();assert(!fs.existsSync(out),'Output must be new');
 const dir=path.resolve(out);assert(dir.startsWith(path.join(root,'artifacts')+path.sep),'Use artifacts/ output');
 fs.mkdirSync(path.join(dir,'assets'),{recursive:true});
 const mapping=Object.fromEntries(production.map((p,i)=>[p,[t.hosts.client,t.hosts.mobile,t.hosts.admin,t.hosts.workersDev][i]]));
 for(const name of Object.keys(lock.files)){
  let data=fs.readFileSync(path.join(root,'dist',name));
  if(/\.(mjs|html)$/.test(name)){let s=data.toString(); // One pass avoids cascading hostname replacements.
   s=s.replace(/lu----00001\.dalulu05168\.workers\.dev|admin\.maacropierce\.com|m\.nuvexapro\.com|nuvexapro\.com/g,h=>mapping[h]);
   assert(!production.some(h=>s.includes(h)),'Unmapped production host');data=Buffer.from(s);
  }
  fs.writeFileSync(path.join(dir,name),data);
 }
 const config={name:t.worker,account_id:t.accountId,main:'worker.mjs',compatibility_date:'2026-11-08',compatibility_flags:['nodejs_compat'],workers_dev:true,preview_urls:false,
  assets:{directory:'assets',binding:'ASSETS',run_worker_first:true},vars:{PGSSL:'require',COMMODITY_REFERENCE_EXECUTION_ENABLED:'true'},observability:{enabled:true},triggers:{crons:[]},
  version_metadata:{binding:'RELEASE_VERSION'},routes:[t.hosts.client,t.hosts.admin,t.hosts.mobile].map(pattern=>({pattern,zone_id:t.zoneId,custom_domain:true}))};
 fs.writeFileSync(path.join(dir,'wrangler.json'),JSON.stringify(config,null,2)+'\n');
 fs.writeFileSync(path.join(dir,'bootstrap.mjs'),"export default {fetch(){return new Response('Staging provisioning; unavailable',{status:503});},scheduled(){}};\n");
 fs.writeFileSync(path.join(dir,'wrangler.bootstrap.json'),JSON.stringify({...config,main:'bootstrap.mjs'},null,2)+'\n');
 const bundle={sourceLock:sha(Buffer.from(stable(lock))),target:t,files:inventory(dir)};
 fs.writeFileSync(path.join(dir,'bundle.json'),JSON.stringify(bundle,null,2)+'\n');return bundle;
}
function bundleCheck(dir,t){
 targetCheck(t);const b=read(path.join(dir,'bundle.json'));assert.equal(stable(t),stable(b.target),'Target changed');
 assert.equal(b.sourceLock,sha(Buffer.from(stable(artifactCheck()))),'Source lock changed');
 const current=inventory(dir);delete current['bundle.json'];assert.deepEqual(current,b.files,'Prepared bundle changed');return b;
}
function active(s,id){assert.deepEqual(s.versions,[{version_id:id,percentage:100}],'Active version drift');}
function invariant(before,after){
 for(const key of ['domains','routes','settings','schedules'])assert.equal(stable(after[key]),stable(before[key]),key+' drift');
}
function rollbackCheck(before,current){
 assert(before.rollbackVersion&&before.rollbackVersion.id,'Rollback version missing');
 assert.equal(before.rollbackVersion.id,before.versions[0].version_id,'Rollback target mismatch');
 assert.equal(stable(before.rollbackVersion.resources),stable(current.rollbackVersion.resources),'Rollback resources no longer available');
 assert(before.databaseRecoveryVerified===true,'Database recovery drill not verified');
 invariant(before,current);return true;
}
// The adapter must implement authenticated reads, an explicitly staging-only write, and probes.
async function release({target,bundle,before,adapter}){
 targetCheck(target);assert(before.worker===target.worker,'Snapshot target mismatch');assert.equal(before.versions.length,1);
 active(before,before.versions[0].version_id);const fresh=await adapter.snapshot();
 active(fresh,before.versions[0].version_id);rollbackCheck(before,fresh);
 const candidate=await adapter.upload(bundle);assert(candidate.id&&candidate.id!==before.versions[0].version_id,'New version required');
 const uploaded=await adapter.snapshot();active(uploaded,before.versions[0].version_id);invariant(before,uploaded);
 await adapter.validateVersion(candidate,bundle);
 const preActivate=await adapter.snapshot();active(preActivate,before.versions[0].version_id);rollbackCheck(before,preActivate);
 await adapter.activate(candidate.id);
 const after=await adapter.snapshot();active(after,candidate.id);invariant(before,after);
 await adapter.probe(candidate.id,bundle);rollbackCheck(before,after);
 return {version:candidate.id,previous:before.versions[0].version_id,verified:true};
}
module.exports={root,sha,read,stable,inventory,artifactCheck,targetCheck,databaseCheck,prepare,bundleCheck,active,invariant,rollbackCheck,release};
