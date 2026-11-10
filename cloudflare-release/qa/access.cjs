
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHmac}=require('node:crypto');
const {chromium,devices}=require('playwright');
const base='http://127.0.0.1:'+(process.env.CN_OPS_QA_PORT||8844);
const password='FixturePass123456!',stamp=Date.now(),a='qa-kele-'+stamp+'@example.test',b='qa-qixi-'+stamp+'@example.test';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=';
function otp(secret){
  const bits=[...secret].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join('');
  const time=Buffer.alloc(8);time.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const sum=createHmac('sha1',Buffer.from(bits.match(/.{8}/g).map(x=>parseInt(x,2)))).update(time).digest();
  return String((sum.readUInt32BE(sum[19]&15)&0x7fffffff)%1000000).padStart(6,'0');
}
async function api(path,status,token,body,method=body?'POST':'GET'){
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...((path==='/api/orders'||path==='/api/product-settlement')&&body?{'idempotency-key':require('node:crypto').randomUUID()}:{})},body:body?JSON.stringify(body):undefined});
  const data=r.status===204?{}:await r.json();
  assert((Array.isArray(status)?status:[status]).includes(r.status),path+' '+r.status+' '+JSON.stringify(data.error));return data;
}
function admin(path){return '/api/admin/'+path}
function reviewQuery(email,kind){return admin('profile-documents?')+new URLSearchParams({email,kind})}
function detailPath(email){return admin('client-view?')+new URLSearchParams({email})}
async function login(email){return (await api('/api/auth/login',200,null,{email,password})).token}
async function createAgent(master,idx,client){
  const email='qa-agent-'+stamp+'-'+idx+'@example.test';
  const account=await api(admin('subaccounts'),201,master,{email,password});
  const credentials={email,password,otp:otp(account.totpSecret)};
  await api(admin('activate'),200,null,credentials);
  const token=(await api(admin('login'),200,null,credentials)).token;
  await api('/api/auth/register',201,null,{email:client,password,inviteCode:account.inviteCode});
  return {token,email};
}

