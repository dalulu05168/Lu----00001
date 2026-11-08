import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const htmlSource=()=>readFile(new URL('../web/cn-admin.html',import.meta.url),'utf8');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function json(status,body){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});}
async function runScenario({token='authorized-session',role='MASTER',responses={},onRequest}){
 const dom=new JSDOM(await htmlSource(),{url:'https://example.test/cn-admin.html'});
 const old={document:globalThis.document,sessionStorage:globalThis.sessionStorage,location:globalThis.location,fetch:globalThis.fetch};
 const redirects=[],requests=[];
 try{
  globalThis.document=dom.window.document;
  globalThis.sessionStorage=dom.window.sessionStorage;
  globalThis.location={replace:next=>redirects.push(next),assign:next=>redirects.push(next)};
  if(token)dom.window.sessionStorage.setItem('gsp_admin_token',token);
  globalThis.fetch=async(url,options={})=>{
   const entry={url,method:options.method||'GET',body:options.body?JSON.parse(options.body):undefined,authorization:options.headers?.Authorization};
   requests.push(entry);onRequest?.(entry);
   if(responses[url])return responses[url](entry);
   if(url==='/api/admin/me')return json(200,{role,userId:'role-owner'});
   if(url==='/api/admin/clients')return json(200,{items:[{email:'<img src=x onerror=alert(1)>',subadmin_user_id:'sub-1',created_at:'2026-11-08T00:00:00Z'}]});
   if(url==='/api/admin/subaccounts')return json(200,{items:[{email:'sub@example.test',invite_id:'33333333-3333-3333-3333-333333333333',revoked_at:null,twofa_confirmed_at:'2026-11-08T00:00:00Z',uses:0,max_uses:10,expires_at:'2026-12-01T00:00:00Z'}]});
   if(url==='/api/admin/invitations')return entry.method==='PATCH'?json(200,{id:entry.body.inviteId,revoked:true}):json(405,{});
   if(url==='/api/admin/audit')return json(200,{items:[
    {id:'1',action:'ADMIN_LOGIN',actor_user_id:'role-owner',target_id:'role-owner',details:{},created_at:'2026-11-08T00:00:00Z'},
    {id:'2',action:'LISTING_CREATED',actor_user_id:'role-owner',target_id:'11111111-1111-1111-1111-111111111111',details:{symbol:'<script>alert(1)</script>'},created_at:'2026-11-08T00:00:01Z'}
   ]});
   if(url==='/api/admin/listings'){
    if(entry.method==='POST')return json(201,{id:'11111111-1111-1111-1111-111111111111'});
    if(entry.method==='PATCH')return json(200,{id:'11111111-1111-1111-1111-111111111111',status:'PUBLISHED'});
    return json(200,{items:[
      {id:'11111111-1111-1111-1111-111111111111',market:'US',symbol:'AA',name:'Alcoa',itemType:'STOCK',status:'DRAFT'},
      {id:'22222222-2222-2222-2222-222222222222',market:'HK',symbol:'0700',name:'Unsupported',itemType:'STOCK',status:'PUBLISHED'}]});
   }
   return json(404,{error:'Not found'});
  };
  await import('../web/cn-admin-bridge.mjs?scenario='+encodeURIComponent(token+'-'+role+'-'+Math.random()));
  await wait(45);
  return await onResult({dom,redirects,requests});
 }finally{
  globalThis.document=old.document;
  globalThis.sessionStorage=old.sessionStorage;
  globalThis.location=old.location;
  globalThis.fetch=old.fetch;
  dom.window.close();
 }
}
let onResult;
test('admin console refuses access without an existing admin session',async()=>{
 onResult=async({dom,redirects,requests})=>{
  assert.equal(dom.window.document.getElementById('adminVerifiedApp').hidden,true);
  assert.deepEqual(redirects,['/admin.html']);
  assert.equal(requests.length,0);
 };
 await runScenario({token:null});
});
test('admin console refuses invalid or expired 2FA sessions',async()=>{
 onResult=async({dom,redirects,requests})=>{
  assert.equal(dom.window.document.getElementById('adminVerifiedApp').hidden,true);
  assert.equal(dom.window.sessionStorage.getItem('gsp_admin_token'),null);
  assert.deepEqual(redirects,['/admin.html']);
  assert.equal(requests.length,1);
 };
 await runScenario({token:'expired',responses:{'/api/admin/me':()=>json(401,{error:'Expired'})}});
});
test('verified master sees database items, never raw HTML or unsupported markets',async()=>{
 onResult=async({dom,requests,redirects})=>{
  const doc=dom.window.document,app=doc.getElementById('adminVerifiedApp');
  assert.equal(app.hidden,false);
  assert.equal(doc.documentElement.classList.contains('cn-ready'),true);
  assert.equal(doc.getElementById('overviewClientCount').textContent,'1');
  assert.equal(doc.getElementById('overviewSubadminCount').textContent,'1');
  assert.equal(doc.getElementById('overviewListingCount').textContent,'1');
  const client=doc.getElementById('clientsRows');
  assert.match(client.textContent,/<img src=x onerror=alert\(1\)>/);
  assert.equal(client.querySelector('img'),null);
  assert.doesNotMatch(doc.getElementById('listingsRows').textContent,/Unsupported|0700/);
  assert.equal(doc.getElementById('listingCreateSection').hidden,false);
  assert.equal(doc.getElementById('adminAuditNav').hidden,false);
  assert.equal(doc.getElementById('auditRows').children.length,2);
  assert.match(doc.getElementById('auditRows').textContent,/<script>alert\(1\)<\/script>/);
  assert.equal(doc.getElementById('auditRows').querySelector('script'),null);
  assert.equal(doc.getElementById('subadminCreateSection').hidden,false);
  assert.equal(redirects.length,0);
  for(const request of requests)assert.equal(request.authorization,'Bearer authorized-session');
  doc.querySelector('[data-panel="catalog"]').click();
  assert.equal(doc.querySelector('[data-view="catalog"]').hidden,false);
  doc.getElementById('listingsRows').querySelector('button[data-listing-id]').click();
  await wait(30);
  const patch=requests.find(r=>r.method==='PATCH');
  assert.deepEqual(patch.body,{id:'11111111-1111-1111-1111-111111111111',status:'PUBLISHED'});
 };
 await runScenario({});
});

