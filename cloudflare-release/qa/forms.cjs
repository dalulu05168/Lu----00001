
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
  assert.equal(r.status,status,path+' '+JSON.stringify(data.error));return data;
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
 const browser=await chromium.launch({executablePath:process.env.CN_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const records=[];let currentPage;
 const file={name:'identity-fixture.png',mimeType:'image/png',buffer:Buffer.from(image.split(',')[1],'base64')};
 async function open(kind,token,email){
  const p=await browser.newPage(kind==='mobile'?devices['iPhone 13']:{viewport:{width:1440,height:900}});
  p.setDefaultTimeout(9000);currentPage=p;p.on('pageerror',e=>console.log('page error',e.message));
  await p.addInitScript(({token})=>{localStorage.setItem('cncap.session',token);sessionStorage.setItem('cncap.mobile.entry','1')},{token});
  const origin='https://nuvexapro.com';
  await p.route(origin+'/**',async r=>{
   const u=new URL(r.request().url());if(u.pathname==='/'){const source=fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8');const pages=JSON.parse(source.match(/const replacementPages = (.+);/)[1]);return r.fulfill({contentType:'text/html',body:pages[kind]});}
   if(u.pathname.startsWith('/api/')||u.pathname==='/health')return r.fulfill({response:await r.fetch({url:base+u.pathname+u.search})});
   return r.continue();
  });
  await p.goto(origin+'/',{waitUntil:'domcontentloaded'});
  if(kind==='mobile'){
   await p.locator('[name=email]').fill(email);
   await p.locator('[name=password]').fill(password);
   await p.locator('#login-form button').click();
   await p.locator('nav [data-go=mine]').waitFor();
   await p.locator('nav [data-go=mine]').click();
  }else{await p.locator('.tn[data-p=acct]').click();await p.locator('[data-account-section=funds]').click();}
  return p;
 }
 async function submit(p,selector,endpoint,status=201){
  console.log('Submitting',selector,endpoint,status);
  const [r]=await Promise.all([p.waitForResponse(x=>new URL(x.url()).pathname===endpoint&&x.request().method()==='POST',{timeout:12000}),p.locator(selector).click()]);
  assert.equal(r.status(),status);console.log('Received',endpoint,r.status());if(endpoint==='/api/requests'&&status===201){
   const body=r.request().postDataJSON();
   const token=(r.request().headers().authorization||'').replace(/^Bearer /,'');
   const rows=(await api('/api/requests',200,token)).items;
   const item=rows.find(x=>x.kind===body.kind);
   assert(item,'Submitted request not found in customer records');
   return item;
  }
  return {};
 }
 try{
  for(const kind of ['desktop']){
   const email='qa-form-'+kind+'-'+stamp+'@example.test';
   const owner=await createAgent(master,kind,email),token=await login(email),mobile=kind==='mobile';
   console.log(kind,'opening forms');let p=await open(kind,token);
   await p.locator(mobile?'[data-a=sheet][data-v=kyc]':'[data-open=m-id]:visible').first().click();
   await p.locator('#kyc-full-name').fill('客户表单验收');
   console.log(kind,'uploading identity');await p.locator(mobile?'#kf':'#up-f input').setInputFiles(file);
   await p.locator(mobile?'#kb':'#up-b input').setInputFiles(file);
   await submit(p,mobile?'[data-a=ksub]':'#f-id button[type=submit]','/api/profile-documents');
   await p.keyboard.press('Escape');
   await p.locator(mobile?'[data-a=sheet][data-v=bank]':'[data-open=m-bank]:visible').first().click();
   await p.locator(mobile?'#bk1':'#bname').fill('Fixture Bank');
   await p.locator(mobile?'#bk2':'#bno').fill('000000001234');
   await submit(p,mobile?'#bs':'#f-bank button[type=submit]','/api/profile-documents');
   await p.unrouteAll({behavior:'ignoreErrors'});await p.unrouteAll({behavior:'ignoreErrors'});await p.close();
   for(const type of ['IDENTITY','BANK']){
    const review=await api(reviewQuery(email,type),200,owner.token);
    await api(admin('profile-documents'),200,owner.token,{email,kind:type,status:'APPROVED',version:review.version},'PATCH');
   }
   p=await open(kind,token);
   await p.locator(mobile?'[data-a=sheet][data-v=dep]':'[data-open=m-dep]:not([data-wd]):visible').first().click();
   assert.equal(await p.locator(mobile?'#cash-withdraw-pin':'#dpw').isVisible(),false);
   await p.locator(mobile?'#amt':'#damt').fill('500');
   let lostDeposit;
   await p.route('**/api/requests',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    lostDeposit=await(await route.fetch({url:base+'/api/requests'})).json();await route.abort('failed');
   });
   await p.locator('#f-dep button[type=submit]').click();
   await p.waitForFunction(()=>!document.querySelector('#f-dep').dataset.submitting);
   assert(lostDeposit?.id,'Deposit must commit before response loss');await p.unroute('**/api/requests');
   const dep=await submit(p,mobile?'#sb':'#f-dep button[type=submit]','/api/requests');
   assert.equal(dep.id,lostDeposit.id,'Retry must recover the original deposit');
   await p.keyboard.press('Escape');await p.locator('#csbtn').click();
   await p.locator('#cmsg').fill('桌面客服响应恢复验收');let lostMessage;
   await p.route('**/api/support',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    lostMessage=await(await route.fetch({url:base+'/api/support'})).json();await route.abort('failed');
   });
   await p.locator('#f-chat button').click();await p.getByText('发送失败，请重试',{exact:true}).waitFor();
   assert(lostMessage?.id,'Message must commit before response loss');await p.unroute('**/api/support');
   const recovered=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/support'&&r.request().method()==='POST');
   await p.locator('#f-chat button').click();const recoveredMessage=await(await recovered).json();
   assert.equal(recoveredMessage.id,lostMessage.id);assert.equal(recoveredMessage.replayed,true);
   await p.locator('#csx').click();
   console.log(kind,'approving deposit');for(let step=0;step<2;step++)await api(admin('requests'),200,master,{id:dep.id,decision:'APPROVE'});
   await p.unrouteAll({behavior:'ignoreErrors'});await p.unrouteAll({behavior:'ignoreErrors'});await p.close();
   p=await open(kind,token);
   await p.locator(mobile?'[data-a=sheet][data-v=wd]':'[data-open=m-dep]:visible').first().click();if(!mobile)await p.locator('#dtype').selectOption({label:'提现申请'});
   await p.locator('details:has(#cash-set-pin) summary').click();
   await p.locator('#cash-current-password').fill(password);
   await p.locator('#cash-new-pin').fill('472863');
   await submit(p,'#cash-set-pin','/api/withdrawal-pin',200);console.log(kind,'PIN response handled');await p.locator('#cash-pin-result').getByText('提款密码已设置',{exact:true}).waitFor();console.log(kind,'PIN status displayed');
   await p.locator(mobile?'#amt':'#damt').fill('100');
   const pin=p.locator(mobile?'#cash-withdraw-pin':'#dpw');
   await pin.fill('000000');
   await submit(p,mobile?'#sb':'#f-dep button[type=submit]','/api/requests',403);
   await pin.fill('472863');
   const wd=await submit(p,mobile?'#sb':'#f-dep button[type=submit]','/api/requests');
   for(let step=0;step<2;step++)await api(admin('requests'),200,master,{id:wd.id,decision:'APPROVE'});
   const state=await api('/api/account',200,token);assert.equal(state.account.cashCents,40000);
   records.push({kind,email,balance:state.account.cashCents,deposit:dep.id,withdrawal:wd.id});
   await p.unrouteAll({behavior:'ignoreErrors'});await p.unrouteAll({behavior:'ignoreErrors'});await p.close();console.log(kind+' identity/bank forms, deposit without PIN, wrong/correct withdrawal PIN and cash reconciliation passed');
  }
  {
   const email='qa-form-mobile-'+stamp+'@example.test',owner=await createAgent(master,'mobile',email);
   const token=await login(email);let p=await open('mobile',token,email);
   const enter=async name=>{await p.waitForFunction(()=>!document.querySelector('form button:disabled'));await p.locator('nav [data-go=mine]').click();await p.locator('[data-business='+name+']').click();};
   await enter('identity');
   await p.locator('[name=fullName]').fill('客户手机验收');
   await p.locator('[name=front]').setInputFiles(file);await p.locator('[name=back]').setInputFiles(file);
   await submit(p,'form button','/api/profile-documents');await p.getByRole('status').waitFor();
   assert.equal(await p.locator('form').count(),0,'Pending identity must not allow resubmission');
   await enter('bank');
   await p.locator('[name=bankName]').fill('Fixture Bank');await p.locator('[name=accountNumber]').fill('000000001234');
   await submit(p,'form button','/api/profile-documents');await p.getByRole('status').waitFor();
   for(const kind of ['IDENTITY','BANK']){
    const doc=await api(reviewQuery(email,kind),200,owner.token);
    await api(admin('profile-documents'),200,owner.token,{email,kind,status:'APPROVED',version:doc.version},'PATCH');
   }
   for(const name of ['identity','bank']){
    await enter(name);
    await p.getByText('资料已提交并审核通过，如需更改请联系在线客服。',{exact:true}).waitFor();
    assert.equal(await p.locator('form').count(),0,'Approved documents must not allow resubmission');
   }
   await enter('funding');await p.locator('[name=amount]').fill('500');
   // No withdrawal password supplied for a deposit.
   const dep=await submit(p,'form button','/api/requests');await p.getByRole('status').waitFor();
   for(let i=0;i<2;i++)await api(admin('requests'),200,master,{id:dep.id,decision:'APPROVE'});
   await p.locator('[data-business=pin]').click();
   await p.locator('[name=password]').fill(password);await p.locator('[name=pin]').fill('472863');
   await submit(p,'form button','/api/withdrawal-pin',200);await p.getByRole('status').waitFor();
   await enter('funding');await p.locator('[name=kind]').selectOption('WITHDRAW');
   await p.locator('[name=amount]').fill('100');await p.locator('[name=withdrawalPin]').fill('000000');
   await submit(p,'form button','/api/requests',403);await p.getByRole('alert').waitFor();
   await p.locator('[name=kind]').selectOption('WITHDRAW');await p.locator('[name=amount]').fill('501');
   await p.locator('[name=withdrawalPin]').fill('472863');
   const denied=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/requests'&&r.request().method()==='POST');
   await p.locator('form button').click();assert.equal((await denied).ok(),false,'Insufficient cash must reject withdrawal');await p.getByRole('alert').waitFor();
   await p.locator('[name=kind]').selectOption('WITHDRAW');await p.locator('[name=amount]').fill('100');
   await p.locator('[name=withdrawalPin]').fill('472863');
   const wd=await submit(p,'form button','/api/requests');
   for(let i=0;i<2;i++)await api(admin('requests'),200,master,{id:wd.id,decision:'APPROVE'});
   assert.equal((await api('/api/account',200,token)).account.cashCents,40000);
   records.push({kind:'mobile',email,balance:40000,deposit:dep.id,withdrawal:wd.id});
   await p.unrouteAll({behavior:'ignoreErrors'});await p.close();
   console.log('mobile current UI identity/bank lock, deposit without PIN, wrong PIN, insufficient cash and double approval reconciliation passed');
  }
 }finally{for(const context of browser.contexts())for(const page of context.pages())await page.unrouteAll({behavior:'ignoreErrors'});await browser.close()}
 fs.writeFileSync(require('path').join(process.env.CN_QA_SAVE_DIR,'results.json'),JSON.stringify(records,null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1});



