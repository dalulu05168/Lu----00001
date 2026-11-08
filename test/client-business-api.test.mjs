import test from 'node:test';
import assert from 'node:assert/strict';
import {createClientBusinessApi,normalizeAccountSnapshot,normalizeAnalytics,normalizeVerifiedQuote,
  normalizePublishedCatalog,normalizeClientWatchlist}
  from '../web/client-business-api.mjs';

function response(status,data){return {ok:status>=200&&status<300,status,async json(){return data;}};}
const sampleAccount=()=>({account:{id:'account-A',cashCents:10550,currency:'USD'},
  positions:[{market:'CN',symbol:'600519',quantity:'2'}],
  orders:[{id:'order-1',market:'US',symbol:'AAPL',side:'BUY',quantity:'2',price_cents:'18200',
    amount_usd_cents:'36400',created_at:'2026-11-07T00:00:00Z'}]});
const sampleAnalytics=()=>({currency:'USD',method:'FIFO',basis:'INTERNAL_GROSS',historyAvailable:true,
  asOf:'2026-11-08T00:00:00Z',orderCount:2,holdingCount:1,buyVolumeCents:2000,
  sellVolumeCents:1000,volumeCents:3000,realizedPnlCents:-200,
  dayRealizedPnlCents:-200,monthRealizedPnlCents:-200,positionCostCents:1000,portfolioValueCents:null});

