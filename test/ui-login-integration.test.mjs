import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Script } from 'node:vm';

const read=(name)=>readFileSync(new URL('../web/'+name,import.meta.url),'utf8');
const pages=['login.html','index.html','mobile.html','cn-terminal.html','admin.html','cn-admin.html'];

test('all six integrated HTML entrypoints have valid inline JavaScript',()=>{
 for(const name of pages){
  const html=read(name);
  const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  let parsed=0;
  for(const [,attr,code] of scripts){
   if(/\bsrc\s*=/.test(attr)||/\btype\s*=\s*["'](?:text\/plain|application\/json)["']/i.test(attr)||!code.trim())continue;
   assert.doesNotThrow(()=>new Script(code,{filename:name}),name+' inline script '+parsed);
   parsed++;
  }
  assert.ok(parsed>0,name+' must have actual working JavaScript');
 }
});

test('login keeps original design animation, mobile rules and role-specific real auth',()=>{
 const html=read('login.html'),styles=[...html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)].map(m=>m[0]);
 assert.equal(styles[0].length,29470,'original visual CSS must not be rewritten');
 assert.equal(styles[1].length,9299,'original UHD and animation CSS must not be rewritten');
 assert.match(html,/@keyframes pulse/);
 assert.match(html,/@media\(max-width:610px\)/);
 assert.match(html,/\/api\/auth\/login/);
 assert.match(html,/\/api\/admin\/login/);
 assert.match(html,/\/api\/admin\/me/);
 assert.doesNotMatch(html,/state\.role=state\.loginRole/,'old UI-only login bypass forbidden');
 const logo=read('index.html').match(/<img class="cn-shared-mark" src="([^"]+)" alt="CN"/)?.[1];
 assert.ok(logo&&logo.startsWith('data:image/png;base64,'),'shared transparent mark must exist');
 assert.ok(html.includes('src="'+logo+'"'),'login uses same CN image');
 assert.ok(read('admin.html').includes('src="'+logo+'"'),'admin uses same CN image');
});

test('new phone visuals retain the administrator mirror and request/support endpoints',()=>{
 const mobile=read('mobile.html'),admin=read('admin.html'),front=read('index.html');
 assert.match(mobile,/cn-page-topfade/);
 for(const phone of ['mobile.html','cn-terminal.html']){
  const screen=read(phone);
  assert.equal((screen.match(/@media\(max-width:599px\)/g)||[]).length,4,phone+' should fill common modern phone widths');
  assert.doesNotMatch(screen,/@media\(max-width:420px\)/);
 }
 assert.match(mobile,/CN_MIRROR_READY/);
 assert.match(mobile,/\/api\/admin\/mirror\/session/);
 assert.match(mobile,/\/api\/requests/);
 assert.match(mobile,/\/api\/messages/);
 assert.match(admin,/id="p-over"/);
 assert.match(read('admin.html'),/id="p-cli"/);
 assert.match(readFileSync(new URL('../src/admin-http.mjs',import.meta.url),'utf8'),/\/api\/admin\/requests/);
 assert.match(front,/front-modal-premium/);
 assert.doesNotMatch(front,/\.dlg \.ph\{height:48px!important;min-height:48px!important\}/);
 for(const html of [front,admin,mobile]) assert.match(html,/@media\(min-width:7680px\)/);
});

function openWithStub(responder){
 const calls=[];
 const dom=new JSDOM(read('login.html'),{
  url:'https://example.test/login.html',runScripts:'dangerously',pretendToBeVisual:true,
  virtualConsole:new VirtualConsole(),
  beforeParse(window){
   window.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
   window.fetch=(url,options)=>{
    calls.push({url:String(url),options});
    return Promise.resolve(responder(String(url),options));
   };
  }
 });
 const doc=dom.window.document;
 const send=(role)=>{
  if(role)doc.querySelector('[data-login-role="'+role+'"]').click();
  doc.getElementById('loginEmail').value='person@example.test';
  doc.getElementById('loginPassword').value='test-password';
  if(role&&role!=='client')doc.getElementById('loginOtp').value='123456';
  doc.getElementById('loginForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
 };
 return {dom,calls,send};
}
const ok=(body)=>({ok:true,status:200,json:async()=>body});

test('failed real client authentication cannot navigate or persist a session',async()=>{
 const {dom,calls,send}=openWithStub(()=>({ok:false,status:401,json:async()=>({error:'Invalid credentials'})}));
 send('client');
 await new Promise(resolve=>setTimeout(resolve,25));
 assert.deepEqual(calls.map(c=>c.url),['/api/auth/login']);
 assert.equal(dom.window.localStorage.getItem('cncap.session'),null);
 assert.match(dom.window.document.getElementById('loginFeedback').textContent,/错误/);
 assert.equal(dom.window.document.querySelector('#loginForm [type="submit"]').disabled,false);
 dom.window.close();
});

test('successful client authentication verifies account before saving token',async()=>{
 const {dom,calls,send}=openWithStub((url)=>{
  if(url==='/api/auth/login')return ok({token:'verified-client-token-1234567'});
  if(url==='/api/account')return ok({account:{id:'account-1',cashCents:0},positions:[],orders:[]});
  return {ok:false,status:404,json:async()=>({})};
 });
 send('client');
 await new Promise(resolve=>setTimeout(resolve,35));
 assert.deepEqual(calls.map(c=>c.url),['/api/auth/login','/api/account']);
 assert.equal(dom.window.localStorage.getItem('cncap.session'),'verified-client-token-1234567');
 assert.match(dom.window.document.getElementById('loginFeedback').textContent,/身份已验证/);
 dom.window.close();
});

test('administrator TOTP session must match selected role',async()=>{
 const {dom,calls,send}=openWithStub((url,options)=>{
  if(url==='/api/admin/login'){
   const payload=JSON.parse(options.body);
   assert.equal(payload.otp,'123456');
   return ok({token:'verified-admin-token-1234567'});
  }
  if(url==='/api/admin/me')return ok({role:'SUBADMIN',userId:'staff-1'});
  if(url==='/api/auth/logout')return ok({});
  return {ok:false,status:404,json:async()=>({})};
 });
 send('master');
 await new Promise(resolve=>setTimeout(resolve,40));
 assert.deepEqual(calls.map(c=>c.url),['/api/admin/login','/api/admin/me','/api/auth/logout']);
 assert.equal(dom.window.localStorage.getItem('cncap.session'),null);
 assert.match(dom.window.document.getElementById('loginFeedback').textContent,/不匹配/);
 dom.window.close();
});
