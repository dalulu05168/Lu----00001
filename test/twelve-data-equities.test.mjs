import test from 'node:test';
import assert from 'node:assert/strict';
import {createTwelveDataEquities} from '../src/twelve-data-equities.mjs';

const NOW = 1_800_000_000_000;
const rights = Object.freeze({
  US: {provider:'Twelve Data',clientDisplay:true,internalSimulationPricing:true,reviewReference:'reviewed-us-contract'},
  CN: {provider:'Twelve Data',clientDisplay:true,internalSimulationPricing:false,reviewReference:'reviewed-cn-contract'}
});
const base = {symbol:'AAPL', name:'Apple Inc.', currency:'USD', mic_code:'XNAS', exchange:'NASDAQ',
  close:'148.85000', previous_close:'149.09000', last_quote_at:Math.floor((NOW-13_000)/1000), timestamp:0};
const history = {meta:{symbol:'600519',mic_code:'XSHG',exchange:'SSE',currency:'CNY',interval:'1day',exchange_timezone:'Asia/Shanghai'},
  values:[{datetime:'2026-11-06',open:'1450.00',high:'1460.00',low:'1449.00',close:'1455.00',volume:'10000'},
          {datetime:'2026-11-05',open:'1445.00',high:'1457.00',low:'1443.00',close:'1451.00',volume:'9000'}]};
const ok = data => new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
const make = (body=base,extra={}) => {
  const calls=[];
  const adapter=createTwelveDataEquities({apiKey:'private-test-token',rights,now:()=>NOW,
    fetchImpl:async (url,opts)=>{calls.push({url,opts});return body instanceof Response?body:ok(body)}, ...extra});
  return {adapter,calls};
};

test('US quote is sourced and checked from last_quote_at, not candle timestamp',async()=>{
  const {adapter,calls}=make();
  const q=await adapter.getQuote({market:'US',symbol:'AAPL'});
  assert.equal(q.price,148.85);assert.equal(q.change,-0.24);assert.equal(q.percentChange,-0.16098);
  assert.equal(q.timestampMs,NOW-13000);assert.equal(q.currency,'USD');assert.equal(q.status,'FRESH');
  assert.equal(q.entitlement.reviewReference,'reviewed-us-contract');
  assert.equal(calls.length,1);assert.equal(calls[0].url.searchParams.get('apikey'),null);
  assert.equal(calls[0].opts.headers.Authorization,'apikey private-test-token');
  assert.equal(calls[0].url.searchParams.get('interval'),'1min');
});

test('CN six-digit SSE quote and history are requested with explicit exchange',async()=>{
  const q= {...base,symbol:'600519',name:'Kweichow Moutai',currency:'CNY',mic_code:'XSHG',exchange:'SSE',close:'1452.00'};
  const {adapter,calls}=make(q);
  const result=await adapter.getQuote({market:'CN',symbol:'600519'});
  assert.equal(result.currency,'CNY');assert.equal(result.price,1452);
  assert.equal(calls[0].url.searchParams.get('mic_code'),'XSHG');
  const h=make(history);
  const bars=await h.adapter.getHistory({market:'CN',symbol:'600519',outputsize:2});
  assert.deepEqual(bars.values.map(x=>x.datetime),['2026-11-05','2026-11-06']);
  assert.equal(bars.values[1].high,1460);
  assert.equal(bars.values[1].volume,10000);
  assert.equal(h.calls[0].url.pathname,'/time_series');
});

test('CN SZSE mapping is exact, and incorrect provider exchange rejected',async()=>{
  const q={...base,symbol:'000001',name:'Ping An Bank',currency:'CNY',mic_code:'XSHE',exchange:'SZSE'};
  const {adapter,calls}=make(q);
  await adapter.getQuote({market:'CN',symbol:'000001'});
  assert.equal(calls[0].url.searchParams.get('mic_code'),'XSHE');
  await assert.rejects(make({...q,mic_code:'XSHG'}).adapter.getQuote({market:'CN',symbol:'000001'}),{code:'PROVIDER_IDENTITY_MISMATCH'});
});

test('never accepts stale, future, or missing last trade timestamps',async()=>{
  for(const ts of [undefined,Math.floor((NOW-120_000)/1000),Math.floor((NOW+10_000)/1000)]){
    await assert.rejects(make({...base,last_quote_at:ts}).adapter.getQuote({market:'US',symbol:'AAPL'}),
      e=>['INVALID_QUOTE_TIMESTAMP','STALE_OR_FUTURE_QUOTE'].includes(e.code));
  }
});

test('rejects unapproved customer display and internal pricing independently',async()=>{
  await assert.rejects(make().adapter.getQuote({market:'CN',symbol:'600519'},{purpose:'internalSimulationPricing'}),
    {code:'DATA_USE_RIGHTS_UNVERIFIED'});
  const x=make(base,{rights:{US:{provider:'Twelve Data',clientDisplay:true,reviewReference:''}}});
  await assert.rejects(x.adapter.getQuote({market:'US',symbol:'AAPL'}),{code:'DATA_USE_RIGHTS_UNVERIFIED'});
  assert.equal(x.calls.length,0);
});

test('fail closed with no API key, invalid symbols, or unrecognized markets',async()=>{
  await assert.rejects(make(base,{apiKey:''}).adapter.getQuote({market:'US',symbol:'AAPL'}),{code:'MARKET_DATA_NOT_CONFIGURED'});
  const x=make();
  for (const item of [{market:'CN',symbol:'830001'},{market:'US',symbol:'AAPL/../../'},
    {market:'HK',symbol:'00700'},{market:'CN',symbol:'600519.SS'}]){
    await assert.rejects(x.adapter.getQuote(item),{code:'UNSUPPORTED_INSTRUMENT'});
  }
  assert.equal(x.calls.length,0);
});