(async()=>{
 const secret=JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE)).totpSecret;
 const master=(await api(admin('login'),200,null,{email:'qa-master@example.test',password,otp:otp(secret)})).token;
 const email='qa-agent-access-'+stamp+'@example.test';
 const item=await api(admin('subaccounts'),201,master,{email,password});
 const credentials={email,password,otp:otp(item.totpSecret)};
 await api(admin('activate'),200,null,credentials);
 const token=(await api(admin('login'),200,null,credentials)).token;
 await api(admin('subaccounts'),403,token,{email:'forbidden-'+email,password});
 await api(admin('listings'),403,token,{market:'US',symbol:'AAPL',name:'Forbidden',status:'PUBLISHED',itemType:'STOCK',tradePin:'123456'});
 await api(admin('subaccounts'),403,token,{email,action:'password',password:'DeniedFixture123!'},'PATCH');
 await api(admin('subaccounts'),200,master,{email,action:'restriction',restricted:true,reason:'Acceptance login restriction'},'PATCH');
 await api(admin('me'),401,token);
 await api(admin('login'),[401,403],null,credentials);
 await api(admin('subaccounts'),200,master,{email,action:'restriction',restricted:false,reason:'Acceptance restore'},'PATCH');
 const fresh=(await api(admin('login'),200,null,credentials)).token;
 await api(admin('subaccounts'),200,master,{email,action:'password',password:'UpdatedFixture123456!'},'PATCH');
 await api(admin('me'),401,fresh);
 await api(admin('login'),[401,403],null,credentials);
 const current=(await api(admin('login'),200,null,{...credentials,password:'UpdatedFixture123456!'})).token;
 await api(admin('me'),200,current);
 const log=(await api(admin('audit'),200,master)).items;
 assert(log.some(x=>x.action==='subaccount.password.reset'&&x.target===email&&x.admin_email==='qa-master@example.test'));
 assert(log.some(x=>x.action==='subaccount.login.restriction'&&x.target===email&&x.detail.restricted===true));
 assert(log.filter(x=>x.target===email).every(x=>!JSON.stringify(x.detail).includes('Fixture')));
 const browser=await chromium.launch({executablePath:process.env.CN_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage();
  page.setDefaultTimeout(20000);page.on('pageerror',e=>console.log('access browser error',e.message));page.on('dialog',async d=>{console.log('access dialog',d.message());await d.dismiss()});
  await page.addInitScript(t=>{localStorage.setItem('cncap.admin.session',t);sessionStorage.setItem('cncap.admin.entry','1')},master);
  const origin='https://admin.maacropierce.com';
  await page.route(origin+'/**',async r=>{const u=new URL(r.request().url());if(u.pathname.startsWith('/api/'))return r.fulfill({response:await r.fetch({url:base+u.pathname+u.search})});return r.continue()});
  await page.goto(origin+'/admin');
  await page.locator('[data-p=cli]').click();
  const row=page.locator('#t-sub tr').filter({hasText:email});
  await row.waitFor();
  await row.locator('[data-sub-client]').click();await page.getByRole('button',{name:'更改密码',exact:true}).click();
  await page.locator('#m-subpass').waitFor();
  await page.locator('#sp-new').fill('BrowserFixture987654!');
  await page.locator('#sp-confirm').fill('BrowserFixture987654!');
  let [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/subaccounts'&&r.request().method()==='PATCH'),page.locator('#sp-save').click()]);
  assert.equal(response.status(),200);
  await page.locator('#m-subpass').waitFor({state:'hidden'});
  await api(admin('me'),401,current);
  await api(admin('login'),200,null,{...credentials,password:'BrowserFixture987654!'});
  await page.getByRole('button',{name:'登录限制',exact:true}).click();
  await page.locator('#m-sublock').waitFor();
  await page.locator('#sublock-state').selectOption({label:'限制登录'});
  await page.locator('#sublock-reason').fill('Browser acceptance restriction');
  [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/subaccounts'&&r.request().method()==='PATCH'),page.locator('#sublock-save').click()]);
  assert.equal(response.status(),200);
  await page.locator('#m-sublock').waitFor({state:'hidden'});
  await api(admin('login'),[401,403],null,{...credentials,password:'BrowserFixture987654!'});
  console.log('Master browser password reset and login restriction buttons passed');
  await page.unrouteAll({behavior:'ignoreErrors'});
 }catch(error){
  const page=browser.contexts()[0]?.pages()[0];
  if(page)console.log('access state',await page.evaluate(()=>({activeModal:[...document.querySelectorAll('.mo.open')].map(x=>x.id),email:document.querySelector('#m-subpass')?.dataset.email,passwordLength:document.querySelector('#sp-new')?.value.length,confirmLength:document.querySelector('#sp-confirm')?.value.length,disabled:document.querySelector('#sp-save')?.disabled,role:document.documentElement.dataset.adminRole})).catch(()=>null));
  throw error;
 }finally{for(const context of browser.contexts())for(const page of context.pages())await page.unrouteAll({behavior:'ignoreErrors'});await browser.close()}
 await api(admin('subaccounts'),200,master,{email,action:'restriction',restricted:false,reason:'Restore for rollback check'},'PATCH');
 const valid=(await api(admin('login'),200,null,{...credentials,password:'BrowserFixture987654!'})).token;
 const marker=require('path').join(process.env.CN_QA_SAVE_DIR,'reject-audit');
 fs.writeFileSync(marker,'isolated failure injection');
 try{
  await api(admin('subaccounts'),[400,500],master,{email,action:'password',password:'MustRollbackFixture123!'},'PATCH');
  await api(admin('me'),200,valid);
  await api(admin('login'),200,null,{...credentials,password:'BrowserFixture987654!'});
 }finally{fs.unlinkSync(marker)}
 console.log('Audit write failure rolled back password and session revocation');
 console.log('Subaccount child creation/listing denial, master password reset, restriction, restoration and token revocation passed');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
