import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketDataQuoteGateway} from '../src/market-data-quote-gateway.mjs';

const NOW = 1_800_000_000_000;
const US = Object.freeze({market:'US', symbol:'AAPL'});
const CN = Object.freeze({market:'CN', symbol:'600519'});
const rightsRef = 'approved-sandbox-license-fixture';
const quote = Object.freeze({
  ...US, name:'Apple Inc', mic:'XNAS', currency:'USD', source:'Twelve Data',
  price:129.45, priceCents:12945, timestampMs:NOW - 1000,
  status:'FRESH', stale:false,
  entitlement:{purpose:'clientDisplay',reviewReference:rightsRef}
});
const cnQuote = Object.freeze({
  ...CN, name:'Kweichow Moutai', mic:'XSHG', currency:'CNY', source:'Twelve Data',
  price:1520.50, priceCents:152050, timestampMs:NOW - 1000,
  status:'FRESH', stale:false,
  entitlement:{purpose:'clientDisplay',reviewReference:rightsRef}
});
const history = Object.freeze({
  status:'HISTORICAL', ...CN, mic:'XSHG', name:'Kweichow Moutai',
  currency:'CNY', source:'Twelve Data', interval:'1day', timezone:'Asia/Shanghai',
  values:[
    {datetime:'2026-11-05',open:1501.00,high:1530,low:1490,close:1515,volume:1000},
    {datetime:'2026-11-06',open:1515,high:1535,low:1510,close:1520.50,volume:1500}
  ]
});
const grant = ({source,market,currency,purpose}) => ({
  provider:source,market,currency,purpose,allowed:true,
  expiresAtMs:NOW+60_000,reviewReference:rightsRef
});
function create({getQuote = async (_req,opts) => ({
  ...quote, entitlement:{purpose:opts.purpose,reviewReference:rightsRef}
}), getHistory = async()=>history,authorizeAccess=grant, clock=()=>NOW,
  cacheTtlMs=1000,maxAgeMs=60_000}={}) {
  return createMarketDataQuoteGateway({
    provider:{getQuote,getHistory},authorizeAccess,now:clock,cacheTtlMs,maxAgeMs
  });
}
// All numbers in this file are synthetic *test-only* HTTP fixture values.
// Nothing below is a live vendor quote or a real commercial entitlement.

test('quote has one-object purpose contract and preserves source, MIC, currency and time',async()=>{
  const service=create();
  const found=await service.getQuote({...US,purpose:'clientDisplay'});
  assert.equal(found.price,129.45);
  assert.equal(found.mic,'XNAS');
  assert.equal(found.timestampMs,NOW-1000);
  assert.equal(found.checkedAtMs,NOW);
  assert.equal(found.entitlement.reviewReference,rightsRef);
  assert.equal(found.ageMs,1000);
});

test('existing trading backend two-argument purpose invocation remains compatible',async()=>{
  const service=create();
  const result=await service.getQuote(US,{purpose:'internalSimulationPricing'});
  assert.equal(result.priceCents,12945);
  assert.equal(result.entitlement.purpose,'internalSimulationPricing');
});

test('conflicting one- and two-object purposes are rejected before fetching',async()=>{
  let calls=0;
  const service=create({getQuote:async()=>{calls++;return quote;}});
  await assert.rejects(
    service.getQuote({...US,purpose:'clientDisplay'},{purpose:'internalSimulationPricing'}),
    {code:'AMBIGUOUS_DATA_PURPOSE'});
  assert.equal(calls,0);
});

test('expired/revoked rights reject prior cache and cannot leak stale grants',async()=>{
  let calls=0,allowed=true;
  const service=create({
    getQuote:async()=>{calls++;return quote;},
    authorizeAccess:r=>allowed?grant(r):null
  });
  await service.getQuote(US);
  allowed=false;
  await assert.rejects(service.getQuote(US),{code:'DATA_RIGHTS_NOT_VERIFIED'});
  assert.equal(calls,1);
});

test('cached price is not extended beyond original time',async()=>{
  let clock=NOW, calls=0;
  const service=create({
    clock:()=>clock, cacheTtlMs:5000,
    getQuote:async()=>{calls++;return quote;},
    authorizeAccess:r=>({...grant(r),expiresAtMs:NOW+300_000})
  });
  await service.getQuote(US);
  clock+=61_000;
  await assert.rejects(service.getQuote(US),{code:'QUOTE_STALE_OR_FUTURE'});
  assert.equal(calls,2);
});

test('simultaneous same-market same-symbol same-purpose fetches coalesce',async()=>{
  let calls=0;
  const service=create({
    getQuote:async()=>{calls++;await new Promise(r=>setImmediate(r));return quote;}
  });
  const all=await Promise.all(Array.from({length:12},()=>service.getQuote(US)));
  assert.equal(calls,1);
  assert.equal(all.length,12);
});

test('customer display grant never automatically allows internal pricing',async()=>{
  const service=create({authorizeAccess:r=>r.purpose==='clientDisplay'?grant(r):null});
  await service.getQuote(US);
  await assert.rejects(
    service.getQuote(US,{purpose:'internalSimulationPricing'}),
    {code:'DATA_RIGHTS_NOT_VERIFIED'});
});

test('missing permission/expired license is denied even with valid API response',async()=>{
  for (const authorizeAccess of [undefined,()=>null,
    r=>({...grant(r),expiresAtMs:NOW}),
    r=>({...grant(r),reviewReference:'unreviewed'})]) {
    if (authorizeAccess===undefined) {
      assert.throws(()=>createMarketDataQuoteGateway({provider:{getQuote:async()=>quote}}));
    } else {
      await assert.rejects(create({authorizeAccess}).getQuote(US),
        {code:authorizeAccess( {source:'Twelve Data',market:'US',currency:'USD',purpose:'clientDisplay'})?.reviewReference==='unreviewed'
          ?'DATA_RIGHTS_REFERENCE_MISMATCH':'DATA_RIGHTS_NOT_VERIFIED'});
    }
  }
});