test('invalid source identity, currency, precision and volumes never return valid quotes',async()=>{
  for(const value of [{...base,currency:'CNY'}, {...base,symbol:'MSFT'}, {...base,mic_code:'XSHG'},
    {...base,close:'148.8500001'}, {...base,close:'0.00000'}]){
    await assert.rejects(make(value).adapter.getQuote({market:'US',symbol:'AAPL'}));
  }
  await assert.rejects(make({...history,values:[{...history.values[0],volume:'-3'}]}).adapter.getHistory({market:'CN',symbol:'600519'}),
    {code:'INVALID_HISTORY_VOLUME'});
});

test('upstream errors, rate limits and malformed payloads produce explicit failures',async()=>{
  for(const [response,code] of [[new Response('{}',{status:429}),'PROVIDER_RATE_LIMITED'],
    [new Response('{}',{status:500}),'PROVIDER_HTTP_ERROR'],[ok({status:'error',code:401}),'PROVIDER_REJECTED_REQUEST'],
    [new Response('not json',{status:200}),'PROVIDER_INVALID_JSON']]){
    await assert.rejects(make(response).adapter.getQuote({market:'US',symbol:'AAPL'}),{code});
  }
});

test('oversized responses are stopped while streaming',async()=>{
  const response=new Response('x'.repeat(1500));
  await assert.rejects(make(response,{maxResponseBytes:1024}).adapter.getQuote({market:'US',symbol:'AAPL'}),
    {code:'PROVIDER_RESPONSE_TOO_LARGE'});
});

test('history rejects duplicate bars and inconsistent OHLC, and limits request sizes',async()=>{
  for(const val of [[history.values[0],history.values[0]],
    [{...history.values[0],high:'1400.00'}]]){
    await assert.rejects(make({...history,values:val}).adapter.getHistory({market:'CN',symbol:'600519'}));
  }
  await assert.rejects(make(history).adapter.getHistory({market:'CN',symbol:'600519',outputsize:1000}),
    {code:'INVALID_HISTORY_OPTIONS'});
});

test('rejects impossible future historical dates', async()=>{
  await assert.rejects(make({...history,values:[{...history.values[0],datetime:'2099-11-06'}]}).adapter.getHistory({market:'CN',symbol:'600519'}), {code:'INVALID_HISTORY_DATE'});
});

test('provider five-decimal display prices stay exact; subcent prices cannot become cent-only order prices',async()=>{
  const x=make({...base,close:'148.85001',previous_close:'149.09000'});
  const quote=await x.adapter.getQuote({market:'US',symbol:'AAPL'});
  assert.equal(quote.price,148.85001);
  assert.equal(quote.priceCents,null);
  assert.equal(quote.change,-0.23999);
  await assert.rejects(x.adapter.getQuote({market:'US',symbol:'AAPL'},{purpose:'internalSimulationPricing'}),
    {code:'SUBCENT_ORDER_PRICING_UNSUPPORTED'});
});

test('Shanghai B-share symbols are not mistaken for CNY-denominated A shares',async()=>{
  await assert.rejects(make().adapter.getQuote({market:'CN',symbol:'900901'}),{code:'UNSUPPORTED_INSTRUMENT'});
});

test('history refuses incorrect interval or timezone metadata rather than relabeling candles', async()=>{
  for (const meta of [{...history.meta,interval:'1min'},{...history.meta,exchange_timezone:'UTC'}]) {
    await assert.rejects(make({...history,meta}).adapter.getHistory({market:'CN',symbol:'600519'}),
      {code:'PROVIDER_HISTORY_METADATA_MISMATCH'});
  }
});

test('history rejects impossible calendar dates, invalid times and false chart bars',async()=>{
  for (const datetime of ['2026-02-31','2026-11-06 25:61:00']) {
    const intraday=datetime.includes(' ');
    const meta={...history.meta,interval:intraday?'1min':'1day'};
    await assert.rejects(make({...history,meta,values:[{...history.values[0],datetime}]}).adapter.getHistory({market:'CN',symbol:'600519',interval:meta.interval}));
  }
});


test('preferred one-object quote purpose is honored and cannot silently switch to display', async()=>{
  const {adapter,calls}=make();
  const q=await adapter.getQuote({market:'US',symbol:'AAPL',purpose:'internalSimulationPricing'});
  assert.equal(q.entitlement.purpose,'internalSimulationPricing');
  assert.equal(q.priceCents,14885);
  assert.equal(calls.length,1);
  await assert.rejects(adapter.getQuote(
    {market:'US',symbol:'AAPL',purpose:'internalSimulationPricing'},
    {purpose:'clientDisplay'}),{code:'AMBIGUOUS_DATA_PURPOSE'});
  assert.equal(calls.length,1);
});

test('unconfigured quote request and unlicensed CN purpose fail without vendor I/O',async()=>{
  const {adapter,calls}=make();
  await assert.rejects(adapter.getQuote(null),{code:'UNSUPPORTED_INSTRUMENT'});
  await assert.rejects(adapter.getQuote(
    {market:'CN',symbol:'600519',purpose:'internalSimulationPricing'}),
    {code:'DATA_USE_RIGHTS_UNVERIFIED'});
  assert.equal(calls.length,0);
});