function api(fetchImpl,{capabilities={},token='session-A',now=()=>Date.parse('2026-11-08T00:00:00Z')}={}){
  return createClientBusinessApi({getToken:()=>token,fetchImpl,capabilities,now});
}
test('account balances, positions and latest order shape are read from server and normalized',async()=>{
  let called;
  const client=api(async(url,options)=>{called={url,options};return response(200,sampleAccount());});
  const result=await client.getAccount();
  assert.equal(result.account.cashCents,10550);
  assert.deepEqual(result.positions,[{market:'CN',symbol:'600519',quantity:2}]);
  assert.deepEqual(result.orders[0],{id:'order-1',market:'US',symbol:'AAPL',side:'BUY',quantity:2,
    priceCents:18200,amountUsdCents:36400,createdAt:'2026-11-07T00:00:00.000Z'});
  assert.equal(called.url,'/api/account');
  assert.equal(called.options.headers.authorization,'Bearer session-A');
  assert.equal(called.options.cache,'no-store');
  assert.equal(called.options.credentials,undefined);
});
test('missing data and unsupported markets reject instead of displaying a fake zero',()=>{
  assert.throws(()=>normalizeAccountSnapshot({...sampleAccount(),account:{id:'a',currency:'USD'}}),e=>e.code==='INVALID_RESPONSE');
  assert.throws(()=>normalizeAccountSnapshot({...sampleAccount(),positions:null}),e=>e.code==='INVALID_RESPONSE');
  assert.throws(()=>normalizeAccountSnapshot({...sampleAccount(),positions:[{market:'RO',symbol:'ABC',quantity:3}]}),e=>e.code==='INVALID_INSTRUMENT');
  assert.throws(()=>normalizeAccountSnapshot({...sampleAccount(),orders:[{id:'1'}]}),e=>e.code==='INVALID_INSTRUMENT');
});
test('analytics preserves realized loss and unknown unrealized data; missing history never becomes zero',async()=>{
  const client=api(async()=>response(200,sampleAnalytics()));
  const result=await client.getAnalytics();
  assert.equal(result.realizedPnlCents,-200);
  assert.equal(result.portfolioValueCents,null);
  const noHistory=normalizeAnalytics({...sampleAnalytics(),historyAvailable:false,
    reason:'LEDGER_HISTORY_UNAVAILABLE',realizedPnlCents:0,positionCostCents:0});
  assert.equal(noHistory.realizedPnlCents,null);
  assert.equal(noHistory.positionCostCents,null);
  assert.equal(noHistory.reason,'LEDGER_HISTORY_UNAVAILABLE');
  assert.throws(()=>normalizeAnalytics({...sampleAnalytics(),method:'AVERAGE'}),e=>e.code==='INVALID_RESPONSE');
});
test('quote must match symbol, currency, freshness and display rights',async()=>{
  const now=Date.parse('2026-11-08T00:00:00Z');
  const verified={market:'US',symbol:'AAPL',priceCents:18554,timestampMs:now-5000,
    source:'Licensed Provider',currency:'USD',status:'FRESH',stale:false,
    displayPermission:{customerDisplayAllowed:true,market:'US',currency:'USD',
      source:'Licensed Provider',validUntilMs:now+60000}};
  const calls=[];
  const client=api(async(url)=>{calls.push(url);return response(200,verified);});
  const quote=await client.getQuote({market:'US',symbol:'AAPL'});
  assert.equal(quote.priceCents,18554);
  assert.equal(calls[0],'/api/stock-quote?market=US&symbol=AAPL');
  for(const wrong of [
    {...verified,displayPermission:undefined,entitled:true},
    {...verified,displayPermission:{customerDisplayAllowed:true},entitlement:{purpose:'clientDisplay'}},
    {...verified,displayPermission:{...verified.displayPermission,validUntilMs:now-1}},
    {...verified,timestampMs:now-61000}, {...verified,market:'CN'},
    {...verified,currency:'CNY'}, {...verified,priceCents:0},
    {...verified,source:''}, {...verified,stale:true}, {...verified,status:'HISTORICAL'}
  ]){
    assert.throws(()=>normalizeVerifiedQuote(wrong,{market:'US',symbol:'AAPL'},{nowMs:now}),e=>e.status===503);
  }
  assert.throws(()=>normalizeVerifiedQuote(verified,{market:'RO',symbol:'AAPL'}),e=>e.code==='INVALID_INSTRUMENT');
});
test('401, 403, 503 and network errors propagate with trustworthy errors',async()=>{
  for(const [status,code] of [[401,'AUTH_REQUIRED'],[403,'FORBIDDEN'],[503,'SERVICE_UNAVAILABLE']]){
    const client=api(async()=>response(status,{error:'private text'}));
    await assert.rejects(()=>client.getAccount(),e=>e.status===status && e.code===code);
  }
  await assert.rejects(()=>api(async()=>{throw Error('socket down');}).getAccount(),e=>e.code==='NETWORK_UNAVAILABLE');
  await assert.rejects(()=>api(async()=>response(200,{account:null})).getAccount(),e=>e.code==='INVALID_RESPONSE');
  await assert.rejects(()=>api(async()=>response(200,sampleAccount()),{token:''}).getAccount(),e=>e.status===401);
});
test('unapproved writes are blocked even when API would respond successfully',async()=>{
  let calls=0;
  const client=api(async()=>{calls++;return response(201,{})});
  await assert.rejects(()=>client.submitInternalOrder({side:'BUY',market:'US',symbol:'AAPL',quantity:1,
    idempotencyKey:'stable-key-0001'}),e=>e.code==='FEATURE_DISABLED');
  await assert.rejects(()=>client.sendSupport('hello'),e=>e.code==='FEATURE_DISABLED');
  await assert.rejects(()=>client.submitRequest('FUNDING',{}),e=>e.code==='FEATURE_DISABLED');
  assert.equal(calls,0);
});
test('internal order sends no client price and confirms committed server order by readback',async()=>{
  const calls=[];
  const mock=async(url,options)=>{
    calls.push([url,options]);
    if(url==='/api/orders')return response(201,{replayed:false,order:{id:'order-1'}});
    if(url==='/api/account')return response(200,sampleAccount());
    throw Error('Unexpected path');
  };
  const client=api(mock,{capabilities:{trading:true}});
  const result=await client.submitInternalOrder({side:'BUY',market:'US',symbol:'AAPL',quantity:2,
    idempotencyKey:'user-intent-abc123'});
  assert.equal(result.order.id,'order-1');
  assert.equal(result.snapshot.account.cashCents,10550);
  assert.equal(result.replayed,false);
  assert.deepEqual(calls.map(c=>c[0]),['/api/orders','/api/account']);
  assert.deepEqual(JSON.parse(calls[0][1].body),{side:'BUY',market:'US',symbol:'AAPL',quantity:2});
  assert.equal(calls[0][1].headers['idempotency-key'],'user-intent-abc123');
  assert.ok(!('priceCents' in JSON.parse(calls[0][1].body)));
});
test('order response 201 without persisted order is NOT success',async()=>{
  const client=api(async(url)=>response(url==='/api/orders'?201:200,
    url==='/api/orders'?{order:{id:'unpersisted'}}:sampleAccount()),{capabilities:{trading:true}});
  await assert.rejects(()=>client.submitInternalOrder({side:'BUY',market:'US',symbol:'AAPL',quantity:2,
    idempotencyKey:'persistent-key-123'}),e=>e.code==='ORDER_UNCONFIRMED');
});
test('order acknowledged then account readback 503 preserves uncertain state',async()=>{
  const client=api(async(url)=>response(url==='/api/orders'?201:503,
    url==='/api/orders'?{order:{id:'order-1'}}:{}),{capabilities:{trading:true}});
  await assert.rejects(()=>client.submitInternalOrder({side:'BUY',market:'US',symbol:'AAPL',quantity:2,
    idempotencyKey:'retry-same-key-001'}),e=>e.code==='ORDER_READBACK_FAILED'&&e.status===503);
});
test('reject bogus instruments, invalid key and disallowed trade direction before any write',async()=>{
  let called=0;
  const client=api(async()=>{called++;return response(200,{})},{capabilities:{trading:true}});
  for(const input of [
    {side:'BUY',market:'RO',symbol:'X',quantity:1,idempotencyKey:'valid-key-123'},
    {side:'BUY',market:'US',symbol:'<script>',quantity:1,idempotencyKey:'valid-key-123'},
    {side:'SOLD',market:'US',symbol:'AAPL',quantity:1,idempotencyKey:'valid-key-123'},
    {side:'SELL',market:'US',symbol:'AAPL',quantity:0,idempotencyKey:'valid-key-123'},
    {side:'SELL',market:'US',symbol:'AAPL',quantity:1,idempotencyKey:'weak'}
  ])await assert.rejects(()=>client.submitInternalOrder(input));
  assert.equal(called,0);
});
test('support writes only confirm after GET contains submitted message id',async()=>{
  const calls=[];
  const mock=async(url,opts)=>{
    calls.push([url,opts.method]);
    if(opts.method==='POST')return response(201,{message:{id:'support-1'}});
    return response(200,{thread:{id:'thread-1'},messages:[{id:'support-1',body:'hello'}]});
  };
  const client=api(mock,{capabilities:{supportWrites:true}});
  const result=await client.sendSupport(' hello ');
  assert.equal(result.messages.length,1);
  assert.deepEqual(calls,[['/api/support','POST'],['/api/support','GET']]);
  await assert.rejects(()=>api(async(url,opts)=>opts.method==='POST'?
    response(201,{message:{id:'support-1'}}):response(200,{thread:null,messages:[]}),
    {capabilities:{supportWrites:true}}).sendSupport('hello'),e=>e.code==='SUPPORT_UNCONFIRMED');
});
test('request submissions use old QA path and readback; missing persistence rejects',async()=>{
  let last;
  const client=api(async(url,opts)=>{
    last=url;
    if(opts.method==='POST')return response(201,{item:{id:'fund-1'}});
    return response(200,{items:[{id:'fund-1'}]});
  },{capabilities:{requestWrites:true}});
  const saved=await client.submitRequest('FUNDING',{amountCents:12000});
  assert.equal(saved.item.id,'fund-1');
  assert.equal(last,'/api/requests?category=FUNDING');
  const noPersist=api(async(url,opts)=>opts.method==='POST'?
    response(201,{item:{id:'fund-1'}}):response(200,{items:[]}),{capabilities:{requestWrites:true}});
  await assert.rejects(()=>noPersist.submitRequest('FUNDING',{amountCents:12000}),e=>e.code==='REQUEST_UNCONFIRMED');
});