test('rejects wrong MIC, wrong issuer identity, wrong currency and falsified provider source',async()=>{
  for (const q of [
    {...quote,mic:'XSHG'}, {...quote,symbol:'MSFT'},
    {...quote,name:''}, {...quote,currency:'CNY'}, {...quote,source:'Other'}
  ]) {
    await assert.rejects(create({getQuote:async()=>q}).getQuote(US),
      {code:'INVALID_UPSTREAM_IDENTITY'});
  }
});

test('wrong purpose / reviewed contract evidence in provider result is denied',async()=>{
  for (const entitlement of [
    {purpose:'internalSimulationPricing',reviewReference:rightsRef},
    {purpose:'clientDisplay',reviewReference:'wrong'},
    {purpose:'clientDisplay',reviewReference:''}
  ]) {
    await assert.rejects(create({getQuote:async()=>({...quote,entitlement})}).getQuote(US));
  }
});

test('fresh quote without precise cents is usable for display but not internal execution',async()=>{
  const display={...quote,price:129.45001,priceCents:null};
  const service=create({getQuote:async (_r,opts)=>({
    ...display,entitlement:{purpose:opts.purpose,reviewReference:rightsRef}
  })});
  assert.equal((await service.getQuote(US)).price,129.45001);
  await assert.rejects(service.getQuote({...US,purpose:'internalSimulationPricing'}),
    {code:'EXECUTION_PRICE_NOT_EXACT_CENTS'});
});

test('stale, future, null and identity-inconsistent quote returns fail closed',async()=>{
  for(const q of [
    {...quote,timestampMs:NOW-90_000},
    {...quote,timestampMs:NOW+10_000},
    {...quote,price:0},null
  ]) {
    await assert.rejects(create({getQuote:async()=>q}).getQuote(US),
      e=>e.statusCode===503);
  }
});

test('provider rejection is a 503 and unsuccessful fetch does not populate cache',async()=>{
  let calls=0;
  const service=create({getQuote:async()=>{
    calls++;throw Object.assign(new Error('vendor timeout'),{code:'ETIMEDOUT'});
  }});
  await assert.rejects(service.getQuote(US),{code:'UPSTREAM_QUOTE_UNAVAILABLE'});
  await assert.rejects(service.getQuote(US),{code:'UPSTREAM_QUOTE_UNAVAILABLE'});
  assert.equal(calls,2);
});

test('unknown exchanges and malformed US/CN symbols reject before network call',async()=>{
  let calls=0;
  const service=create({getQuote:async()=>{calls++;return quote;}});
  for (const bad of [
    {market:'CN',symbol:'AAPL'}, {market:'US',symbol:'600519'},
    {market:'CN',symbol:'900901'}, {market:'CN',symbol:'830001'},
    {market:'US',symbol:'AAPL/../../'}, {market:'RO',symbol:'BRD'}, {}
  ]) await assert.rejects(service.getQuote(bad),e=>e.statusCode===503);
  assert.equal(calls,0);
});

test('proper A-share CN quote validates its market and MIC',async()=>{
  const service=create({getQuote:async (_req,options)=>({
    ...cnQuote,entitlement:{purpose:options.purpose,reviewReference:rightsRef}
  })});
  const result=await service.getQuote(CN);
  assert.equal(result.currency,'CNY');
  assert.equal(result.priceCents,152050);
  assert.equal(result.mic,'XSHG');
});

test('getHistory returns ordered OHLCV with explicit local exchange timezone',async()=>{
  const service=create();
  const bars=await service.getHistory({...CN,interval:'1day',outputsize:2});
  assert.equal(bars.values.length,2);
  assert.equal(bars.values[0].datetime,'2026-11-05');
  assert.equal(bars.values[1].volume,1500);
  assert.equal(bars.timezone,'Asia/Shanghai');
  assert.equal(bars.entitlement.purpose,'clientDisplay');
});

test('history rights are rechecked after provider response, including mid-flight revoke',async()=>{
  let allowed=true;
  const service=create({
    getHistory:async()=>{allowed=false;return history;},
    authorizeAccess:r=>allowed?grant(r):null
  });
  await assert.rejects(service.getHistory(CN),{code:'DATA_RIGHTS_NOT_VERIFIED'});
});

test('history refuses cross-market, out-of-order, missing volume, wrong timezone or OHLC',async()=>{
  for (const broken of [
    {...history,mic:'XNAS'},
    {...history,symbol:'000001'},
    {...history,timezone:'UTC'},
    {...history,values:[history.values[1],history.values[0]]},
    {...history,values:[{...history.values[0],volume:null}]},
    {...history,values:[{...history.values[0],high:100}]}
  ]) await assert.rejects(
    create({getHistory:async()=>broken}).getHistory(CN),e=>e.statusCode===503);
});

test('getHistory rejects missing provider and malformed size/period without remote fetch',async()=>{
  let calls=0;
  const service=create({getHistory:async()=>{calls++;return history;}});
  await assert.rejects(service.getHistory({...CN,interval:'10s'}),{code:'INVALID_HISTORY_REQUEST'});
  await assert.rejects(service.getHistory({...CN,outputsize:1000}),{code:'INVALID_HISTORY_REQUEST'});
  assert.equal(calls,0);
  const x=createMarketDataQuoteGateway({provider:{getQuote:async()=>quote},
    authorizeAccess:grant});
  await assert.rejects(x.getHistory(CN),{code:'HISTORY_PROVIDER_NOT_CONFIGURED'});
});
