import test from 'node:test';
import assert from 'node:assert/strict';
import {createSecEdgarClient,normalizeEdgarCik} from '../src/sec-edgar-submissions.mjs';

const identity = 'Nuvexa Pro API audit audit-contact@example.test';
const timestamp = Date.parse('2026-11-08T00:00:00Z');
function sample(overrides={}) {
  return {cik:320193,name:'Apple Inc.',filings:{recent:{
    accessionNumber:['0000320193-26-000001','0000320193-26-000002','0000320193-26-000003'],
    form:['10-K','8-K','10-Q'],filingDate:['2026-11-06','2026-11-05','2026-10-31'],
    primaryDocument:['aapl-2026.htm','press.htm','quarter.htm']
  }},...overrides};
}
function asResponse(data, options={}) {
  return {ok: options.ok??true, headers:{get:k=> k==='content-type' ? options.contentType??'application/json' : options.contentLength??null},text:async()=> typeof data==='string'?data:JSON.stringify(data)};
}
function client(fetchImpl,extras={}) {
  return createSecEdgarClient({userAgent:identity,fetchImpl,now:()=>timestamp,minIntervalMs:0,...extras});
}

test('CIK must be numeric 1..10 digits, padded without external ticker assumptions', () => {
  assert.equal(normalizeEdgarCik('320193'),'0000320193');
  assert.equal(normalizeEdgarCik(320193),'0000320193');
  for (const bad of ['AAPL','0','0000000000','320193/../a',-1,'01%2f',1.3,{},null]) {
    assert.throws(()=>normalizeEdgarCik(bad),{statusCode:400});
  }
});

test('requires an identifying User-Agent and rejects header injection before requests', () => {
  for (const userAgent of ['',undefined,'Example client','Company a@b.io\r\nAuthorization: token']) {
    assert.throws(()=>createSecEdgarClient({userAgent}),/User-Agent/);
  }
});

test('fixed SEC URL; returns verified filing metadata and explicitly no stock price/trade', async () => {
  const requests=[];
  const get=client(async (url, options)=>{
    requests.push({url,options});return asResponse(sample());
  });
  const result=await get('320193');
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'https://data.sec.gov/submissions/CIK0000320193.json');
  assert.equal(requests[0].options.headers['User-Agent'],identity);
  assert.equal(requests[0].options.redirect,'error');
  assert.equal(result.source,'SEC EDGAR');
  assert.equal(result.dataKind,'FILING_METADATA');
  assert.equal(result.companyName,'Apple Inc.');
  assert.equal(result.filings.length,3);
  assert.equal(result.filings[0].url,'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-2026.htm');
  assert.equal(result.priceAvailable,false);
  assert.equal(result.orderExecutionAllowed,false);
  assert.equal('price' in result,false);
});

test('form filter and max limit applied after normalization; no fabricated filing metadata', async ()=>{
  const get=client(async()=>asResponse(sample()));
  const result=await get('320193',{forms:['10-Q'],limit:1});
  assert.deepEqual(result.filings.map(x=>x.form),['10-Q']);
  await assert.rejects(get('320193',{forms:['FRAUD'] }),{statusCode:400});
  await assert.rejects(get('320193',{limit:1000}),{statusCode:400});
});

test('path traversal, invalid accession and impossible/future filing dates excluded', async ()=>{
  const changed=sample();
  changed.filings.recent.primaryDocument=['../secret.txt','evil.htm','quarter.htm'];
  changed.filings.recent.accessionNumber[1]='../../outside';
  changed.filings.recent.filingDate[2]='2099-01-01';
  const get=client(async()=>asResponse(changed));
  const r=await get(320193);
  assert.equal(r.filings.length,0);
});

test('incorrect CIK, malformed columns, invalid JSON and bad content-type fail closed', async ()=>{
  for (const resp of [asResponse(sample({cik:123})),asResponse({cik:320193,name:'Apple',filings:{recent:{}}}),asResponse('{bad'),asResponse(sample(),{contentType:'text/html'})]) {
    await assert.rejects(client(async()=>resp)('320193'),{statusCode:503});
  }
});

test('upstream failure, 429 and oversized response return 503 without leaking payload', async ()=>{
  for (const response of [asResponse('{}',{ok:false}),asResponse('{}',{contentLength:'2500000'}),asResponse('A'.repeat(2_000_001))]) {
    await assert.rejects(client(async()=>response)('320193'),{statusCode:503});
  }
  await assert.rejects(client(async()=>{throw new Error('secret-internal-error')})('320193'),e=>e.statusCode===503&&!e.message.includes('secret'));
});

test('deduplicates concurrent CIK lookups and caches results without duplicate upstream calls', async ()=>{
  let calls=0;
  const get=client(async()=>{calls++;await Promise.resolve();return asResponse(sample())});
  const out=await Promise.all([get(320193),get('320193'),get('0000320193',{forms:['10-Q']})]);
  assert.equal(calls,1);
  assert.equal(out[0].filings.length,3);
  assert.equal(out[2].filings.length,1);
  await get(320193);
  assert.equal(calls,1);
});

test('expired cache triggers refetch, cache never reuses previous-company response', async ()=>{
  let calls=0,clock=timestamp;
  const get=createSecEdgarClient({userAgent:identity,fetchImpl:async(url)=>{
    calls++;let cik=Number(url.match(/CIK(\d+)/)[1]);return asResponse(sample({cik,name:cik===320193?'Apple':'Other'}));
  },now:()=>clock,cacheTtlMs:60_000,minIntervalMs:0});
  assert.equal((await get(320193)).companyName,'Apple');
  assert.equal((await get(123)).companyName,'Other');
  clock+=61_000;
  assert.equal((await get(320193)).companyName,'Apple');
  assert.equal(calls,3);
});

test('per-instance request pacing uses injected wait, never a user-controlled upstream host', async ()=>{
  const waits=[];let count=0;
  const get=createSecEdgarClient({userAgent:identity,fetchImpl:async url=>{
    count++;return asResponse(sample({cik:Number(url.match(/CIK(\d+)/)[1])}));
  },now:()=>timestamp,sleep:async n=>waits.push(n),minIntervalMs:350});
  await get(320193);await get(123);
  assert.equal(count,2);
  assert.deepEqual(waits,[350]);
});

test('streaming body is byte-limited before collecting oversized chunks', async()=>{
  let pulls=0;
  const stream = new ReadableStream({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(1_200_000));
      if (pulls===2) controller.close();
    }
  });
  const response={ok:true,headers:{get:k=>k==='content-type'?'application/json':null},body:stream};
  await assert.rejects(client(async()=>response)(320193),{statusCode:503});
  assert.equal(pulls,2);
});

test('streaming normal JSON completes and returns filings', async()=>{
  const encoded=new TextEncoder().encode(JSON.stringify(sample()));
  const mid=Math.floor(encoded.length/2);
  const stream=new ReadableStream({start(controller){
    controller.enqueue(encoded.slice(0,mid));
    controller.enqueue(encoded.slice(mid));
    controller.close();
  }});
  const response={ok:true,headers:{get:k=>k==='content-type'?'application/json':null},body:stream};
  const r=await client(async()=>response)(320193);
  assert.equal(r.filings.length,3);
  assert.equal(r.priceAvailable,false);
});