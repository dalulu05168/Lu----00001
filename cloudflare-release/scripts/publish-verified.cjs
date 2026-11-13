const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
throw Error('Legacy production publisher disabled: use scripts/release.cjs for isolated staging. Production activation requires separate approval.');
const label=process.env.CN_PUBLICATION_LABEL||'9fea07e';assert(/^[a-zA-Z0-9-]+$/.test(label));
const root=path.resolve(__dirname,'..'),dir=path.join(root,'artifacts','publication-'+label);fs.mkdirSync(dir,{recursive:true});
const account='8c0339e3cace4c6ecad7052224bd6ac5',service='lu----00001',prefix='/accounts/'+account+'/workers/scripts/'+service;
const token=fs.readFileSync('C:/Users/mrmal/AppData/Roaming/xdg.config/.wrangler/config/default.toml','utf8').match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];assert(token,'Cloudflare authorization missing');
async function api(route,options={}){const r=await fetch('https://api.cloudflare.com/client/v4'+route,{...options,headers:{Authorization:'Bearer '+token,...options.headers},signal:AbortSignal.timeout(35000)});const j=await r.json();if(!r.ok||!j.success)throw Error(route+' '+r.status+' '+JSON.stringify(j.errors));return j.result;}
const hash=b=>createHash('sha256').update(b).digest('hex'),stable=rows=>rows.map(x=>JSON.stringify(x)).sort(),domains=rows=>stable(rows.filter(x=>x.service===service));
const reportFile=path.join(dir,'publication.json');
(async()=>{
 const mode=process.argv[2]||'prepare';
 if(mode==='prepare'){
  const manifest=require('../release-manifest.json'),source=fs.readFileSync(path.join(root,'dist/worker.mjs')),accepted=JSON.parse(fs.readFileSync(path.resolve(root,process.env.CN_ACCEPTANCE_FILE||'docs/acceptance-write-recovery-summary.json')));
  assert.equal(hash(source),accepted.sourceSha256);assert(accepted.sourceUnchanged&&accepted.results.every(x=>x.code===0));
  const deployment=await api(prefix+'/deployments');assert.deepEqual(deployment.deployments[0].versions,[{version_id:manifest.version,percentage:100}]);
  const baseline=await api(prefix+'/versions/'+manifest.version),beforeDomains=await api('/accounts/'+account+'/workers/domains'),settings=await api(prefix+'/settings');
  const names=beforeDomains.filter(x=>x.service===service).map(x=>x.hostname).sort();assert.deepEqual(names,['admin.maacropierce.com','nuvexapro.com']);
  fs.writeFileSync(path.join(dir,'baseline.json'),JSON.stringify({deployment,baseline,domains:beforeDomains.filter(x=>x.service===service),settings},null,2));
  const metadata={main_module:'worker.mjs',compatibility_date:baseline.resources.script_runtime.compatibility_date,compatibility_flags:baseline.resources.script_runtime.compatibility_flags,keep_assets:true,keep_bindings:[...new Set(baseline.resources.bindings.map(x=>x.type))]};
  const body=new FormData();body.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));body.set('worker.mjs',new Blob([source],{type:'application/javascript+module'}),'worker.mjs');
  const uploaded=await api(prefix+'/versions',{method:'POST',body}),candidate=await api(prefix+'/versions/'+uploaded.id);
  assert.deepEqual(stable(candidate.resources.bindings),stable(baseline.resources.bindings));assert.deepEqual(candidate.resources.script_runtime,baseline.resources.script_runtime);
  assert.deepEqual(domains(await api('/accounts/'+account+'/workers/domains')),domains(beforeDomains));
  const report={preparedAt:new Date().toISOString(),previous:manifest.version,version:uploaded.id,sha256:hash(source),bindings:stable(candidate.resources.bindings),runtime:candidate.resources.script_runtime,domains:domains(beforeDomains),assetsPreserved:true};
  fs.writeFileSync(reportFile,JSON.stringify(report,null,2));console.log(JSON.stringify({prepared:true,version:report.version,bindingsPreserved:true,domainsPreserved:true,assetsPreserved:true}));return;
 }
 const report=JSON.parse(fs.readFileSync(reportFile));assert.equal(hash(fs.readFileSync(path.join(root,'dist/worker.mjs'))),report.sha256);
 if(mode==='activate'){
  const schema=JSON.parse(fs.readFileSync(path.join(dir,'schema-verification.json')));assert(schema.verified===true&&schema.table==='cn_write_receipts'&&schema.branch==='br-crimson-morning-b3rhjeoi');
  const current=await api(prefix+'/deployments');assert.deepEqual(current.deployments[0].versions,[{version_id:report.previous,percentage:100}]);
  assert.deepEqual(domains(await api('/accounts/'+account+'/workers/domains')),report.domains);
  await api(prefix+'/deployments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({strategy:'percentage',versions:[{version_id:report.version,percentage:100}]})});
  report.activatedAt=new Date().toISOString();fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
 }
 assert.deepEqual((await api(prefix+'/deployments')).deployments[0].versions,[{version_id:report.version,percentage:100}]);
 assert.deepEqual(domains(await api('/accounts/'+account+'/workers/domains')),report.domains);
 assert.deepEqual(stable((await api(prefix+'/versions/'+report.version)).resources.bindings),report.bindings);
 console.log(JSON.stringify({active:report.version,percentage:100,bindingsPreserved:true,domainsPreserved:true,report:reportFile}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
