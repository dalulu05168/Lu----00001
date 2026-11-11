import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi,cents,amount,quote} from './api.mjs';
import {toCents,discountedCents,createBusiness} from './business.mjs';
import {decimalUnits} from './mutual-funds.mjs';

test('mutual fund amounts and redemption units preserve exact integer scales',()=>{
 assert.equal(decimalUnits('12.50',2),'1250');
 assert.equal(decimalUnits('0.000001',6),'1');
 assert.equal(decimalUnits('7.5',6),'7500000');
 for(const value of ['0','-1','1e3','1.005','Infinity'])assert.throws(()=>decimalUnits(value,2));
 assert.throws(()=>decimalUnits('0.0000001',6));
});

test('uncertain order key survives a new client instance and clears after replay',async()=>{
 const original=globalThis.sessionStorage,store=new Map();globalThis.sessionStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 try{let keys=[],fail=true;const fetcher=async(p,o)=>{if(p.endsWith('/login'))return Response.json({token:'isolated'});if(p.startsWith('/api/order-results'))return Response.json({found:false});keys.push(o.headers['Idempotency-Key']);if(fail)throw TypeError('Failed to fetch');return Response.json({replayed:true})};
 let a=createApi(fetcher);await a.login('retry@example.test','fake');await assert.rejects(a.request('/api/bulk-orders',{method:'POST',body:{quantity:1},key:'original-key'}));
 a=createApi(fetcher);await a.login('retry@example.test','fake');await assert.rejects(a.request('/api/bulk-orders',{method:'POST',body:{quantity:2},key:'different-key'}),/尚未确认/);fail=false;await a.request('/api/bulk-orders',{method:'POST',body:{quantity:1},key:'new-ui-key'});assert.deepEqual(keys,['original-key','original-key']);assert.equal(store.size,0);
 }finally{globalThis.sessionStorage=original;}
});
test('amount units preserve null and database strings',()=>{
 assert.equal(cents('9929862'),99298.62);assert.equal(amount(100000),100000);
 for(const v of [null,undefined,''])assert.equal(cents(v),null);
 assert.equal(quote({}),null);assert.equal(cents(1.5),null);
});
test('decimal input and bps rounding use integer arithmetic',()=>{
 assert.equal(toCents('100.01'),10001);assert.equal(toCents('0.1'),10);
 for(const v of ['1.005','-1','1e3','NaN','0'])assert.throws(()=>toCents(v));
 assert.equal(discountedCents(35069,1200),30861);assert.equal(discountedCents(35069,0),35069);
});
test('204 logout clears authorization and never parses empty JSON',async()=>{
 const calls=[];const api=createApi(async(p,options)=>{calls.push([p,options]);return p.endsWith('/login')?Response.json({token:'fake-isolated-token'}):p.endsWith('/logout')?new Response(null,{status:204}):Response.json({items:[]});});
 await api.login('test@example.test','fake');await api.catalog();assert.equal(calls.at(-1)[1].headers.Authorization,'Bearer fake-isolated-token');
 await api.logout();await api.catalog();assert.equal(calls.at(-1)[1].headers.Authorization,undefined);
});
test('watchlist writes are server-confirmed and errors propagate',async()=>{
 let options;const api=createApi(async(p,o)=>{options=o;return Response.json({error:'Watchlist limit reached'},{status:409});});
 await assert.rejects(api.watch({market:'US',symbol:'AAPL'},true),e=>e.status===409);
 assert.deepEqual(JSON.parse(options.body),{market:'US',symbol:'AAPL'});assert.equal(options.method,'POST');
});
test('request retains supplied idempotency key and rejects malformed response',async()=>{
 let headers;const api=createApi(async(p,o)=>{headers=o.headers;return Response.json({replayed:true});});
 await api.request('/api/bulk-orders',{method:'POST',body:{quantity:1},key:'same-isolated-request'});
 assert.equal(headers['Idempotency-Key'],'same-isolated-request');
 const bad=createApi(async()=>new Response('<html>error</html>',{status:502}));await assert.rejects(bad.catalog(),/格式无效/);
});
test('business views escape API text and disable trading without quote',async()=>{
 const state={epoch:0,page:'products',busy:false};
 const item={id:'test-product',kind:'BULK_STOCK',name:'<img onerror=alert(1)>',symbol:'AAPL',market:'US',version:1,discountBps:1200,minQuantity:10};
 const api={request:async path=>{if(path==='/api/products')return {items:[item],contracts:[]};if(path.startsWith('/api/products/quote'))throw Error('Quote unavailable');return {items:[]};}};
 const esc=v=>String(v??'').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const originalWindow=globalThis.window;globalThis.window={scrollTo(){}};
 try{
  const b=createBusiness({api,state,esc,display:String,time:String,render(){},refresh:async()=>{},reset(){},back:()=>'',friendly:e=>e.message});
  await b.enter('products');assert.ok(b.view('products').includes('&lt;img'));
  await b.click({dataset:{product:item.id}});await b.click({dataset:{business:'bulk-buy'}});
  const html=b.view('bulk-order');assert.ok(html.includes('报价不可用，禁止提交'));assert.ok(!html.includes('data-business-form="bulk"'));
 }finally{globalThis.window=originalWindow;}
});