test('reviewed server display grant required even if provider sets entitled:true',()=>{
  const now=Date.parse('2026-11-08T00:00:00Z');
  const quote={market:'US',symbol:'AAPL',priceCents:18200,timestampMs:now-10,
    source:'Twelve Data',currency:'USD',status:'FRESH',stale:false,entitled:true,
    entitlement:{purpose:'clientDisplay',reviewReference:'vendor-level-note'}};
  assert.throws(()=>normalizeVerifiedQuote(quote,{market:'US',symbol:'AAPL'},{nowMs:now}),
    error=>error.code==='QUOTE_NOT_ENTITLED');
});
test('fractional-cent approved market quotes remain precise and never become execution cents',()=>{
  const now=Date.parse('2026-11-08T00:00:00Z');
  const quote={market:'CN',symbol:'600519',priceMicros:1234567890,priceCents:null,
    timestampMs:now,source:'Twelve Data',currency:'CNY',status:'FRESH',stale:false,
    displayPermission:{customerDisplayAllowed:true,market:'CN',source:'Twelve Data',currency:'CNY',validUntilMs:now+1000}};
  const normalized=normalizeVerifiedQuote(quote,{market:'CN',symbol:'600519'},{nowMs:now});
  assert.equal(normalized.priceMicros,1234567890);
  assert.equal(normalized.price,1234.56789);
  assert.equal(normalized.priceCents,null);
  assert.throws(()=>normalizeVerifiedQuote({...quote,priceCents:123457},
    {market:'CN',symbol:'600519'},{nowMs:now}),e=>e.code==='QUOTE_UNAVAILABLE');
});
test('server duplicate holdings/orders and fake numeric notation cannot silently change accounting',()=>{
  const p=sampleAccount();
  assert.throws(()=>normalizeAccountSnapshot({...p,positions:[...p.positions,...p.positions]}),
    e=>e.code==='INVALID_RESPONSE');
  assert.throws(()=>normalizeAccountSnapshot({...p,orders:[...p.orders,...p.orders]}),
    e=>e.code==='INVALID_RESPONSE');
  assert.throws(()=>normalizeAccountSnapshot({...p,positions:[{...p.positions[0],quantity:'1e3'}]}),
    e=>e.code==='INVALID_RESPONSE');
  assert.throws(()=>normalizeAccountSnapshot({...p,account:{...p.account,currency:'CNY'}}),
    e=>e.code==='INVALID_RESPONSE');
});
test('obsolete account response cannot leak into a newly signed-in session',async()=>{
  let token='user-A';
  let release;
  const fetchImpl=async()=>new Promise(resolve=>{release=()=>resolve(response(200,sampleAccount()));});
  const client=createClientBusinessApi({getToken:()=>token,fetchImpl});
  const pending=client.getAccount();
  token='user-B';
  release();
  await assert.rejects(()=>pending,e=>e.code==='SESSION_CHANGED'&&e.status===401);
});
test('session switch during post-order readback returns uncertainty, not confirmation',async()=>{
  let token='user-A';
  const fetchImpl=async(url)=>{
    if(url==='/api/orders')return response(201,{order:{id:'order-1'}});
    if(url==='/api/account'){
      token='user-B';
      return response(200,sampleAccount());
    }
    throw Error('unexpected route');
  };
  const client=createClientBusinessApi({getToken:()=>token,fetchImpl,capabilities:{trading:true}});
  await assert.rejects(()=>client.submitInternalOrder({side:'BUY',market:'US',symbol:'AAPL',quantity:2,
    idempotencyKey:'stable-key-0001'}),e=>e.code==='ORDER_READBACK_FAILED'&&e.status===401);
});
test('acknowledged execution price/amount must equal committed order readback',async()=>{
  const client=api(async url=>url==='/api/orders' ?
    response(201,{order:{id:'order-1',priceCents:999,amountCents:1998}}) :
    response(200,sampleAccount()),{capabilities:{trading:true}});
  await assert.rejects(()=>client.submitInternalOrder({side:'BUY',market:'US',symbol:'AAPL',quantity:2,
    idempotencyKey:'same-order-1000'}),e=>e.code==='ORDER_UNCONFIRMED');
});
test('overview exposes independent unavailable state instead of fake zero',async()=>{
  const client=api(async url=>response(url==='/api/account'?200:503,
    url==='/api/account'?sampleAccount():{error:'DB pending'}));
  const overview=await client.loadOverview();
  assert.equal(overview.account.state,'ready');
  assert.equal(overview.account.data.account.cashCents,10550);
  assert.deepEqual(overview.analytics,{state:'unavailable',data:null,errorCode:'SERVICE_UNAVAILABLE'});
  const rejected=api(async url=>response(url==='/api/account'?401:200,
    url==='/api/account'?{error:'denied'}:sampleAnalytics()));
  await assert.rejects(()=>rejected.loadOverview(),e=>e.status===401);
});

