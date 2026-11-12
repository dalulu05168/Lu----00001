
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
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
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
const live=process.argv.includes('--live');
const source=fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8');
const logo=Buffer.from(source.match(/const replacementLogo = "([^"]+)";/)[1],'base64');
async function page(browser,kind,token,email){
 const adminPanel=kind==='admin',page=await browser.newPage(kind==='mobile'?devices[process.env.CN_QA_MOBILE_DEVICE||'iPhone 13']:{viewport:{width:1440,height:900}});
 page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log(kind,'page error',e.stack)});
 const origin=live?(adminPanel?'https://admin.maacropierce.com':'https://nuvexapro.com'):'https://qa.test';
 await page.addInitScript(({adminPanel,token,email})=>{if(top!==self)return;
  localStorage.setItem(adminPanel?'cncap.admin.session':'cncap.session',token);
  localStorage.setItem('cncap.user',email);
  sessionStorage.setItem('cncap.mobile.entry','1');
  sessionStorage.setItem('cncap.admin.entry','1');
 },{adminPanel,token,email});
 await page.route(origin+'/**',async route=>{
  const path=new URL(route.request().url());
  if(path.pathname.startsWith('/api/')||path.pathname==='/health'){
    if(!adminPanel&&path.pathname==='/api/notifications'){
      const response=await route.fetch({url:base+path.pathname+path.search});
      const data=await response.json();
      return route.fulfill({response,json:{...data,items:data.items.filter(item=>item.category==='SUPPORT')}});
    }
    return route.fulfill({response:await route.fetch({url:base+path.pathname+path.search})});
  }
  if(process.env.CN_ACCEPTANCE_SOURCE&&['/','/admin'].includes(path.pathname)){const source=fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8');const pages=JSON.parse(source.match(/const replacementPages = (.+);/)[1]);return route.fulfill({contentType:'text/html; charset=utf-8',body:pages[kind]});}
  if(!live&&path.pathname==='/logo.png')return route.fulfill({contentType:'image/png',body:logo});
  if(!live&&['/','/admin'].includes(path.pathname))return route.fulfill({contentType:'text/html',body:fs.readFileSync('nov10-updated-'+kind+'.html')});
  return route.continue();
 });
 await page.goto(origin+(adminPanel?'/admin':''),{waitUntil:'domcontentloaded'});
 return {page,errors};
}
(async()=>{
 const secret=JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE)).totpSecret;
 const master=(await api(admin('login'),200,null,{email:'qa-master@example.test',password,otp:otp(secret)})).token;
 const agentA=await createAgent(master,1,a),agentB=await createAgent(master,2,b);
 const ta=await login(a),tb=await login(b);
 await api(admin('subaccounts'),201,master,{email:'qa-empty-'+stamp+'@example.test',password});
 const identity={kind:'IDENTITY',front:image,back:image,fullName:'林女士'};
 const bank={kind:'BANK',bankName:'QA Bank',accountNumber:'000012345678'};
 for(const data of [identity,bank]){
  await api('/api/profile-documents',201,ta,data);
  assert.equal((await api('/api/profile-documents',409,ta,data)).error,'Document already pending');
  const review=await api(reviewQuery(a,data.kind),200,agentA.token);
  if(data.kind==='IDENTITY')assert.equal(review.document.fullName,'林女士');
  await api(admin('profile-documents'),200,agentA.token,{email:a,kind:data.kind,status:'APPROVED',version:review.version},'PATCH');
  assert.equal((await api('/api/profile-documents',409,ta,data)).error,'Document already approved');
 }
 for(const data of [identity,bank]){
  await api('/api/profile-documents',201,tb,data);
  const review=await api(reviewQuery(b,data.kind),200,agentB.token);
  await api(admin('profile-documents'),200,agentB.token,{email:b,kind:data.kind,status:'APPROVED',version:review.version},'PATCH');
 }
 const verified=await api('/api/profile-documents',200,ta);
 assert.equal(verified.items.find(x=>x.kind==='IDENTITY').verifiedName,'林女士');
 assert(verified.items.every(x=>!x.ciphertext&&!x.name_payload));
 for(const [token,amountCents] of [[ta,3000],[tb,7000]]){
  const deposit=await api('/api/requests',201,token,{kind:'DEPOSIT',amountCents});
  await api(admin('requests'),200,master,{id:deposit.id,decision:'APPROVE',expectedStatus:'PENDING'});
  await api(admin('requests'),200,master,{id:deposit.id,decision:'APPROVE',expectedStatus:'REVIEWED'});
 }
 await api('/api/withdrawal-pin',200,ta,{password,pin:'472863'});
 const withdrawal=await api('/api/requests',201,ta,{kind:'WITHDRAW',amountCents:1000,withdrawalPin:'472863'});
 await api(admin('requests'),200,master,{id:withdrawal.id,decision:'APPROVE',expectedStatus:'PENDING'});
 await api(admin('requests'),200,master,{id:withdrawal.id,decision:'APPROVE',expectedStatus:'REVIEWED'});
 const funding=admin('funding-overview');
 assert.deepEqual((await api(funding,200,master)).items.map(x=>x.email).sort(),[a,a,b].sort());
 assert.deepEqual((await api(funding+'?'+new URLSearchParams({subaccount:agentA.email}),200,master)).items.map(x=>x.email),[a,a]);
 assert.deepEqual((await api(funding,200,agentB.token)).items.map(x=>x.email),[b]);
 await api(funding+'?'+new URLSearchParams({subaccount:agentB.email}),403,agentA.token);
 await api(admin('support'),201,master,{email:a,message:'客户客服回复验收'});
 console.log('API: review lock, verified name, scoped funding and support passed');
 const browser=await chromium.launch({executablePath:process.env.CN_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const [masterUI,subUI,mobileUI,desktopUI]=await Promise.all([page(browser,'admin',master,a),page(browser,'admin',agentA.token,a),page(browser,'mobile',ta,a),page(browser,'desktop',ta,a)]);
  const owner=masterUI.page,sub=subUI.page,m=mobileUI.page,d=desktopUI.page;
  await owner.locator('#stats').getByText('$100.00',{exact:true}).first().waitFor();
  await sub.locator('#stats').getByText('$30.00',{exact:true}).first().waitFor();
  assert.equal(await sub.locator('#cn-overview-sub').isVisible(),false);
  const trend=owner.locator('#p-over canvas#cv'),filter=owner.locator('#cn-overview-sub');
  const tip=owner.locator('#p-over #tip');
  const table=owner.locator('#p-over #tb');
  const trace=()=>trend.evaluate(c=>c.toDataURL());
  await table.getByText(a,{exact:true}).first().waitFor();
  await table.getByText(b,{exact:true}).waitFor();
  const combined=await trace();
  const rect=await trend.boundingBox();
  await trend.hover({position:{x:Math.round(rect.width-31),y:60}});
  await tip.getByText('+100.00',{exact:true}).waitFor();
  await filter.selectOption(agentB.email);
  await owner.locator('#stats').getByText('$70.00',{exact:true}).first().waitFor();
  await table.getByText(b,{exact:true}).waitFor();
  assert.equal(await table.getByText(a,{exact:true}).count(),0);
  assert.notEqual(await trace(),combined);
  await trend.hover({position:{x:Math.round(rect.width-31),y:60}});
  await tip.getByText('+70.00',{exact:true}).waitFor();
  await filter.selectOption('qa-empty-'+stamp+'@example.test');
  await table.getByText('暂无记录',{exact:true}).waitFor();
  await trend.hover({position:{x:Math.round(rect.width-31),y:60}});
  assert.equal(await tip.evaluate(el=>el.classList.contains('on')),false);
  await filter.selectOption(agentA.email);
  await owner.locator('#stats').getByText('$30.00',{exact:true}).first().waitFor();
  await table.getByText(a,{exact:true}).first().waitFor();
  assert.equal(await table.getByText(b,{exact:true}).count(),0);
  await trend.hover({position:{x:Math.round(rect.width-31),y:60}});
  await tip.getByText('+30.00',{exact:true}).waitFor(); await tip.getByText('−10.00',{exact:true}).waitFor();
  await owner.locator('[data-p=appr]').click();
  assert.equal(await owner.locator('#cn-cash-approval').isVisible(),true);
  assert.equal(await owner.locator('#cn-doc-approval').isVisible(),false);
  assert.equal(await owner.locator('button[data-p=fund]').count(),0);
  await owner.keyboard.press('Escape');
  await owner.locator('#p-over').waitFor();
  await owner.locator('[data-p=cli]').click();
  await owner.locator('#t-sub [data-sub-client]').filter({hasText:agentA.email}).click();
  await owner.getByRole('button',{name:'出入金明细',exact:true}).click();
  const ledger=owner.locator('dialog[open] .sub-ledger');
  await ledger.getByText(a,{exact:true}).first().waitFor();
  await ledger.getByText('$30.00',{exact:true}).waitFor();
  assert.equal(await ledger.getByText(b,{exact:true}).count(),0);
  await owner.keyboard.press('Escape');
  const scope=owner.locator('#t-cli');
  await scope.getByRole('heading',{name:agentA.email,exact:true}).waitFor();
  assert.equal(await scope.locator('details[open]').count(),0);
  for(const panel of await scope.locator('details').all()){
   await panel.locator('summary').click();
   assert.equal(await panel.locator('table').isVisible(),true);
   await panel.locator('summary').click();
  }
  await scope.getByRole('button',{name:'返回子账户'}).click();
  await owner.locator('#t-sub [data-sub-client]').filter({hasText:agentA.email}).click();
  const row=owner.locator('#t-cli > table tbody tr').filter({hasText:a});
  await row.waitFor();
  assert.equal(await owner.locator('#t-cli > table tbody tr').filter({hasText:b}).count(),0);
  await row.getByRole('button',{name:'App 镜像'}).click();
  const frame=owner.frameLocator('.ops-phone iframe');
  await frame.locator('.wordmark').waitFor();
  assert.equal(await owner.locator('.ops-device').count(),0);
  await owner.keyboard.press('Escape');
  await owner.locator('.ops-phone').waitFor({state:'hidden'});
  await sub.locator('[data-p=appr]').click();
  await sub.locator('#cn-doc-approval').waitFor();
  assert.equal(await sub.locator('#cn-cash-approval').isVisible(),false);
  await m.locator('#login-form [name=email]').fill(a);
  await m.locator('#login-form [name=password]').fill(password);
  await m.locator('#login-form button').click();
  for(const name of ['home','market','trade','star','mine']){
   await m.locator('nav [data-go='+name+']').click();
   const brand=m.locator('header .cn-brand-logo');
   await brand.waitFor();
   await m.waitForFunction(()=>{const logo=document.querySelector('header .cn-brand-logo');return logo?.complete&&logo.naturalWidth>0});
  }
  await m.locator('.profile strong').getByText('林女士',{exact:true}).waitFor();
  for(const kind of ['identity','bank']){
   await m.locator('.menulink[data-business='+kind+']').click();
   await m.getByText('资料已提交并审核通过，如需更改请联系在线客服。',{exact:true}).waitFor();
   assert.equal(await m.locator('form[data-business-form='+kind+']').count(),0);
   await m.locator('nav [data-go=mine]').click();
  }
  await m.locator('.notification[data-business=notifications]').click();
  await m.locator('[data-notification][data-business=support]').first().click();
  await m.getByText('客户客服回复验收',{exact:true}).waitFor();
  await d.locator('#balchip').click();
  await d.locator('[data-account-section=funds]').click();
  for(const kind of ['m-id','m-bank']){
   await d.locator('#account-funds [data-open='+kind+']').click();
   await d.locator('#'+kind).getByText('已提交并审核通过。如需更改，请联系在线客服。',{exact:true}).waitFor();
   assert.equal(await d.locator('#'+kind+' button[type=submit]:enabled:visible').count(),0);
   await d.keyboard.press('Escape');
  }
  await d.getByRole('button',{name:'消息通知，有未读消息'}).click();
  await d.locator('#cp').getByText('客户客服回复验收').waitFor();
  for(const {errors} of [masterUI,subUI,mobileUI,desktopUI])assert.deepEqual(errors,[]);
  console.log('Chrome: grouped clients, role approvals, linked funding filter, borderless mirror, persistent logo, Esc, approved forms and direct support passed');
 }finally{for(const context of browser.contexts())for(const page of context.pages())await page.unrouteAll({behavior:'ignoreErrors'});await browser.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});

