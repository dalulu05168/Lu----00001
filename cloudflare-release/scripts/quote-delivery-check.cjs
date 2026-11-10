
const fs=require('fs'),assert=require('assert/strict'),{randomBytes}=require('crypto');
const manifest=require('../release-manifest.json');
const root='https://api.cloudflare.com/client/v4/accounts/'+process.env.CLOUDFLARE_ACCOUNT_ID;
async function api(path,options={}){const r=await fetch(root+path,{...options,headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},signal:AbortSignal.timeout(25000)});const d=await r.json();assert(r.ok&&d.success,path+' '+r.status);return d.result;}
(async()=>{
const path='/workers/scripts/'+manifest.worker;
const active=async()=>{const d=await api(path+'/deployments');assert.deepEqual(d.deployments[0].versions.map(v=>[v.version_id,v.percentage]),[[manifest.version,100]])};
await active();
const original=await api(path+'/versions/'+manifest.version),sub=await api('/workers/subdomain');
const gate=randomBytes(32).toString('hex'),deadline=Date.now()+300000;
const quote=fs.readFileSync('src/products/quote.js','utf8');
const module="function cnProductFail(m,s){throw Object.assign(Error(m),{statusCode:s})}\n"+quote+"\nexport default{async fetch(r,e){if(Date.now()>"+deadline+"||r.headers.get('authorization')!=="+JSON.stringify('Bearer '+gate)+")return new Response(null,{status:404});const resolve=createProductQuote(e);if(!resolve)return Response.json({error:'missing_provider_binding'},{status:503});const results=[];for(const symbol of ['AAPL','NVDA','SPY','GLD','SLV','USO']){try{results.push({ok:true,...await resolve({market:'US',symbol})})}catch(error){results.push({symbol,ok:false,error:error.message,status:error.statusCode||null})}}return Response.json({checkedAt:new Date().toISOString(),results},{headers:{'cache-control':'no-store'}})}}";
const body=new FormData();body.set('metadata',new Blob([JSON.stringify({main_module:'worker.mjs',compatibility_date:original.resources.script_runtime.compatibility_date,compatibility_flags:original.resources.script_runtime.compatibility_flags,keep_assets:true,keep_bindings:['secret_text','plain_text','assets']})],{type:'application/json'}));body.set('worker.mjs',new Blob([module],{type:'application/javascript+module'}),'worker.mjs');
const preview=await api(path+'/versions',{method:'POST',body});
let report;for(let i=0;i<4;i++){try{const r=await fetch('https://'+preview.id.slice(0,8)+'-'+manifest.worker+'.'+sub.subdomain+'.workers.dev/',{headers:{Authorization:'Bearer '+gate},signal:AbortSignal.timeout(65000)});if(r.ok){report=await r.json();break;}}catch{}}
await active();assert(report,'Quote probe did not return');
fs.writeFileSync('artifacts/delivery-live-quotes.json',JSON.stringify({...report,previewVersion:preview.id,productionVersion:manifest.version},null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.message);process.exitCode=1});