test('real published US/CN catalog names and types are retained, never inferred from ticker',async()=>{
  const items=[{id:'a',market:'US',symbol:'AAPL',itemType:'STOCK',name:'Apple Inc.'},
    {id:'b',market:'CN',symbol:'600519',itemType:'STOCK',name:'贵州茅台'},
    {id:'c',market:'US',symbol:'FUND1',itemType:'FUND',name:'Published Fund'},
    {id:'d',market:'CN',symbol:'000001',itemType:'IPO',name:'Published Offering'}];
  const client=api(async(url,opts)=>{
    assert.equal(url,'/api/catalog');
    assert.equal(opts.headers.authorization,'Bearer session-A');
    return response(200,{items});
  });
  const actual=await client.getCatalog();
  assert.equal(actual.length,4);
  assert.deepEqual(actual.slice(0,2).map(x=>[x.market,x.symbol,x.name]),[
    ['US','AAPL','Apple Inc.'],['CN','600519','贵州茅台']]);
  assert.deepEqual(actual.map(x=>x.orderEligible),[false,false,false,false]);
  assert.throws(()=>normalizePublishedCatalog({items:[{...items[0],name:''}]}), e=>e.code==='INVALID_RESPONSE');
  assert.throws(()=>normalizePublishedCatalog({items:[...items,items[0]]}), e=>e.code==='INVALID_RESPONSE');
  assert.throws(()=>normalizePublishedCatalog({items:[{...items[0],market:'RO'}]}), e=>e.code==='INVALID_INSTRUMENT');
});

