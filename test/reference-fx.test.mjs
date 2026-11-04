import test from 'node:test';
import assert from 'node:assert/strict';
import {createReferenceFx} from '../src/reference-fx.mjs';
import {createApi} from '../src/http-api.mjs';
const xml=`<gesmes:Envelope><Cube><Cube time='2026-11-04'><Cube currency='USD' rate='1.2'/><Cube currency='HKD' rate='9.6'/><Cube currency='CNY' rate='8.4'/><Cube currency='MYR' rate='4.8'/></Cube></Cube></gesmes:Envelope>`;
test('ECB rates derive USD crosses and cache concurrent requests',async()=>{
 let calls=0;const get=createReferenceFx({fetchImpl:async()=>{calls++;return {ok:true,text:async()=>xml};},now:()=>Date.parse('2026-11-04T17:00Z')});
 const [a,b]=await Promise.all([get(),get()]);assert.equal(calls,1);assert.deepEqual(a,b);
 assert.equal(a.rates.HKD,8);assert.equal(a.rates.USD,1);assert.equal(a.date,'2026-11-04');assert.equal(a.status,'available');
});
test('failed refresh retains dated cache and backs off',async()=>{
 let time=Date.parse('2026-11-04T17:00Z'),calls=0;
 const get=createReferenceFx({now:()=>time,fetchImpl:async()=>{if(++calls>1)throw Error('offline');return {ok:true,text:async()=>xml};}});
 await get();time+=3600001;const a=await get();assert.equal(a.status,'stale');assert.equal(a.date,'2026-11-04');await get();assert.equal(calls,2);
});
test('invalid, incomplete, future and nonpositive data fail closed',async()=>{
 for(const text of [xml.replace('2026-11-04','2026-02-30'),xml.replace('2026-11-04','2026-11-05'),xml.replace("rate='9.6'","rate='0'"),xml.replace("currency='MYR'","currency='JPY'"),'<html>error</html>']){
 const get=createReferenceFx({now:()=>Date.parse('2026-11-04T17:00Z'),fetchImpl:async()=>({ok:true,text:async()=>text})});
 await assert.rejects(get());}
});
test('old valid source is marked stale even after successful fetch',async()=>{
 const get=createReferenceFx({now:()=>Date.parse('2026-11-10T17:00Z'),fetchImpl:async()=>({ok:true,text:async()=>xml})});assert.equal((await get()).status,'stale');
});
test('read-only HTTP endpoint returns data, rejects writes and sanitizes failures without DB access',async()=>{
 for(const [method,fail,status] of [['GET',false,200],['POST',false,405],['GET',true,503]]){
  const server=createApi({db:{query(){throw Error('Unexpected DB access');}},resolveSession:async()=>null,referenceFx:async()=>{if(fail)throw Error('private details');return {source:'ECB'};}});
  const result={};const res={writeHead(code){result.status=code;},end(body){result.body=JSON.parse(body);}};
  await server.listeners('request')[0]({url:'/api/reference-fx',method,headers:{}},res);
  assert.equal(result.status,status);assert.ok(!JSON.stringify(result).includes('private details'));
  if(status===200)assert.equal(result.body.source,'ECB');
  server.close();
 }
});
