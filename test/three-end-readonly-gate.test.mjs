import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {gateTargets,validateBaseUrl,runThreeEndReadonlyGate} from '../scripts/three-end-readonly-gate.mjs';

async function fixtureServer({protectedStatus=401, readyStatus='ready', htmlOnAccount=false}={}) {
  const requests=[];
  const server=createServer((req,res)=>{
    requests.push({method:req.method,url:req.url,authorization:req.headers.authorization});
    const target=gateTargets().find(x=>x.path===req.url);
    if(!target){res.writeHead(404);res.end();return;}
    if (target.kind==='qa-asset') {
      res.writeHead(200,{'content-type':target.path.endsWith('.mjs')?'text/javascript':'text/html'});
      res.end(target.path.endsWith('.mjs')?'export const qaOnly=true;':'<html><title>QA fixture only</title></html>'); return;
    }
    if (target.kind==='health') {
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({status:target.path==='/api/ready'?readyStatus:'alive'})); return;
    }
    if (htmlOnAccount && target.path==='/api/account') {
      res.writeHead(401,{'content-type':'text/html'}); res.end('<html>sign in</html>');return;
    }
    res.writeHead(protectedStatus,{'content-type':'application/json'});
    res.end(JSON.stringify({error:'Authentication required'}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,requests,url:'http://127.0.0.1:'+server.address().port};
}

test('target list is unique and never contains a mutation',()=>{
  const targets=gateTargets();
  assert.equal(targets.length,19);
  assert.equal(new Set(targets.map(x=>x.path)).size,targets.length);
  assert.ok(targets.every(x=>x.expectedCode===200||x.expectedCode===401));
});

test('local-only by default, origin and credentials validated',()=>{
  assert.equal(validateBaseUrl('http://localhost:3000/'),'http://localhost:3000');
  assert.throws(()=>validateBaseUrl('https://example.org'),/Remote QA/);
  assert.equal(validateBaseUrl('https://qa.example.org',{remoteReadonly:true}),'https://qa.example.org');
  assert.throws(()=>validateBaseUrl('http://admin:secret@localhost:3000'),/plain HTTP/);
  assert.throws(()=>validateBaseUrl('http://localhost:3000/api'),/plain HTTP/);
});

test('healthy anonymous QA fixture passes and performs only GET without credentials',async()=>{
  const fixture=await fixtureServer();
  try {
    const result=await runThreeEndReadonlyGate({baseUrl:fixture.url});
    assert.equal(result.passed,true);
    assert.equal(result.total,19);
    assert.equal(result.passedCount,19);
    assert.equal(fixture.requests.length,19);
    assert.ok(fixture.requests.every(x=>x.method==='GET'&&x.authorization===undefined));
    assert.match(result.businessValidation,/NOT TESTED/);
  }finally{await new Promise(resolve=>fixture.server.close(resolve));}
});

test('authorization bypass fails: protected API returns 200 to unauthenticated user',async()=>{
  const fixture=await fixtureServer({protectedStatus:200});
  try {
    const result=await runThreeEndReadonlyGate({baseUrl:fixture.url});
    assert.equal(result.passed,false);
    assert.equal(result.checks.filter(x=>!x.passed).length,11);
  }finally{await new Promise(resolve=>fixture.server.close(resolve));}
});

test('readiness not ready or API replaced by HTML never counts as pass',async()=>{
  const fixture=await fixtureServer({readyStatus:'not_ready',htmlOnAccount:true});
  try {
    const result=await runThreeEndReadonlyGate({baseUrl:fixture.url});
    assert.equal(result.passed,false);
    assert.ok(result.checks.find(x=>x.path==='/api/ready'&&!x.passed));
    assert.ok(result.checks.find(x=>x.path==='/api/account'&&!x.passed));
  }finally{await new Promise(resolve=>fixture.server.close(resolve));}
});