test('catalog 401/403/503 failures are not converted to empty lists or made-up instruments',async()=>{
  for(const status of [401,403,503]){
    const client=api(async()=>response(status,{error:'error'}));
    await assert.rejects(()=>client.getCatalog(),e=>e.status===status);
  }
  await assert.rejects(()=>api(async()=>response(200,{items:null})).getCatalog(),e=>e.code==='INVALID_RESPONSE');
});

test('US/CN watchlist retrieval rejects duplicate and unsupported legacy records rather than hiding mismatch',async()=>{
  const items=[{market:'US',symbol:'AAPL',createdAt:'2026-11-08'},
    {market:'CN',symbol:'600519',created_at:'2026-11-08'}];
  const client=api(async(url,opts)=>{
    assert.equal(url,'/api/watchlist');
    assert.equal(opts.method,'GET');
    return response(200,{items});
  });
  assert.deepEqual(await client.getWatchlist(),[
    {market:'US',symbol:'AAPL'},{market:'CN',symbol:'600519'}]);
  assert.throws(()=>normalizeClientWatchlist({items:[items[0],items[0]]}),e=>e.code==='INVALID_RESPONSE');
  assert.throws(()=>normalizeClientWatchlist({items:[{market:'RO',symbol:'TEST'}]}),e=>e.code==='INVALID_INSTRUMENT');
});

test('watchlist 401/403/503 and missing list reject without reporting a saved state',async()=>{
  for(const status of [401,403,503]){
    const client=api(async()=>response(status,{}));
    await assert.rejects(()=>client.getWatchlist(),e=>e.status===status);
  }
  await assert.rejects(()=>api(async()=>response(200,{items:undefined})).getWatchlist(),
    e=>e.code==='INVALID_RESPONSE');
});

test('new watchlist writes require explicit QA capability; otherwise no HTTP mutation',async()=>{
  let calls=0;
  const client=api(async()=>{calls++;return response(200,{items:[]})});
  await assert.rejects(()=>client.setWatchlist({market:'US',symbol:'AAPL'},true),e=>e.code==='FEATURE_DISABLED');
  await assert.rejects(()=>client.setWatchlist({market:'CN',symbol:'600519'},true),e=>e.code==='FEATURE_DISABLED');
  assert.equal(calls,0);
});

