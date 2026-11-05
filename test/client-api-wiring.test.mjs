import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {JSDOM} from "jsdom";
const json=(status,body)=>new Response(status===204?null:JSON.stringify(body),{status});
const flush=async()=>{for(let n=0;n<20;n++)await new Promise(resolve=>setImmediate(resolve));};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {resolve,promise}};
async function page(name,run){
 const dom=new JSDOM(await readFile(new URL('../web/index.html',import.meta.url),'utf8'),{url:'https://local.invalid/'});
 const old={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
 const state={token:'customer-A',override:()=>undefined,calls:[]};
 const el=id=>dom.window.document.getElementById(id);
 Object.assign(globalThis,{document:dom.window.document,sessionStorage:dom.window.sessionStorage});
 globalThis.fetch=async(url,options={})=>{
  state.calls.push(url);const result=state.override(url,options);if(result!==undefined)return result;
  if(url==='/api/health')return json(200,{status:'alive',pricingConnected:false});
  if(url==='/api/ready')return json(200,{status:'ready',database:'connected'});
  if(url==='/api/auth/login')return json(200,{token:state.token});
  if(url==='/api/auth/logout')return json(204);
  if(url==='/api/account')return json(200,{account:{id:'account-'+state.token,cashCents:0,currency:'USD'},positions:[],orders:[]});
  if(url==='/api/catalog')return json(200,{items:[{id:'published',itemType:'STOCK',market:'US',symbol:'MSFT',name:'Published Microsoft'}]});
  if(url==='/api/watchlist')return json(200,{items:[]});
  if(url==='/api/requests?category=FUNDING')return json(200,{items:[{id:'request-A',category:'FUNDING',kind:'DEPOSIT',amountCents:1234,status:'UNDER_REVIEW',createdAt:'2026-11-04T00:00:00Z'}]});
  if(url.startsWith('/api/requests?'))return json(200,{items:[]});
  if(url==='/api/commodities')return json(200,{items:[{sku:'GOLD',name:'Published Gold',category:'PRECIOUS_METAL',unit:'oz',minimumQuantity:1,indicativePriceCents:10000}]});
  if(url==='/api/support')return json(200,{thread:{id:'thread',clientId:'customer',status:'OPEN'},messages:[{id:'message',senderUserId:'support',body:'Persisted support reply',createdAt:'2026-11-04T00:00:00Z'}]});
  throw Error('Unexpected API '+url);
 };
 const login=async()=>{el('entryEmail').value='customer@example.test';el('entryPassword').value='local-test-password-2026';el('entryForm').dispatchEvent(new dom.window.Event('submit',{cancelable:true,bubbles:true}));await flush()};
 try{await import(`../web/app.mjs?wiring-${name}`);await flush();await run({dom,el,state,login});}
 finally{Object.assign(globalThis,old);dom.window.close();}
}
test('login synchronizes all existing business modules including previously submitted requests',()=>page('initial',async({el,state,login})=>{
 await login();
 for(const path of ['/api/account','/api/watchlist','/api/catalog','/api/commodities','/api/support',
  '/api/requests?category=FUNDING','/api/requests?category=KYC','/api/requests?category=BANK_LINK'])assert.ok(state.calls.includes(path),path);
 assert.match(el('serviceRequestHistory').textContent,/12\.34 USD/);
 assert.match(el('customerCommodityItems').textContent,/Published Gold/);
 assert.match(el('customerSupportMessages').textContent,/Persisted support reply/);
}));
test('any protected endpoint session expiry clears private client data and restores login',()=>page('expiry',async({el,state,login})=>{
 await login();state.override=url=>url==='/api/support'?json(401,{error:'Authentication required'}):undefined;
 el('refreshCustomerSupport').click();await flush();
 assert.equal(el('entryGate').hidden,false);assert.equal(el('overview').hidden,true);
 assert.equal(sessionStorage.getItem('gsp_token'),null);
 assert.equal(el('customerSupportMessages').textContent,'');
 assert.equal(el('serviceRequestHistory').textContent,'');
}));
test('failed logout still clears the local session and permits a new account login',()=>page('logout',async({el,state,login})=>{
 await login();state.override=url=>url==='/api/auth/logout'?json(503,{error:'unavailable'}):undefined;
 el('logout').click();await flush();
 assert.equal(el('overview').hidden,true);assert.equal(sessionStorage.getItem('gsp_token'),null);
}));
test('late catalog response cannot replace another customer session',()=>page('late',async({el,state,login})=>{
 await login();const pending=deferred();state.override=url=>url==='/api/catalog'?pending.promise:undefined;
 el('refreshCatalogButton').click();await flush();el('logout').click();await flush();
 state.override=()=>undefined;state.token='customer-B';await login();
 pending.resolve(json(200,{items:[{id:'old',itemType:'STOCK',market:'US',symbol:'AAPL',name:'OLD-PRIVATE-CATALOG'}]}));await flush();
 assert.doesNotMatch(el('catalogItems').textContent,/OLD-PRIVATE/);
 assert.match(el('catalogItems').textContent,/Published Microsoft/);
}));
test('an unavailable product catalog does not disable selling an eligible holding',()=>page('sell',async({el,state,login})=>{
 let sale;
 state.override=(url,options)=>{
  if(url==='/api/internal-products')return json(503,{error:'Catalog unavailable'});
  if(url==='/api/internal-purchases'&&options.method==='PATCH'){
   sale=JSON.parse(options.body);
   assert.ok(options.headers['idempotency-key']);
   return json(200,{id:'sale'});
  }
  if(url==='/api/internal-purchases')return json(200,{stockQuotesConfigured:true,positions:[
   {item_type:'STOCK',market:'US',symbol:'AA',code:'AA',name:'Alcoa',quantity:2,unlocked_quantity:2,cost_cents:2000}
  ]});
  if(url==='/api/stock-quote?market=US&symbol=AA')return json(200,{priceCents:1200,timestampMs:Date.now()});
 };
 await login();
 const form=el('positions').querySelector('form[aria-label="AA 股票卖出"]');
 assert.ok(form);
 const submit=form.querySelector('button[type="submit"]');
 assert.equal(submit.disabled,true);
 form.querySelector('button[type="button"]').click();await flush();
 assert.match(form.querySelector('[role="status"]').textContent,/预计到账.*12\.00/);
 assert.equal(submit.disabled,false);
 submit.click();await flush();
 assert.deepEqual(sale,{symbol:'AA',quantity:1,confirmedStockPriceCents:1200});
}));
test('published catalog entry selects the chart while public chart never enables trading',()=>page('chart',async({el,login})=>{
 assert.equal(el('stockChart').querySelector('script'),null);
 await login();
 const open=el('catalogItems').querySelector('button');assert.ok(open,'catalog must offer an instrument selection action');open.click();
 assert.equal(el('symbolTitle').textContent,'MSFT');
 assert.equal(el('symbolName').textContent,'Published Microsoft');
 const chart=el('stockChart').querySelector('script');assert.ok(chart,'official chart must be mounted');
 assert.equal(JSON.parse(chart.textContent).symbol,'NASDAQ:MSFT');
 assert.equal(el('quotePrice').textContent,'—');
 assert.equal(el('orderForm').querySelector('button[type="submit"]').disabled,true);
 el('logout').click();await flush();assert.equal(el('stockChart').querySelector('script'),null);
}));
test('expired request submission does not leave controls disabled for the next session',()=>page('submit-expiry',async({el,state,login})=>{
 await login();state.override=(url,options)=>url.startsWith('/api/requests?')&&options.method==='POST'
  ?json(401,{error:'Authentication required'}):undefined;
 el('startKycRequest').click();await flush();
 assert.equal(el('overview').hidden,true);
 state.override=()=>undefined;state.token='customer-B';await login();
 assert.equal(el('startKycRequest').disabled,false);
}));
test('holdings and transaction names use current published backend metadata',()=>page('names',async({dom,el,state,login})=>{
 state.override=url=>url==='/api/account'?json(200,{
  account:{id:'account-A',cashCents:0,currency:'USD'},positions:[{market:'US',symbol:'MSFT',quantity:'1'}],
  orders:[{id:'order',market:'US',symbol:'MSFT',side:'BUY',quantity:1,price_cents:10000,amount_usd_cents:10000,created_at:'2026-11-04T00:00:00Z'}]
 }):undefined;
 await login();assert.match(el('positions').textContent,/Published Microsoft/);
 const chartLink=el('positions').querySelector('button[aria-label="查看 MSFT 公开走势"]');
 assert.ok(chartLink);
 chartLink.click();
 assert.equal(JSON.parse(el('stockChart').querySelector('script').textContent).symbol,'NASDAQ:MSFT');
 assert.equal(el('internalProductsPanel').querySelector('.trade-holdings-link').getAttribute('href'),'#holdings-section');
 el('transactionSearch').value='Published Microsoft';
 el('transactionSearch').dispatchEvent(new dom.window.Event('input'));
 assert.match(el('transactionRows').textContent,/Published Microsoft/);
}));
test('a previous account submission cannot clear the new account request draft',()=>page('late-submit',async({dom,el,state,login})=>{
 await login();const pending=deferred();let submitted=false;
 state.override=(url,options)=>{
  if(url==='/api/requests?category=FUNDING'&&options.method==='POST'){submitted=true;return json(201,{item:{id:'submitted-A'}})}
  if(url==='/api/requests?category=FUNDING'&&submitted&&options.headers.authorization==='Bearer customer-A')return pending.promise;
 };
 el('fundingRequestAmount').value='12.34';el('fundingRequestForm').dispatchEvent(new dom.window.Event('submit',{cancelable:true,bubbles:true}));await flush();
 el('logout').click();await flush();state.token='customer-B';await login();el('fundingRequestAmount').value='99.99';
 pending.resolve(json(200,{items:[]}));await flush();assert.equal(el('fundingRequestAmount').value,'99.99');
}));
test('previous account support completion cannot overwrite a closed new-account conversation',()=>page('late-support',async({dom,el,state,login})=>{
 await login();const pending=deferred();
 state.override=(url,options)=>{
  if(url!=='/api/support')return;
  if(options.method==='POST')return json(201,{message:{id:'message-A'}});
  if(options.headers.authorization==='Bearer customer-A')return pending.promise;
  return json(200,{thread:{id:'closed-B',clientId:'B',status:'CLOSED'},messages:[]});
 };
 el('customerSupportText').value='Message from A';el('customerSupportForm').dispatchEvent(new dom.window.Event('submit',{cancelable:true,bubbles:true}));await flush();
 el('logout').click();await flush();state.token='customer-B';await login();
 pending.resolve(json(200,{thread:{id:'A',clientId:'A',status:'OPEN'},messages:[]}));await flush();
 assert.match(el('customerSupportStatus').textContent,/已关闭/);
 assert.equal(el('customerSupportForm').querySelector('button[type="submit"]').disabled,true);
}));
test('support refresh keeps send disabled if the conversation closes during submission',()=>page('support-closed',async({dom,el,state,login})=>{
 await login();state.override=(url,options)=>url==='/api/support'?(options.method==='POST'
  ?json(201,{message:{id:'sent'}}):json(200,{thread:{id:'closed',clientId:'customer',status:'CLOSED'},messages:[]})):undefined;
 el('customerSupportText').value='Local test question';el('customerSupportForm').dispatchEvent(new dom.window.Event('submit',{cancelable:true,bubbles:true}));await flush();
 assert.equal(el('customerSupportForm').querySelector('button[type="submit"]').disabled,true);
 assert.match(el('customerSupportStatus').textContent,/已关闭/);
}));
