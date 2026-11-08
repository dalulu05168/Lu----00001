import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketDataQuoteGateway} from '../src/market-data-quote-gateway.mjs';

const NOW=1_800_000_000_000;
const quote=Object.freeze({market:'US',symbol:'AAPL',currency:'USD',source:'Twelve Data',
  price:129.45,priceCents:12945,timestampMs:NOW-1000,status:'FRESH',stale:false});
const request={market:'US',symbol:'AAPL'};
const grant=({source, market, currency, purpose})=>({provider:source,market,currency,purpose,
  allowed:true,expiresAtMs:NOW+60_000,reviewReference:'server-reviewed-agreement'});
const create=({getQuote=async()=>quote,authorizeAccess=grant,clock=()=>NOW,cacheTtlMs=1000}={}) =>
  createMarketDataQuoteGateway({provider:{getQuote},authorizeAccess,now:clock,cacheTtlMs});

// All numeric prices are isolated deterministic provider response fixtures;
// these tests make no live market-data claim.
test('successful authorized server quote retains exact time and provenance',async()=>{
  const found=await create().getQuote(request);
  assert.equal(found.price,129.45);
  assert.equal(found.checkedAtMs,NOW);
  assert.equal(found.ageMs,1000);
  assert.equal(found.entitlement.reviewReference,'server-reviewed-agreement');
});

test('denied rights fail before network and cannot be bypassed by a cached response',async()=>{
  let calls=0,allowed=true;
  const service=create({getQuote:async()=>{calls++;return quote;},authorizeAccess:r=>allowed?grant(r):null});
  await service.getQuote(request);
  allowed=false;
  await assert.rejects(service.getQuote(request),{code:'DATA_RIGHTS_NOT_VERIFIED'});
  assert.equal(calls,1);
});

test('cached price is never extended beyond original timestamp',async()=>{
  let clock=NOW, count=0;
  const service=create({clock:()=>clock,getQuote:async()=>{count++;return quote;},cacheTtlMs:5000,
    authorizeAccess:r=>({...grant(r),expiresAtMs:NOW+300_000})});
  await service.getQuote(request);
  clock += 61_000;
  await assert.rejects(service.getQuote(request),{code:'QUOTE_STALE_OR_FUTURE'});
  assert.equal(count,2);
});

test('parallel requests for same market, symbol and purpose share single fetch',async()=>{
  let calls=0;
  const service=create({getQuote:async()=>{calls++;await new Promise(r=>setImmediate(r));return quote;}});
  const rows=await Promise.all(Array.from({length:12},()=>service.getQuote(request)));
  assert.equal(calls,1);
  assert.equal(rows.length,12);
});

test('display grant does not automatically permit internal pricing',async()=>{
  const service=create({authorizeAccess:r=>r.purpose==='clientDisplay'?grant(r):null});
  await service.getQuote(request);
  await assert.rejects(service.getQuote(request,{purpose:'internalSimulationPricing'}),
    {code:'DATA_RIGHTS_NOT_VERIFIED'});
});

test('invalid currency, stale price and subcent execution quotes fail closed',async()=>{
  for(const q of [{...quote,currency:'CNY'},{...quote,timestampMs:NOW-90_000},
    {...quote,price:129.451,priceCents:null}]) {
    const purpose=q.priceCents===null?'internalSimulationPricing':'clientDisplay';
    const code=q.currency==='CNY'?'INVALID_UPSTREAM_QUOTE':
      q.priceCents===null?'EXECUTION_PRICE_NOT_EXACT_CENTS':'QUOTE_STALE_OR_FUTURE';
    await assert.rejects(create({getQuote:async()=>q}).getQuote(request,{purpose}),{code});
  }
});

test('provider network rejection is a 503 and does not populate cache',async()=>{
  let count=0;
  const service=create({getQuote:async()=>{count++;throw new Error('network unavailable');}});
  await assert.rejects(service.getQuote(request),{code:'UPSTREAM_QUOTE_UNAVAILABLE',statusCode:503});
  await assert.rejects(service.getQuote(request),{code:'UPSTREAM_QUOTE_UNAVAILABLE'});
  assert.equal(count,2);
});

test('symbol and market input are validated before provider call',async()=>{
  let calls=0;
  const service=create({getQuote:async()=>{calls++;return quote;}});
  for(const bad of [{market:'CN',symbol:'AAPL'},{market:'US',symbol:'600519'},
    {market:'US',symbol:'AAPL/../../'},{}]) {
    await assert.rejects(service.getQuote(bad),{code:'INVALID_QUOTE_REQUEST'});
  }
  assert.equal(calls,0);
});