test('US/CN watchlist add uses the real server POST then GET readback, no browser-local guessed save',async()=>{
  let stored=[];
  const calls=[];
  const client=api(async(url,opts)=>{
    calls.push({url,method:opts.method,body:opts.body,authorization:opts.headers.authorization});
    assert.equal(url,'/api/watchlist');
    if(opts.method==='POST') {
      const item=JSON.parse(opts.body);
      stored.push(item);
      return response(200,{item});
    }
    return response(200,{items:[...stored]});
  },{capabilities:{watchlistWrites:true}});
  const saved=await client.setWatchlist({market:'CN',symbol:'600519'},true);
  assert.deepEqual(saved,[{market:'CN',symbol:'600519'}]);
  assert.deepEqual(calls.map(c=>c.method),['GET','POST','GET']);
  assert.deepEqual(JSON.parse(calls[1].body),{market:'CN',symbol:'600519'});
  assert.ok(calls.every(c=>c.authorization==='Bearer session-A'));
  assert.deepEqual(await client.setWatchlist({market:'CN',symbol:'600519'},true),saved);
  assert.deepEqual(calls.map(c=>c.method),['GET','POST','GET','GET']);
});

test('US watchlist DELETE confirms removal by GET, no local optimistic deletion',async()=>{
  let stored=[{market:'US',symbol:'MSFT'}];
  const methods=[];
  const client=api(async(url,opts)=>{
    methods.push(opts.method);
    if(opts.method==='DELETE'){stored=[];return response(200,{item:{market:'US',symbol:'MSFT'}});}
    return response(200,{items:[...stored]});
  },{capabilities:{watchlistWrites:true}});
  assert.deepEqual(await client.setWatchlist({market:'US',symbol:'MSFT'},false),[]);
  assert.deepEqual(methods,['GET','DELETE','GET']);
});

test('watchlist POST 200 without durable change and GET 503 yield uncertain failures',async()=>{
  const unavailable=api(async(url,opts)=>{
    if(opts.method==='POST')return response(200,{item:{market:'US',symbol:'AAPL'}});
    return response(200,{items:[]});
  },{capabilities:{watchlistWrites:true}});
  await assert.rejects(()=>unavailable.setWatchlist({market:'US',symbol:'AAPL'},true),
    e=>e.code==='WATCHLIST_UNCONFIRMED');
  let reads=0;
  const down=api(async(url,opts)=>{
    if(opts.method==='POST')return response(200,{item:{market:'US',symbol:'AAPL'}});
    reads++;
    return reads===1?response(200,{items:[]}):response(503,{});
  },{capabilities:{watchlistWrites:true}});
  await assert.rejects(()=>down.setWatchlist({market:'US',symbol:'AAPL'},true),
    e=>e.code==='WATCHLIST_READBACK_FAILED'&&e.status===503);
});

test('CN watchlist incompatibility from old US/RO QA returns actual 400 without fake success',async()=>{
  let requests=0;
  const client=api(async(url,opts)=>{
    requests++;
    return opts.method==='POST'?response(400,{error:'Invalid watchlist instrument'}):response(200,{items:[]});
  },{capabilities:{watchlistWrites:true}});
  await assert.rejects(()=>client.setWatchlist({market:'CN',symbol:'600519'},true),
    e=>e.status===400&&e.code==='API_ERROR');
  assert.equal(requests,2); // GET then rejected POST; no successful readback
});

test('watchlist wrong token or changed session during POST cannot read another account state',async()=>{
  let token='customer-A';
  const calls=[];
  const client=createClientBusinessApi({getToken:()=>token,capabilities:{watchlistWrites:true},
    fetchImpl:async(url,opts)=>{
      calls.push(opts.method);
      if(opts.method==='POST'){
        token='customer-B';
        return response(200,{item:{market:'US',symbol:'AAPL'}});
      }
      return response(200,{items:[]});
    }});
  await assert.rejects(()=>client.setWatchlist({market:'US',symbol:'AAPL'},true),
    e=>e.code==='SESSION_CHANGED'&&e.status===401);
  assert.deepEqual(calls,['GET','POST']);
});
