import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const pause=ms=>new Promise(done=>setTimeout(done,ms));
test('product settings preserve a configured secret on empty edit and accept zero discount',async()=>{
 const dom=new JSDOM(await readFile(new URL('../web/admin.html',import.meta.url),'utf8'),{url:'https://qa.example/admin.html'});
 const old={document:globalThis.document,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch};
 const id='11111111-1111-4111-8111-111111111111';let saved;
 const terms={tradingEnabled:true,internalPriceCents:10000,discountBps:1000,passwordConfigured:true,termsVersion:1};
 const json=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
 try{
  globalThis.document=dom.window.document;globalThis.sessionStorage=dom.window.sessionStorage;
  globalThis.fetch=async(url,options={})=>{
   if(url==='/api/admin/login')return json({totpRequired:true,pendingToken:'pending-token',expiresAt:new Date(Date.now()+600000).toISOString()});
   if(url==='/api/admin/totp/verify')return json({token:'synthetic-admin',role:'MASTER',expiresAt:new Date(Date.now()+1800000).toISOString()});
   if(url==='/api/admin/me')return json({role:'MASTER',userId:id});
   if(url==='/api/admin/mirror-status')return json({ready:true});
   if(url==='/api/admin/commodities')return json({items:[{id,sku:'TEST',name:'Synthetic product',category:'OTHER',unit:'份额',minimumQuantity:1,indicativePriceCents:null,status:'PUBLISHED'}]});
   if(url.startsWith('/api/admin/product-terms?'))return json({item:terms});
   if(url==='/api/admin/product-terms'&&options.method==='PATCH'){saved=JSON.parse(options.body);return json({item:{...terms,...saved,termsVersion:2}});}
   return json({items:[]});
  };
  await import('../web/admin.mjs?internal-product-settings-test');
  const el=id=>dom.window.document.getElementById(id);
  el('adminEmail').value='synthetic@example.test';el('adminPassword').value='synthetic-password-only';
  el('adminLoginForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await pause(80);
  el('totpCode').value='123456';
  el('adminTotpForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await pause(80);
  dom.window.document.querySelector('[data-admin-page="commodities"]').click();await pause(50);
  [...el('commodityItems').querySelectorAll('button')].find(b=>b.textContent==='折扣与交易设置').click();await pause(50);
  assert.equal(el('productTermsPassword').value,'');assert.equal(el('productTermsPassword').required,false);
  el('productTermsDiscount').value='0';el('productTermsReason').value='Synthetic settings verification with no password replacement';
  el('productTermsForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await pause(50);
  assert.equal(saved.discountBps,0);assert.equal(saved.internalPriceCents,10000);assert.equal(saved.expectedVersion,1);
  assert.equal(Object.hasOwn(saved,'participationPassword'),false);
  assert.match(el('productTermsFeedback').textContent,/已保存/);
  el('productTermsPassword').value='001234';el('productTermsCancel').click();
  assert.equal(el('productTermsPassword').value,'');assert.equal(el('productTermsDialog').open,false);
 }finally{Object.assign(globalThis,old);dom.window.close();}
});
