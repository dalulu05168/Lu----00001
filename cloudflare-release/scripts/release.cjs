'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const c=require('./release-core.cjs');
function run(args){
 const entry=process.env.WRANGLER_ENTRY;assert(entry&&path.isAbsolute(entry),'Set WRANGLER_ENTRY to installed wrangler/bin/wrangler.js');
 const pkg=c.read(path.resolve(path.dirname(entry),'../package.json'));assert.equal(pkg.name,'wrangler');assert.equal(pkg.version,'4.134.0','Wrong Wrangler version');
 const r=spawnSync(process.execPath,[entry,...args],{cwd:c.root,encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'},timeout:180000});
 assert(!r.error&&r.status===0,'Wrangler failed; deployment stopped (inspect local Wrangler logs)');return r.stdout;
}
function client(t){
 assert(process.env.CLOUDFLARE_API_TOKEN,'CLOUDFLARE_API_TOKEN required');
 const base='https://api.cloudflare.com/client/v4',prefix='/accounts/'+t.accountId+'/workers/scripts/'+t.worker;
 async function api(p,options={}){
  const r=await fetch(base+p,{...options,headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,...options.headers},signal:AbortSignal.timeout(30000)});
  assert(r.ok,'Cloudflare HTTP '+r.status);const j=await r.json();assert(j.success,'Cloudflare request failed');return j;
 }
 async function all(p){const rows=[];for(let page=1;page<=100;page++){const j=await api(p+(p.includes('?')?'&':'?')+'page='+page+'&per_page=100');assert(Array.isArray(j.result));rows.push(...j.result);if(j.result_info?.total_pages===undefined){assert(j.result.length<100,'Unproven pagination completeness');return rows;}if(page>=j.result_info.total_pages)return rows;}throw Error('Pagination incomplete');}
 async function snapshot({placeholder=false}={}){
  const [deployment,domains,routes,settings,schedules]=await Promise.all([api(prefix+'/deployments'),all('/accounts/'+t.accountId+'/workers/domains'),all('/zones/'+t.zoneId+'/workers/routes'),api(prefix+'/settings'),api(prefix+'/schedules')]);
  const versions=deployment.result.deployments[0].versions;assert.equal(versions.length,1,'Split deployment unsupported');assert.equal(versions[0].percentage,100);
  const rollbackVersion=(await api(prefix+'/versions/'+versions[0].version_id)).result;
  const required=c.read(path.join(c.root,'runtime-bindings.json')).bindings;
  if(placeholder){
   assert.equal(rollbackVersion.resources.bindings?.length??0,0,'Placeholder must have no bindings');
   assert.equal(settings.result.bindings?.length??0,0,'Placeholder settings must have no bindings');
  }else{
   for(const binding of [...required,{name:'RELEASE_VERSION',type:'version_metadata'}])assert(rollbackVersion.resources.bindings.some(b=>b.name===binding.name&&b.type===binding.type),'Missing staging binding '+binding.name);
   assert.equal(rollbackVersion.resources.script_runtime.compatibility_date,'2026-11-08');
   assert.equal(c.stable(rollbackVersion.resources.script_runtime.compatibility_flags),c.stable(['nodejs_compat']));
  }
  const ownedDomains=domains.filter(d=>d.service===t.worker),ownedRoutes=routes.filter(r=>r.script===t.worker);
  assert.equal(c.stable(ownedDomains.map(d=>d.hostname)),c.stable([t.hosts.client,t.hosts.admin,t.hosts.mobile]),'Test domains not provisioned exactly');
  assert.equal(ownedRoutes.length,0,'Unexpected zone route overrides');assert.equal(c.stable(schedules.result.schedules||schedules.result),c.stable([]),'Staging schedules must be empty');
  assert(ownedDomains.every(d=>d.zone_id===t.zoneId),'Unexpected staging zone');
  for(const route of routes){
   const pattern=route.pattern.replace(/^https?:\/\//,'');
   const host=pattern.split('/')[0];
   const regex=new RegExp('^'+host.split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$','i');
   assert(![t.hosts.client,t.hosts.admin,t.hosts.mobile].some(name=>regex.test(name)),'Zone route overlaps staging domain');
  }
  const safeSettings={...settings.result}; // Cloudflare returns secret names/types, never secret values.
  delete safeSettings.modified_on;delete safeSettings.created_on;
  for(const b of safeSettings.bindings||[])assert(b.type!=='secret_text'||!('text' in b),'Unexpected secret disclosure');
  return {worker:t.worker,versions,domains:ownedDomains,routes:ownedRoutes,settings:safeSettings,schedules:schedules.result,rollbackVersion};
 }
 return {api,prefix,snapshot};
}
async function neonCheck(t){
 assert(process.env.NEON_API_KEY,'NEON_API_KEY required for isolation control-plane check');
 async function get(p){const r=await fetch('https://console.neon.tech/api/v2/projects/'+encodeURIComponent(t.neon.projectId)+p,{headers:{Authorization:'Bearer '+process.env.NEON_API_KEY},signal:AbortSignal.timeout(30000)});assert(r.ok,'Neon isolation check failed HTTP '+r.status);return r.json();}
 const [branch,ep]=await Promise.all([get('/branches/'+encodeURIComponent(t.neon.branchId)),get('/endpoints/'+encodeURIComponent(t.neon.endpointId))]);
 assert.equal(branch.branch.id,t.neon.branchId);assert.equal(branch.branch.default,false,'Default Neon branch forbidden');
 assert.equal(ep.endpoint.branch_id,t.neon.branchId);assert.equal(ep.endpoint.host.replace('-pooler.','.'),t.neon.endpointHost.replace('-pooler.','.'));
}
async function main(){
 const [mode,targetFile,dirArg,recordArg]=process.argv.slice(2);
 if(mode==='check'){console.log(JSON.stringify({checked:true,...c.artifactCheck()}));return;}
 const t=c.targetCheck(c.read(path.resolve(targetFile))),dir=path.resolve(c.root,dirArg||'artifacts/staging');
 if(mode==='prepare'){c.prepare(t,dir);console.log('Prepared isolated staging bundle: '+dir);return;}
 const bundle=c.bundleCheck(dir,t);
 if(mode==='validate'){console.log('Bundle, assets, target and candidate lock verified');return;}
 if(mode==='dry-run'){run(['deploy','--dry-run','--config',path.join(dir,'wrangler.json'),'--outdir',path.join(dir,'dry-run')]);console.log('Dry-run passed; use a fresh prepared directory before deployment');return;}
 const live=client(t);
 if(mode==='takeover'){
  assert.equal(process.env.NUVEXA_STAGING_WRITE,t.worker,'Explicit staging write approval required');
  const expected=process.env.NUVEXA_STAGING_PLACEHOLDER_VERSION;
  assert(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(expected||''),'Pin the full existing placeholder version ID');
  assert(recordArg,'New takeover journal path required');
  await neonCheck(t);
  const before=await live.snapshot({placeholder:true});c.active(before,expected);
  const journal=path.resolve(recordArg);
  fs.writeFileSync(journal,JSON.stringify({step:'baseline',at:new Date().toISOString(),before})+'\n',{flag:'wx'});
  const log=(step,extra={})=>fs.appendFileSync(journal,JSON.stringify({step,...extra,at:new Date().toISOString()})+'\n');
  const message='staging-503-takeover:'+require('node:crypto').randomUUID();
  log('upload-start');
  run(['versions','upload','--no-bundle','--config',path.join(dir,'wrangler.bootstrap.json'),'--message',message]);
  const list=(await live.api(live.prefix+'/versions')).result.items;
  const matches=list.filter(v=>(v.annotations||v.metadata?.annotations)?.['workers/message']===message);
  assert.equal(matches.length,1,'Uploaded placeholder annotation mismatch');
  const id=matches[0].id;log('uploaded',{version:id});
  const candidate=(await live.api(live.prefix+'/versions/'+id)).result;
  const expectedBindings=[['ASSETS','assets'],['RELEASE_VERSION','version_metadata'],['PGSSL','plain_text'],['COMMODITY_REFERENCE_EXECUTION_ENABLED','plain_text']];
  assert.equal(c.stable(candidate.resources.bindings.map(b=>[b.name,b.type])),c.stable(expectedBindings),'Unexpected placeholder bindings');
  assert.equal(candidate.resources.script_runtime.compatibility_date,'2026-11-08');
  assert.equal(c.stable(candidate.resources.script_runtime.compatibility_flags),c.stable(['nodejs_compat']));
  const fresh=await live.snapshot({placeholder:true});c.active(fresh,expected);c.invariant(before,fresh);
  log('activation-start',{version:id});
  await live.api(live.prefix+'/deployments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({strategy:'percentage',versions:[{version_id:id,percentage:100}]})});
  log('activated',{version:id});
  const after=(await live.api(live.prefix+'/deployments')).result.deployments[0];c.active({versions:after.versions},id);
  for(const host of [t.hosts.client,t.hosts.admin,t.hosts.mobile]){
   const response=await fetch('https://'+host+'/',{redirect:'manual',signal:AbortSignal.timeout(15000)});
   assert.equal(response.status,503,'Unexpected placeholder status');
   assert.equal(await response.text(),'Staging provisioning; unavailable','Unexpected placeholder response');
  }
  log('verified',{version:id});console.log(JSON.stringify({placeholderVersion:id,previous:expected}));return;
 }
 if(mode==='bootstrap'){
  assert.equal(process.env.NUVEXA_STAGING_WRITE,t.worker,'Explicit staging write approval required');await neonCheck(t);
  const r=await fetch('https://api.cloudflare.com/client/v4'+live.prefix+'/settings',{headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},signal:AbortSignal.timeout(30000)});
  assert.equal(r.status,404,'Bootstrap requires a new Worker; existing Worker cannot be replaced');
  run(['deploy','--config',path.join(dir,'wrangler.bootstrap.json')]);console.log('Created staging-only 503 bootstrap; no database code is active');return;
 }
 if(mode==='bind-db'){
  assert.equal(process.env.NUVEXA_STAGING_WRITE,t.worker,'Explicit staging write approval required');
  c.databaseCheck(t,process.env.STAGING_DATABASE_URL);await neonCheck(t);
  await live.api(live.prefix+'/secrets',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'DATABASE_URL',type:'secret_text',text:process.env.STAGING_DATABASE_URL})});
  console.log('Bound verified isolated DB to staging Worker; take a new baseline snapshot');return;
 }
 assert(recordArg,'Snapshot record path required');const record=path.resolve(recordArg);
 if(mode==='snapshot'){
  assert(!fs.existsSync(record),'Never overwrite baseline');await neonCheck(t);
  // A real restore drill must be recorded by the operator; no inferred success.
  const drill=c.read(process.env.NUVEXA_DB_DRILL_FILE||'');
  assert.equal(drill.branchId,t.neon.branchId);assert.equal(drill.restoredAndVerified,true);assert(drill.evidence&&drill.completedAt);
  const state=await live.snapshot();state.databaseRecoveryVerified=true;state.databaseDrill=drill;state.bundleSha=c.sha(Buffer.from(c.stable(bundle)));state.capturedAt=new Date().toISOString();
  fs.writeFileSync(record,JSON.stringify(state,null,2)+'\n',{flag:'wx'});console.log('Saved staging baseline and rollback resources');return;
 }
 const before=c.read(record);assert.equal(before.bundleSha,c.sha(Buffer.from(c.stable(bundle))),'Snapshot belongs to different bundle');
 if(mode==='rollback-check'){const now=await live.snapshot();now.rollbackVersion=(await live.api(live.prefix+'/versions/'+before.rollbackVersion.id)).result;c.rollbackCheck(before,now);console.log('Rollback resources and external settings verified; no rollback performed');return;}
 assert.equal(mode,'deploy','Unknown command');assert.equal(process.env.NUVEXA_STAGING_WRITE,t.worker,'Explicit staging write approval required');
 assert(Date.now()-Date.parse(before.capturedAt)<30*60*1000,'Baseline expired');await neonCheck(t);
 const journal=record+'.journal.jsonl';fs.writeFileSync(journal,JSON.stringify({step:'start',previous:before.rollbackVersion.id,at:new Date().toISOString()})+'\n',{flag:'wx'});
 const log=(step,extra={})=>fs.appendFileSync(journal,JSON.stringify({step,...extra,at:new Date().toISOString()})+'\n');
 const adapter={snapshot:async()=>{log('snapshot');const s=await live.snapshot();s.rollbackVersion=(await live.api(live.prefix+'/versions/'+before.rollbackVersion.id)).result;return s;},
  upload:async()=>{log('upload-start');const message=bundle.files['worker.mjs']+':'+require('node:crypto').randomUUID();run(['versions','upload','--config',path.join(dir,'wrangler.json'),'--message',message]);const list=(await live.api(live.prefix+'/versions')).result.items;const matches=list.filter(v=>(v.annotations||v.metadata?.annotations)?.['workers/message']===message);assert.equal(matches.length,1,'Uploaded version annotation mismatch');const v=matches[0];log('uploaded',{version:v.id});return (await live.api(live.prefix+'/versions/'+v.id)).result;},
  validateVersion:async(v)=>{
   const original=before.rollbackVersion.resources;
   assert.equal(c.stable(v.resources.script_runtime),c.stable(original.script_runtime),'Runtime changed');
   const normalize=rows=>rows.map(b=>b.type==='assets'?{type:b.type,name:b.name}:b);
   assert.equal(c.stable(normalize(v.resources.bindings)),c.stable(normalize(original.bindings)),'Binding value/type/name drift');
  },
  activate:async(id)=>{log('activation-start',{version:id});await live.api(live.prefix+'/deployments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({strategy:'percentage',versions:[{version_id:id,percentage:100}]})});log('activated',{version:id});},
  probe:async(id)=>{
   for(const [host,url,file] of [[t.hosts.client,'/','assets/index.html'],[t.hosts.mobile,'/','assets/mobile.html'],[t.hosts.client,'/login','assets/login.html'],[t.hosts.admin,'/admin','assets/admin-next.html'],...[t.hosts.client,t.hosts.admin,t.hosts.mobile].map(h=>[h,'/logo.png','assets/logo.png'])]){
    const r=await fetch('https://'+host+url,{redirect:'manual',signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,'Staging page probe failed');assert.equal(c.sha(Buffer.from(await r.arrayBuffer())),bundle.files[file],'Staging resource mismatch');
   }
   for(const host of [t.hosts.client,t.hosts.admin]){const r=await fetch('https://'+host+'/ready',{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);const j=await r.json();assert.equal(j.database,'connected');assert.equal(j.status,'ready');}
  }
 };
 let result;try{result=await c.release({target:t,bundle,before,adapter});}catch(e){log('stopped');throw e;}
 fs.writeFileSync(record+'.result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
}
if(require.main===module)main().catch(()=>{console.error('Release stopped. Inspect the failed step locally; no subsequent step was run. If activation occurred, run rollback-check and the approved staging rollback.');process.exitCode=1;});
module.exports={main};
