'use strict';
// GET-only inventory; usable with read-only production credentials. No imported publisher.
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
async function audit({accountId,worker,zoneIds},fetcher=fetch){
 assert(/^[a-f0-9]{32}$/.test(accountId));assert(/^[a-z0-9-]+$/.test(worker));assert(zoneIds.length>0&&zoneIds.every(z=>/^[a-f0-9]{32}$/.test(z)));
 async function get(route){const r=await fetcher('https://api.cloudflare.com/client/v4'+route,{method:'GET',headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},signal:AbortSignal.timeout(30000)});assert(r.ok,'Read-only inventory denied HTTP '+r.status);const j=await r.json();assert(j.success);return j;}
 async function all(route){const rows=[];for(let page=1;page<=100;page++){const j=await get(route+'?page='+page+'&per_page=100');assert(Array.isArray(j.result));rows.push(...j.result);if(j.result_info?.total_pages===undefined){assert(j.result.length<100,'Unproven pagination completeness');return rows;}if(page>=j.result_info.total_pages)return rows;}throw Error('Incomplete inventory');}
 const prefix='/accounts/'+accountId+'/workers/scripts/'+worker;
 const [deployments,settings,schedules,domains,routes]=await Promise.all([get(prefix+'/deployments'),get(prefix+'/settings'),get(prefix+'/schedules'),all('/accounts/'+accountId+'/workers/domains'),Promise.all(zoneIds.map(async z=>({zoneId:z,routes:(await all('/zones/'+z+'/workers/routes')).filter(r=>r.script===worker)})))]);
 const versions=deployments.result.deployments[0].versions;
 const activeVersions=await Promise.all(versions.map(async v=>(await get(prefix+'/versions/'+v.version_id)).result));
 for(const b of settings.result.bindings||[])assert(b.type!=='secret_text'||!('text' in b),'Unexpected secret disclosure');
 return {readOnly:true,capturedAt:new Date().toISOString(),accountId,worker,versions,activeVersions,settings:settings.result,schedules:schedules.result,domains:domains.filter(d=>d.service===worker),routes,zoneIds,databaseIdentityVerified:false};
}
if(require.main===module)(async()=>{assert(process.env.CLOUDFLARE_API_TOKEN,'Read-only token required');const [config,output]=process.argv.slice(2);const result=await audit(JSON.parse(fs.readFileSync(config)));const resolved=path.resolve(output);assert(resolved.includes(path.sep+'artifacts'+path.sep),'Save under ignored artifacts/');fs.writeFileSync(resolved,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log('Saved GET-only inventory; database identity and rollback still require verification');})().catch(()=>{console.error('Read-only inventory stopped; incomplete data is not release approval');process.exitCode=1;});
module.exports={audit};
