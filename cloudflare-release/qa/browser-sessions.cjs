const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHmac,createHash}=require('node:crypto');const {chromium,devices}=require('playwright'),{Pool}=require('pg');
const dir=process.env.CN_QA_SAVE_DIR;assert(dir&&process.env.CN_ACCEPTANCE_PG_PORT,'Isolated runner required');const base='http://127.0.0.1:'+process.env.CN_OPS_QA_PORT,password='FixturePass123456!',checks=[];
const db=new Pool({connectionString:'postgresql://postgres@127.0.0.1:'+process.env.CN_ACCEPTANCE_PG_PORT+'/postgres',max:1});
const otp=secret=>{const bits=[...secret].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join(''),time=Buffer.alloc(8);time.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const mac=createHmac('sha1',Buffer.from(bits.match(/.{8}/g).map(x=>parseInt(x,2)))).update(time).digest();return String((mac.readUInt32BE(mac[19]&15)&0x7fffffff)%1000000).padStart(6,'0');};
async function api(route,status,body,headers={},method=body?'POST':'GET'){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});assert.equal(r.status,status,route+' '+await r.clone().text());return {data:r.status===204?null:await r.json(),cookie:r.headers.get('set-cookie')};}
(async()=>{
 const secret=JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE)).totpSecret;
 const master=(await api('/api/admin/login',200,{email:'qa-master@example.test',password,otp:otp(secret)})).data.token;
 const legacyClient=(await api('/api/auth/login',200,{email:'qa-desktop@example.test',password})).data.token;
 assert(legacyClient.length>=32);await api('/api/account',200,null,{Authorization:'Bearer '+legacyClient});
 const login=await api('/api/auth/login',200,{email:'qa-desktop@example.test',password},{'X-CN-Session-Mode':'cookie'});assert.equal(login.data.token,'cn-cookie-session');assert.match(login.cookie,/^__Host-cn-client=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=\d+$/);
 const cookie=login.cookie.split(';')[0],clientSecret=cookie.split('=')[1];assert(!JSON.stringify(login.data).includes(clientSecret));const own=await api('/api/account',200,null,{Cookie:cookie});
 const other=(await api('/api/auth/login',200,{email:'qa-mobile@example.test',password})).data.token;
 const scoped=await api('/api/account',200,null,{Cookie:cookie,Authorization:'Bearer '+other,'X-CN-Session-Mode':'cookie'});assert.equal(scoped.data.account.id,own.data.account.id);
 
 await api('/api/admin/me',401,null,{Cookie:cookie,'X-CN-Session-Mode':'cookie'});
 await api('/api/watchlist',403,{market:'US',symbol:'AAPL'},{Cookie:cookie});
 await api('/api/watchlist',403,{market:'US',symbol:'AAPL'},{Cookie:cookie,'X-CN-Session-Mode':'cookie',Origin:'https://evil.example'});
 await api('/api/watchlist',200,{market:'US',symbol:'AAPL'},{Cookie:cookie,'X-CN-Session-Mode':'cookie',Origin:'https://nuvexapro.com'});
 await api('/api/account',401,null,{Cookie:cookie+'; '+cookie,'X-CN-Session-Mode':'cookie'});
 const out=await api('/api/auth/logout',204,null,{Cookie:cookie,'X-CN-Session-Mode':'cookie'},'POST');assert.match(out.cookie,/Max-Age=0/);await api('/api/account',401,null,{Authorization:'Bearer '+clientSecret});
 const background=await api('/api/auth/login',200,{email:'qa-desktop@example.test',password},{'X-CN-Session-Mode':'cookie'}),bgCookie=background.cookie.split(';')[0];
 const bgClose=await api('/api/auth/logout',204,null,{Cookie:bgCookie,'X-CN-Session-Mode':'cookie','X-CN-Session-Close':'background'},'POST');assert.equal(bgClose.cookie,null);await api('/api/account',401,null,{Cookie:bgCookie});
 checks.push('Cookie attributes, opaque marker response, explicit Bearer compatibility, CSRF custom header and Origin, duplicate-cookie rejection and server logout revocation');
 const a=await api('/api/admin/login',200,{email:'qa-master@example.test',password,otp:otp(secret)},{'X-CN-Session-Mode':'cookie'}),ac=a.cookie.split(';')[0],old=ac.split('=')[1];assert.equal(a.data.token,'cn-cookie-session');
 const oldSession=(await db.query('SELECT expires_at FROM user_sessions WHERE token_hash=$1',[createHash('sha256').update(old).digest('hex')])).rows[0];
 await db.query("UPDATE user_sessions SET admin_verified_at=now()-interval '6 minutes' WHERE token_hash=$1",[createHash('sha256').update(old).digest('hex')]);
 await api('/api/admin/subaccounts',428,{email:'not-created@example.test',password},{Cookie:ac,'X-CN-Session-Mode':'cookie'});
 const reauth=await api('/api/admin/reauth',200,{password,otp:otp(secret)},{Cookie:ac,'X-CN-Session-Mode':'cookie'});assert.equal(reauth.data.token,'cn-cookie-session');const fresh=reauth.cookie.split(';')[0];assert.notEqual(fresh,ac);
 await api('/api/admin/me',401,null,{Cookie:ac});await api('/api/admin/me',200,null,{Cookie:fresh});
 const freshSession=(await db.query('SELECT expires_at FROM user_sessions WHERE token_hash=$1',[createHash('sha256').update(fresh.split('=')[1]).digest('hex')])).rows[0];assert.equal(new Date(freshSession.expires_at).getTime(),new Date(oldSession.expires_at).getTime());
 checks.push('Admin cookie separate from customer, reauthentication rotates token and revokes old token without extending session expiry');
 const pages=JSON.parse(fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8').match(/const replacementPages = (.+);/)[1]);
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
 for(const [kind,options]of [['desktop',{}],['mobile',devices['iPhone 13']],['admin',{}]]){
  const origin=kind==='admin'?'https://admin.maacropierce.com':'https://nuvexapro.com';const p=await browser.newPage(options);p.setDefaultTimeout(15000);
  await p.route(origin+'/**',async route=>{const u=new URL(route.request().url());if(u.pathname.startsWith('/api/'))return route.fulfill({response:await route.fetch({url:base+u.pathname+u.search})});if(u.pathname==='/logo.png')return route.fulfill({contentType:'image/png',body:fs.readFileSync(path.join(__dirname,'../web/logo.png'))});const name=kind==='mobile'?'mobile':kind==='admin'&&u.pathname==='/admin'?'admin':u.pathname==='/login'||kind==='admin'?'login':'desktop';return route.fulfill({contentType:'text/html',body:pages[name]});});
  await p.goto(origin+(kind==='desktop'?'/login':'/'));
  if(kind==='mobile'){await p.locator('[name=email]').fill('qa-mobile@example.test');await p.locator('[name=password]').fill(password);await p.locator('#login-form button').click();await p.locator('nav [data-go=mine]').waitFor();}
  else{await p.locator('#email').fill(kind==='admin'?'qa-master@example.test':'qa-desktop@example.test');await p.locator('#password').fill(password);if(kind==='admin')await p.locator('#otp').fill(otp(secret));await p.locator('#loginBtn').click();if(kind==='admin')await p.locator('[data-p=cli]').waitFor();else await p.locator('[data-market-side=favorites]').waitFor();}
  const cookies=await p.context().cookies(origin),c=cookies.find(c=>c.name===('__Host-cn-'+(kind==='admin'?'admin':'client')));assert(c?.httpOnly&&c.secure&&c.sameSite==='Strict');
  const visible=await p.evaluate(()=>({cookie:document.cookie,local:JSON.stringify(localStorage),session:JSON.stringify(sessionStorage)}));assert(!JSON.stringify(visible).includes(c.value));assert(!visible.cookie.includes('__Host-cn-'));
  if(kind!=='mobile')assert.equal(await p.evaluate(k=>localStorage.getItem(k),kind==='admin'?'cncap.admin.session':'cncap.session'),'cn-cookie-session');
  const state=await p.evaluate(async path=>{const r=await fetch(path);return {status:r.status,data:await r.json()}},kind==='admin'?'/api/admin/me':'/api/account');assert.equal(state.status,200);
  if(kind==='admin'){
   await db.query("UPDATE user_sessions SET admin_verified_at=now()-interval '6 minutes' WHERE token_hash=$1",[createHash('sha256').update(c.value).digest('hex')]);
   await p.evaluate(()=>{window.cnCookieReauth=null;void fetch('/api/admin/subaccounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'cookie-browser-sub@example.test',password:'BrowserFixture987654!'})}).then(r=>window.cnCookieReauth=r.status)});
   const dialog=p.locator('.cn-security-dialog');await dialog.waitFor();await dialog.locator('[name=password]').fill(password);await dialog.locator('[name=otp]').fill(otp(secret));await dialog.locator('[type=submit]').click();await p.waitForFunction(()=>window.cnCookieReauth===201);await api('/api/admin/me',401,null,{Authorization:'Bearer '+c.value});
   const listed=await p.evaluate(async()=>{const r=await fetch('/api/admin/subaccounts');return r.json()});assert(listed.items.some(x=>x.email==='cookie-browser-sub@example.test')); 
  }
  await p.screenshot({path:path.join(dir,kind+'-cookie-session.png'),fullPage:true});
  checks.push(kind+' browser login, actual HttpOnly cookie, inaccessible credential in document.cookie/localStorage/sessionStorage and authenticated data');await p.unrouteAll({behavior:'wait'});await p.close();
 }
 }finally{await browser.close()}
 fs.writeFileSync(path.join(dir,'browser-session-results.json'),JSON.stringify({passed:true,checks,productionWrites:false},null,2));console.log(checks.join('\n'));
})().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(()=>db.end());
