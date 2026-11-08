import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {FEATURES,coverageSummary,checkSourceBinding,auditQaSourcePreservation,
 classifyReadback,probeReadbackMatrix} from '../scripts/three-end-feature-preservation.mjs';

function fixtureFactory(statusByPath={}){
 const calls=[];
 const server=createServer((req,res)=>{
  calls.push({method:req.method,url:req.url,auth:req.headers.authorization});
  const status=statusByPath[req.url]??401;
  res.writeHead(status,{'content-type':'application/json'});
  res.end(JSON.stringify(status===200?{items:[]}:{error:'Authentication required'}));
 });
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({
  url:'http://127.0.0.1:'+server.address().port,calls,
  close:()=>new Promise(done=>server.close(done))
 })));
}

test('complete original scope retains desktop, mobile and ten admin modules',()=>{
 const c=coverageSummary();
 assert.equal(c.total,55);
 assert.deepEqual(c.bySurface,{desktop:20,mobile:13,admin:22});
 assert.equal(c.adminPanes.length,10);
 assert.equal(c.mutationObligations,29);
 for(const f of FEATURES){
  assert.match(f.path,/^\/api\//);
  assert.match(f.readback,/^\/api\//);
  assert.deepEqual(f.failureStatuses,[401,403,503]);
  assert.ok(['GET','POST','PATCH','DELETE','VIEW'].includes(f.method));
  assert.ok(['html','module'].includes(f.source));
  if(!['GET','VIEW'].includes(f.method))assert.equal(f.requiresDbEvidence,true);
 }
});

test('old QA source audit detects missing button OR missing API route',()=>{
 const f=FEATURES.find(x=>x.surface==='desktop'&&x.key==='account');
 const yes=checkSourceBinding(f,{html:'<output id="accountCashValue">—</output>',module:'',server:'GET /api/account'});
 assert.equal(yes.passed,true);
 assert.equal(checkSourceBinding(f,{html:'<output id="missing">—</output>',module:'',server:'GET /api/account'}).passed,false);
 assert.equal(checkSourceBinding(f,{html:'<output id="accountCashValue">—</output>',module:'',server:'/api/stock-quote'}).passed,false);
 assert.equal(yes.dbReadbackVerified,false);
});

test('source manifest audit checks every feature and never implies latest Library UI',async()=>{
 const map={};
 for(const f of FEATURES){
  const htmlFile=f.surface==='desktop'?'web/index.html':f.surface==='mobile'?'web/mobile.html':'web/admin.html';
  const jsFile=f.surface==='desktop'?'web/app.mjs':f.surface==='mobile'?'web/mobile.mjs':'web/admin.mjs';
  const file=f.source==='html'?htmlFile:jsFile;
  const text=f.selector.startsWith('#')?'id="'+f.selector.slice(1)+'"':f.selector.slice(1,-1);
  map[file]=(map[file]||'')+text+'\n';
  const routeFile=f.surface==='admin'?'src/admin-http.mjs':'src/http-api.mjs';
  map[routeFile]=(map[routeFile]||'')+f.path.split('?')[0]+'\n'+f.readback.split('?')[0]+'\n';
 }
 // Registration catalog route belongs to the shared admin handler.
 map['src/admin-http.mjs']+='\n/api/catalog';
 const result=await auditQaSourcePreservation({root:'/fixture',readText:async p=>map[p.replace('/fixture/','')]??''});
 assert.equal(result.total,55);
 assert.equal(result.passed,true);
 assert.match(result.baseline,/NOT the final Library UI/);
 const bad={...map,'web/mobile.html':map['web/mobile.html'].replace('data-tab="orders"','')};
 const broken=await auditQaSourcePreservation({root:'/fixture',readText:async p=>bad[p.replace('/fixture/','')]??''});
 assert.equal(broken.passed,false);
 assert.ok(broken.checks.some(x=>x.key==='orders'&&x.surface==='mobile'&&!x.selectorFound));
});

test('readback states keep unknown distinct from confirmed zero and empty',()=>{
 assert.equal(classifyReadback(200,{account:{cashCents:0},positions:[],orders:[]},'account'),'EMPTY_CONFIRMED');
 assert.equal(classifyReadback(200,{account:{},positions:[],orders:[]},'account'),'UNKNOWN');
 assert.equal(classifyReadback(200,{historyAvailable:false,realizedPnlCents:0},'analytics'),'UNKNOWN');
 assert.equal(classifyReadback(200,{historyAvailable:true,realizedPnlCents:0,unrealizedPnlCents:0,positionCostCents:0},'analytics'),'DATA');
 assert.equal(classifyReadback(200,{items:[]},'items'),'EMPTY_CONFIRMED');
 assert.equal(classifyReadback(200,{},'items'),'UNKNOWN');
 assert.equal(classifyReadback(401,{},'account'),'AUTH_REQUIRED');
 assert.equal(classifyReadback(403,{},'items'),'FORBIDDEN');
 assert.equal(classifyReadback(503,{},'items'),'UNAVAILABLE');
 assert.equal(classifyReadback(200,{},'quote'),'UNKNOWN');
});

test('all readback obligations blocked without credentials and zero requests sent',async()=>{
 const f=await fixtureFactory();try{
  const result=await probeReadbackMatrix({baseUrl:f.url});
  assert.equal(f.calls.length,0);
  assert.equal(result.passed,false);
  assert.ok(result.results.every(x=>x.status==='BLOCKED_AUTH'||x.status==='BLOCKED_CONTEXT'));
 }finally{await f.close();}
});

test('authorized read-only fixture observes 401 403 503 without executing any writes',async()=>{
 const f=await fixtureFactory({'/api/account':403,'/api/admin/clients':503});try{
  const result=await probeReadbackMatrix({baseUrl:f.url,clientToken:'fake qa client',adminToken:'fake qa admin'});
  assert.equal(result.passed,false);
  assert.ok(f.calls.length>10);
  assert.ok(f.calls.every(x=>x.method==='GET'&&x.auth?.startsWith('Bearer ')));
  assert.ok(result.results.some(x=>x.path==='/api/account'&&x.status==='FORBIDDEN'));
  assert.ok(result.results.some(x=>x.path==='/api/admin/clients'&&x.status==='UNAVAILABLE'));
  assert.ok(result.results.some(x=>x.status==='BLOCKED_CONTEXT'));
  assert.ok(result.results.some(x=>x.status==='AUTH_REQUIRED'));
  assert.doesNotMatch(JSON.stringify(result),/fake qa/);
 }finally{await f.close();}
});

test('no plaintext remote QA credentials or remote without explicit approval',async()=>{
 await assert.rejects(probeReadbackMatrix({baseUrl:'http://remote.example.test',remoteReadonly:true,
   authorizedRemoteQa:true,clientToken:'secret'}),/HTTPS/);
 await assert.rejects(probeReadbackMatrix({baseUrl:'https://remote.example.test',remoteReadonly:true,
   clientToken:'secret'}),/explicitly authorized/);
});
