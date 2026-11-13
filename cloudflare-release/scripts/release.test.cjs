'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const c=require('./release-core.cjs'),target=require('../staging-target.example.json');
const {audit}=require('./release-audit.cjs');
const copy=x=>structuredClone(x);
function state(){return {worker:target.worker,versions:[{version_id:'previous',percentage:100}],domains:[target.hosts.client,target.hosts.admin,target.hosts.mobile],routes:[],settings:{bindings:[{name:'DATABASE_URL',type:'secret_text'},{name:'ASSETS',type:'assets'}],runtime:{date:'2026-11-08'},observability:{enabled:true}},schedules:[],rollbackVersion:{id:'previous',resources:{assets:'old-assets',bindings:['DATABASE_URL']}},databaseRecoveryVerified:true};}
function mock(fault){const calls=[],s=state();return {calls,s,
 snapshot:async()=>{calls.push('snapshot');return copy(s);},
 upload:async()=>{calls.push('upload');if(fault==='upload')throw Error('upload failure');if(fault==='upload-activation')s.versions=[{version_id:'candidate',percentage:100}];return {id:'candidate'};},
 validateVersion:async()=>{calls.push('validateVersion');if(fault==='candidate')throw Error('binding mismatch');},
 activate:async(id)=>{calls.push('activate');s.versions=[{version_id:id,percentage:100}];if(fault==='version')s.versions[0].version_id='unexpected';if(fault==='route')s.routes.push('lost route');if(fault==='cron')s.schedules=['* * * * *'];if(fault==='binding')s.settings.bindings=[];},
 probe:async()=>{calls.push('probe');if(fault==='probe')throw Error('bad resource hash');}
 };}
test('accepted production build is byte-identical to 31-suite artifact and includes all resources',()=>{const lock=c.artifactCheck();assert.equal(Object.keys(lock.files).length,7);assert(lock.files['assets/admin-next.html']);});
for(const fault of ['upload','candidate','upload-activation','version','route','cron','binding','probe'])test('fail closed: '+fault,async()=>{const a=mock(fault);await assert.rejects(c.release({target,bundle:{},before:state(),adapter:a}));if(['upload','candidate','upload-activation'].includes(fault))assert(!a.calls.includes('activate'));if(['version','route','cron','binding'].includes(fault))assert(!a.calls.includes('probe'));});
test('successful mocked upload/activation verifies version, invariants and rollback',async()=>{const a=mock();assert.deepEqual(await c.release({target,bundle:{},before:state(),adapter:a}),{version:'candidate',previous:'previous',verified:true});assert.deepEqual(a.calls,['snapshot','upload','snapshot','validateVersion','snapshot','activate','snapshot','probe']);});
test('stale active version stops before upload',async()=>{const a=mock();a.s.versions[0].version_id='concurrent';await assert.rejects(c.release({target,bundle:{},before:state(),adapter:a}));assert(!a.calls.includes('upload'));});
test('missing rollback drill stops before upload',async()=>{const a=mock(),b=state();b.databaseRecoveryVerified=false;await assert.rejects(c.release({target,bundle:{},before:b,adapter:a}));assert(!a.calls.includes('upload'));});
test('missing/deleted rollback resources stops',()=>{const b=state(),s=state();s.rollbackVersion.resources.assets='deleted';assert.throws(()=>c.rollbackCheck(b,s));});
test('version changes just before activation stop the write',async()=>{const a=mock();a.validateVersion=async()=>{a.s.versions[0].version_id='concurrent';};await assert.rejects(c.release({target,bundle:{},before:state(),adapter:a}));assert(!a.calls.includes('activate'));});
test('control-plane errors stop before upload',async()=>{const a=mock();a.snapshot=async()=>{throw Error('403');};await assert.rejects(c.release({target,bundle:{},before:state(),adapter:a}));assert(!a.calls.includes('upload'));});
test('read-only inventory uses only GET and includes all routing/settings/cron/version evidence',async()=>{
 const calls=[];const fake=async(url,options)=>{assert.equal(options.method,'GET');calls.push(url);let result;
  if(url.includes('/deployments'))result={deployments:[{versions:[{version_id:'previous',percentage:100}]}]};
  else if(url.includes('/settings'))result={bindings:[{name:'DATABASE_URL',type:'secret_text'}]};
  else if(url.includes('/schedules'))result={schedules:[{cron:'*/5 * * * *'}]};
  else if(url.includes('/domains'))result=[{service:'lu----00001',hostname:'nuvexapro.com'}];
  else if(url.includes('/routes'))result=[{script:'lu----00001',pattern:'nuvexapro.com/*'}];
  else result={id:'previous',resources:{bindings:[]}};
  return Response.json({success:true,result});};
 const out=await audit({accountId:target.accountId,worker:'lu----00001',zoneIds:[target.zoneId]},fake);assert(out.readOnly);assert.equal(out.routes[0].routes.length,1);assert.equal(out.activeVersions[0].id,'previous');assert.equal(calls.length,6);
});
test('read-only API denial fails closed',async()=>{await assert.rejects(audit({accountId:target.accountId,worker:'lu----00001',zoneIds:[target.zoneId]},async()=>new Response(null,{status:403})));});
for(const key of ['domains','routes','settings','schedules'])test('rollback detects '+key+' drift',()=>{const b=state(),s=state();s[key]=null;assert.throws(()=>c.rollbackCheck(b,s));});
for(const change of [t=>t.environment='production',t=>t.worker='lu----00001',t=>t.hosts.client='nuvexapro.com',t=>t.hosts.admin=t.hosts.client,t=>t.neon.branchId=t.neon.productionBranchIds[0],t=>t.neon.endpointHost=t.neon.productionEndpointHosts[0],t=>t.crons=['*/5 * * * *'],t=>t.wranglerVersion='latest'])test('reject unsafe target '+change.toString(),()=>{const t=copy(target);change(t);assert.throws(()=>c.targetCheck(t));});
test('DB binding requires exact isolated endpoint/database/role/TLS',()=>{const url='postgresql://nuvexa_staging:fixture@'+target.neon.endpointHost+'/nuvexa_staging?sslmode=require';c.databaseCheck(target,url);for(const unsafe of [url.replace('ep-staging-58','ep-production'),url.replace('/nuvexa_staging','/postgres'),url.replace('sslmode=require','sslmode=disable'),url.replace('nuvexa_staging:','owner:')])assert.throws(()=>c.databaseCheck(target,unsafe));});
test('prepare maps all test hosts and rejects worker/asset/config tampering',()=>{
 fs.mkdirSync(path.join(c.root,'artifacts'),{recursive:true});const parent=fs.mkdtempSync(path.join(c.root,'artifacts','release-test-')),dir=path.join(parent,'bundle');
 try{c.prepare(target,dir);c.bundleCheck(dir,target);const s=fs.readFileSync(path.join(dir,'worker.mjs'),'utf8');assert(s.includes(target.hosts.admin));assert(!s.includes('nuvexapro.com'));assert(!s.includes('admin.maacropierce.com'));const cfg=c.read(path.join(dir,'wrangler.json'));assert.deepEqual(cfg.triggers.crons,[]);assert.equal(cfg.assets.run_worker_first,true);
  for(const name of ['worker.mjs','assets/logo.png','wrangler.json']){const file=path.join(dir,name),old=fs.readFileSync(file);fs.appendFileSync(file,'tampered');assert.throws(()=>c.bundleCheck(dir,target));fs.writeFileSync(file,old);}
 }finally{assert(parent.startsWith(path.join(c.root,'artifacts')+path.sep));fs.rmSync(parent,{recursive:true});}
});
