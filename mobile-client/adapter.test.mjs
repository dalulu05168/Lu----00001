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
 try{let keys=[],fail=true;const fetcher=async(p,o)=>{if(p.endsWith('/login'))return Response.json({token:'isolated'});if(p==='/api/account')return Response.json({account:{id:'acct-retry'}});if(p.startsWith('/api/order-results'))return Response.json({found:false});keys.push(o.headers['Idempotency-Key']);if(fail)throw TypeError('Failed to fetch');return Response.json({replayed:true})};
 let a=createApi(fetcher);await a.login('retry@example.test','fake');await assert.rejects(a.request('/api/bulk-orders',{method:'POST',body:{quantity:1},key:'original-key'}));
 a=createApi(fetcher);await a.login('retry@example.test','fake');await assert.rejects(a.request('/api/bulk-orders',{method:'POST',body:{quantity:2},key:'different-key'}),/尚未确认/);fail=false;await a.request('/api/bulk-orders',{method:'POST',body:{quantity:1},key:'new-ui-key'});assert.deepEqual(keys,['original-key','original-key']);assert.equal(store.size,0);
 }finally{globalThis.sessionStorage=original;}
});
test('amount units preserve null and database strings',()=>{
 assert.equal(cents('9929862'),99298.62);assert.equal(amount(100000),100000);
 for(const v of [null,undefined,''])assert.equal(cents(v),null);
 assert.equal(quote({}),null);assert.equal(cents(1.5),null);
});
test('expired login preserves pending receipt until authenticated replay succeeds',async()=>{
 const original=globalThis.sessionStorage,store=new Map();globalThis.sessionStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 try{for(const path of ['/api/orders','/api/product-settlement','/api/fund-subscriptions','/api/bulk-orders','/api/requests','/api/support']){
  let phase='lost',keys=[];const fetcher=async(p,o)=>{if(p.endsWith('/login'))return Response.json({token:'isolated'});if(p==='/api/account')return Response.json({account:{id:'acct-retry'}});keys.push(o.headers['Idempotency-Key']);if(phase==='lost')throw TypeError('Lost response');if(phase==='expired')return Response.json({error:'Expired'},{status:401});return Response.json({replayed:true})};
  let api=createApi(fetcher);await api.login('retry@example.test','fake');const body={item:'same-transaction'};
  await assert.rejects(api.request(path,{method:'POST',body,key:'original-key'}));phase='expired';await assert.rejects(api.request(path,{method:'POST',body,key:'generated-again'}),e=>e.status===401);assert.equal(store.size,1);
  api=createApi(fetcher);await api.login('retry@example.test','fake');phase='ok';await api.request(path,{method:'POST',body,key:'another-new-ui-key'});assert.deepEqual(keys,['original-key','original-key','original-key']);assert.equal(store.size,0);
 }}finally{globalThis.sessionStorage=original;}
});
test('decimal input and bps rounding use integer arithmetic',()=>{
 assert.equal(toCents('100.01'),10001);assert.equal(toCents('0.1'),10);
 for(const v of ['1.005','-1','1e3','NaN','0'])assert.throws(()=>toCents(v));
 assert.equal(discountedCents(35069,1200),30861);assert.equal(discountedCents(35069,0),35069);
});
test('204 logout clears authorization and never parses empty JSON',async()=>{
 const calls=[];const api=createApi(async(p,options)=>{calls.push([p,options]);return p.endsWith('/login')?Response.json({token:'fake-isolated-token'}):p==='/api/account'?Response.json({account:{id:'acct-logout'}}):p.endsWith('/logout')?new Response(null,{status:204}):Response.json({items:[]});});
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


// Cookie-session restore (Issue #56): the pending-order journal must survive a reload, stay per account,
// and a failed restore must leave no session behind.
function memoryStorage(){const store=new Map();return {store,api:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)}};}
function server({account='acct-a',accountStatus=200,lose=true}={}){const calls=[];const fetcher=async(p,o)=>{calls.push([p,o]);if(p.endsWith('/login'))return Response.json({token:'cn-cookie-session'});
 if(p==='/api/account')return accountStatus===200?Response.json({account:{id:account}}):Response.json({error:'Unauthorized'},{status:accountStatus});
 if(p.startsWith('/api/order-results'))return Response.json({found:false});if(lose)throw TypeError('Lost response');return Response.json({ok:true});};return {fetcher,calls};}