test('verified master creates subadmin and US/CN catalog records through real API handlers',async()=>{
 onResult=async({dom,requests})=>{
  const doc=dom.window.document,sub=doc.getElementById('subadminCreateForm');
  sub.elements.email.value='new-sub@example.test';
  sub.elements.password.value='long-password-secret-2026';
  sub.dispatchEvent(new dom.window.Event('submit',{cancelable:true,bubbles:true}));
  await wait(50);
  const created=requests.find(x=>x.url==='/api/admin/subaccounts'&&x.method==='POST');
  assert.deepEqual(created.body,{email:'new-sub@example.test',password:'long-password-secret-2026'});
  assert.equal(sub.elements.password.value,'');
  assert.equal(doc.getElementById('subadminOnce').hidden,false);
  assert.match(doc.getElementById('subadminOnce').textContent,/123456|otpauth/);
  const listing=doc.getElementById('listingCreateForm');
  listing.elements.market.value='CN';
  listing.elements.symbol.value='600519';
  listing.elements.name.value='贵州茅台';
  listing.elements.itemType.value='STOCK';
  listing.elements.status.value='DRAFT';
  listing.dispatchEvent(new dom.window.Event('submit',{cancelable:true,bubbles:true}));
  await wait(50);
  const saved=requests.find(x=>x.url==='/api/admin/listings'&&x.method==='POST');
  assert.deepEqual(saved.body,{itemType:'STOCK',market:'CN',symbol:'600519',name:'贵州茅台',status:'DRAFT'});
  assert.match(doc.getElementById('listingCreateStatus').textContent,/已保存/);
 };
 await runScenario({
  responses:{'/api/admin/subaccounts':entry=>entry.method==='POST'
   ?json(201,{email:'new-sub@example.test',inviteCode:'123456',totpSecret:'ABCDEF0123456789',setupUri:'otpauth://totp/example'})
   :json(200,{items:[]})}
 });
});

test('master confirms revocation before backend call and subadmin cannot revoke',async()=>{
 onResult=async({dom,requests})=>{
  const doc=dom.window.document;
  const button=doc.querySelector('#subadminsRows button[data-invite-id]');
  assert.ok(button);
  assert.ok(!requests.some(r=>r.url==='/api/admin/invitations'));
  button.click();
  assert.equal(button.textContent,'确认撤销');
  assert.ok(!requests.some(r=>r.url==='/api/admin/invitations'));
  button.click();
  await wait(65);
  const call=requests.find(r=>r.url==='/api/admin/invitations');
  assert.equal(call.method,'PATCH');
  assert.deepEqual(call.body,{inviteId:'33333333-3333-3333-3333-333333333333'});
  assert.match(doc.getElementById('subadminsStatus').textContent,/已撤销/);
 };
 await runScenario({});
 onResult=async({dom,requests})=>{
  assert.equal(dom.window.document.querySelector('#subadminsRows button[data-invite-id]'),null);
  assert.ok(!requests.some(r=>r.url==='/api/admin/invitations'));
 };
 await runScenario({token:'sub-token',role:'SUBADMIN'});
});
test('subadmin cannot create users or publish listings',async()=>{
 onResult=async({dom,requests})=>{
  const doc=dom.window.document;
  assert.equal(doc.getElementById('adminVerifiedApp').hidden,false);
  assert.equal(doc.getElementById('listingCreateSection').hidden,true);
  assert.equal(doc.getElementById('subadminCreateSection').hidden,true);
  assert.equal(doc.getElementById('adminAuditNav').hidden,true);
  assert.equal(doc.getElementById('listingsRows').querySelector('button[data-listing-id]'),null);
  assert.ok(!requests.some(x=>x.url==='/api/admin/audit'));
 };
 await runScenario({token:'sub-token',role:'SUBADMIN'});
});
test('invalidated subresource authorization cannot reveal the admin dashboard',async()=>{
 onResult=async({dom,redirects})=>{
  assert.equal(dom.window.document.getElementById('adminVerifiedApp').hidden,true);
  assert.equal(dom.window.sessionStorage.getItem('gsp_admin_token'),null);
  assert.ok(redirects.includes('/admin.html'));
 };
 await runScenario({token:'partially-expired',responses:{'/api/admin/clients':()=>json(403,{error:'Denied'})}});
});
