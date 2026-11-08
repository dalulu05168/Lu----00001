import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
import {normalizeCatalog,normalizeWatchlist,requestAuthenticated,readCatalog,readWatchlist,changeWatchlist}
  from '../web/client-data-api.mjs';

function reply(status,data) {
  return {ok:status>=200&&status<300,status,async json(){return data}};
}
test('US/CN data normalizers reject unsupported markets and malformed items',()=>{
  assert.deepEqual(normalizeCatalog([
    {market:'US',symbol:'AAPL',itemType:'STOCK',name:'Apple'},
    {market:'CN',symbol:'600519',itemType:'STOCK',name:'贵州茅台'},
    {market:'HK',symbol:'0700',itemType:'STOCK',name:'skip'},
    {market:'MY',symbol:'1155',itemType:'FUND',name:'skip'},
    {market:'US',symbol:'<script>',itemType:'STOCK',name:'skip'}
  ]),[
    {market:'US',symbol:'AAPL',itemType:'STOCK',name:'Apple'},
    {market:'CN',symbol:'600519',itemType:'STOCK',name:'贵州茅台'}
  ]);
  assert.deepEqual(normalizeWatchlist([
    {market:'US',symbol:'AAPL'},{market:'CN',symbol:'600519'},
    {market:'US',symbol:'AAPL'},{market:'HK',symbol:'0700'}
  ]),[{market:'US',symbol:'AAPL'},{market:'CN',symbol:'600519'}]);
  assert.throws(()=>normalizeCatalog(null),/格式/);
  assert.throws(()=>normalizeWatchlist({}),/格式/);
});
test('authenticated requests carry a bearer token, reject 401 and never use cookie credentials',async()=>{
  const calls=[];
  const fake=async(url,opts)=>{calls.push({url,opts});return reply(200,{items:[]})};
  const result=await requestAuthenticated('/catalog','user-token',{fetchImpl:fake});
  assert.deepEqual(result,{items:[]});
  assert.equal(calls[0].url,'/api/catalog');
  assert.equal(calls[0].opts.headers.authorization,'Bearer user-token');
  assert.equal(calls[0].opts.cache,'no-store');
  assert.equal(calls[0].opts.credentials,undefined);
  await assert.rejects(()=>requestAuthenticated('/account','',{fetchImpl:fake}),e=>e.status===401);
  await assert.rejects(()=>requestAuthenticated('/catalog','expired',{fetchImpl:async()=>reply(401,{error:'no'})}),e=>e.status===401);
  await assert.rejects(()=>requestAuthenticated('/catalog','token',{fetchImpl:async()=>reply(503,{})}),e=>e.status===503);
  await assert.rejects(()=>requestAuthenticated('/orders','token',{fetchImpl:fake}),/Unsupported/);
});
test('watchlist mutation writes through API and verifies saved items with second GET',async()=>{
  const calls=[],items=[];
  const fake=async(url,opts)=>{
    calls.push([url,opts.method,opts.headers.authorization]);
    if(url==='/api/catalog')return reply(200,{items:[{market:'CN',symbol:'600519',itemType:'STOCK',name:'贵州茅台'}]});
    if(url!=='/api/watchlist')throw new Error('Unexpected path');
    if(opts.method==='POST')items.push(JSON.parse(opts.body));
    if(opts.method==='DELETE'){
      const body=JSON.parse(opts.body),index=items.findIndex(i=>i.market===body.market&&i.symbol===body.symbol);
      if(index!==-1)items.splice(index,1);
    }
    return reply(200,opts.method==='GET'?{items:[...items]}:{item:JSON.parse(opts.body)});
  };
  assert.equal((await readCatalog('user',fake))[0].symbol,'600519');
  assert.deepEqual(await readWatchlist('user',fake),[]);
  const first=await changeWatchlist('user',{market:'CN',symbol:'600519'},[],fake);
  assert.deepEqual(first,[{market:'CN',symbol:'600519'}]);
  const second=await changeWatchlist('user',{market:'CN',symbol:'600519'},first,fake);
  assert.deepEqual(second,[]);
  assert.deepEqual(calls.map(x=>x[1]),['GET','GET','POST','GET','DELETE','GET']);
  await assert.rejects(()=>changeWatchlist('user',{market:'HK',symbol:'0700'},[],fake),/无效/);
});
test('both terminals bind catalog/watchlist sync and keep trade closed',async()=>{
  const root=new URL('../',import.meta.url);
  for(const base of ['desktop','cn-terminal']){
    const html=await readFile(new URL('web/'+base+'.html',root),'utf8');
    const bridge=await readFile(new URL('web/'+base+'-bridge.mjs',root),'utf8');
    assert.match(bridge,/readCatalog\(token\)/);
    assert.match(bridge,/readWatchlist\(token\)/);
    assert.match(bridge,/changeWatchlist\(token/);
    assert.match(bridge,/Promise\.allSettled/);
    assert.match(html,/window\.CN_SYNC_CATALOG/);
    assert.match(html,/window\.CN_SYNC_WATCHLIST/);
    assert.match(html,/TRADING_ENABLED=false/);
    assert.doesNotMatch(html,/DATA\.fav\.push\(s\)/);
    const inline=html.match(/<script>\s*\(function\(\)\{[\s\S]*?<\/script>/);
    assert.ok(inline,'inline module present: '+base);
    new Script(inline[0].replace(/^<script>/,'').replace(/<\/script>$/,''),{filename:base+'.html'});
  }
  const server=await readFile(new URL('src/http-api.mjs',root),'utf8');
  assert.match(server,/"\/client-data-api\.mjs"/);
});