test('restored session reuses the pending order key from before the reload',async()=>{
 const original=globalThis.sessionStorage,mem=memoryStorage();globalThis.sessionStorage=mem.api;
 try{const first=server();let api=createApi(first.fetcher);await api.login('Same@Example.test','pw');
  await assert.rejects(api.request('/api/orders',{method:'POST',body:{symbol:'AAPL',qty:1},key:'key-before-reload'}));
  assert.deepEqual([...mem.store.keys()],['cn.pending.account:acct-a']);
  const after=server({lose:false});api=createApi(after.fetcher);const snapshot=await api.restore();assert.equal(snapshot.account.id,'acct-a');
  await api.request('/api/orders',{method:'POST',body:{symbol:'AAPL',qty:1},key:'new-key-after-reload'});
  const sent=after.calls.filter(([p])=>p==='/api/orders').map(([,o])=>o.headers['Idempotency-Key']);assert.deepEqual(sent,['key-before-reload']);assert.equal(mem.store.size,0);
 }finally{globalThis.sessionStorage=original;}
});
test('pending order journal is isolated between accounts in one browser tab',async()=>{
 const original=globalThis.sessionStorage,mem=memoryStorage();globalThis.sessionStorage=mem.api;
 try{let api=createApi(server({account:'acct-a'}).fetcher);await api.login('a@example.test','pw');
  await assert.rejects(api.request('/api/orders',{method:'POST',body:{symbol:'AAPL',qty:1},key:'a-key'}));await api.logout().catch(()=>{});
  const b=server({account:'acct-b',lose:false});api=createApi(b.fetcher);await api.restore();
  await api.request('/api/orders',{method:'POST',body:{symbol:'MSFT',qty:3},key:'b-key'});
  assert.deepEqual(b.calls.filter(([p])=>p==='/api/orders').map(([,o])=>o.headers['Idempotency-Key']),['b-key']);
  assert(mem.store.has('cn.pending.account:acct-a'),'account A record must stay for account A');
 }finally{globalThis.sessionStorage=original;}
});
test('an email-keyed record from before this change is adopted at sign-in',async()=>{
 const original=globalThis.sessionStorage,mem=memoryStorage();globalThis.sessionStorage=mem.api;
 try{mem.store.set('cn.pending.legacy@example.test',JSON.stringify({path:'/api/orders',digest:'d',key:'legacy-key'}));
  const api=createApi(server({account:'acct-legacy'}).fetcher);await api.login('Legacy@Example.test','pw');
  assert.deepEqual([...mem.store.keys()],['cn.pending.account:acct-legacy']);assert.equal(JSON.parse(mem.store.get('cn.pending.account:acct-legacy')).key,'legacy-key');
 }finally{globalThis.sessionStorage=original;}
});
test('restore needs the protected API to accept the cookie and never writes Web Storage',async()=>{
 const original=globalThis.sessionStorage,mem=memoryStorage();globalThis.sessionStorage=mem.api;
 try{for(const status of [401,503]){const s=server({accountStatus:status});const api=createApi(s.fetcher);
   await assert.rejects(api.restore(),e=>e.status===status);
   const [path,options]=s.calls[0];assert.equal(path,'/api/account');assert.equal(options.headers.Authorization,'Bearer cn-cookie-session');
   await api.catalog().catch(()=>{});assert.equal(s.calls.at(-1)[1].headers.Authorization,undefined,'failed restore must not keep a session');}
  const net=createApi(async()=>{throw TypeError('Failed to fetch')});await assert.rejects(net.restore(),e=>!e.status);
  assert.equal(mem.store.size,0);
 }finally{globalThis.sessionStorage=original;}
});
test('legacy e-mail records: detected, moved only for the proven e-mail, never overwritten or dropped',async()=>{
 const original=globalThis.sessionStorage,store=new Map();
 globalThis.sessionStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),key:i=>[...store.keys()][i]??null,get length(){return store.size}};
 const fetcher=account=>async p=>p.endsWith('/login')?Response.json({token:'cn-cookie-session'}):p==='/api/account'?Response.json({account:{id:account}}):Response.json({});
 try{
  let api=createApi(fetcher('acct-x'));assert.equal(api.hasLegacyJournal(),false);
  store.set('cn.pending.account:acct-z','{"key":"modern"}');store.set('cn.pending.mirror:z@example.test','{"key":"mirror"}');assert.equal(api.hasLegacyJournal(),false,'account and mirror records are not legacy');
  store.set('cn.pending.x@example.test',JSON.stringify({path:'/api/orders',digest:'d',key:'legacy-x'}));assert.equal(api.hasLegacyJournal(),true);
  // A different account signing in must not take X's record.
  api=createApi(fetcher('acct-y'));await api.login('y@example.test','pw');assert(store.has('cn.pending.x@example.test'));assert(!store.has('cn.pending.account:acct-y'));assert.equal(api.hasLegacyJournal(),true);
  // X signs in with a password: the record moves to X's account id.
  api=createApi(fetcher('acct-x'));await api.login('X@Example.test','pw');assert.equal(JSON.parse(store.get('cn.pending.account:acct-x')).key,'legacy-x');assert(!store.has('cn.pending.x@example.test'));assert.equal(api.hasLegacyJournal(),false);
  // If the account slot is already occupied, the legacy record is kept, not dropped.
  store.set('cn.pending.w@example.test','{"key":"legacy-w"}');store.set('cn.pending.account:acct-w','{"key":"current-w"}');
  api=createApi(fetcher('acct-w'));await api.login('w@example.test','pw');assert.equal(JSON.parse(store.get('cn.pending.account:acct-w')).key,'current-w');assert.equal(JSON.parse(store.get('cn.pending.w@example.test')).key,'legacy-w');
 }finally{globalThis.sessionStorage=original;}
});
