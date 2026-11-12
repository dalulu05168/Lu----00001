

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

  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(path==='/api/orders'&&body?{'idempotency-key':require('node:crypto').randomUUID()}:{})},body:body?JSON.stringify(body):undefined});

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



const path=require('node:path');

const pages=JSON.parse(fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8').match(/const replacementPages = (.+);/)[1]);


(async()=>{
 const master=(await api('/api/admin/login',200,null,{email:'qa-master@example.test',password,otp:otp(JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE)).totpSecret)})).token;
 const owner=await createAgent(master,1,a),client=await login(a);
 for(const doc of [{kind:'IDENTITY',front:image,back:image},{kind:'BANK',bankName:'Notification Bank',accountNumber:'1234567890'}]){
  await api('/api/profile-documents',201,client,doc);const review=await api('/api/admin/profile-documents?'+new URLSearchParams({email:a,kind:doc.kind}),200,owner.token);
  await api('/api/admin/profile-documents',200,owner.token,{email:a,kind:doc.kind,status:'APPROVED',version:review.version},'PATCH');
 }
 const deposit=await api('/api/requests',201,client,{kind:'DEPOSIT',amountCents:100000});for(let i=0;i<2;i++)await api('/api/admin/requests',200,master,{id:deposit.id,decision:'APPROVE',expectedStatus:i===0?'PENDING':'REVIEWED'});
 const fund=await api('/api/admin/products',201,master,{kind:'TERM_FUND',name:'Notification Fund',status:'PUBLISHED',tiers:[{principalCents:10000,holdingDays:1,profitBps:100}]});
 const tier=(await api('/api/products',200,client)).items.find(x=>x.id===fund.id).tiers[0];
 const sub=await fetch(base+'/api/fund-subscriptions',{method:'POST',headers:{Authorization:'Bearer '+client,'Content-Type':'application/json','Idempotency-Key':'notify-fund-contract'},body:JSON.stringify({tierId:tier.id})});assert.equal(sub.status,201);
 const ipo=await api('/api/admin/product-settlement',201,master,{action:'create',kind:'IPO',symbol:'NOTIFYIPO',name:'Notification IPO'});
 const terms=await api('/api/admin/product-settlement',201,master,{action:'enter-price',product:ipo.id,date:new Date().toISOString().slice(0,10),price:'1000000'});
 await api('/api/admin/product-settlement',200,master,{action:'review-price',terms:terms.id,price:'1000000'});
 const r=await fetch(base+'/api/product-settlement',{method:'POST',headers:{Authorization:'Bearer '+client,'Content-Type':'application/json','Idempotency-Key':'notify-ipo-contract'},body:JSON.stringify({action:'IPO_SUBSCRIBE',product:ipo.id,terms:terms.id,quantity:'1'})});assert.equal(r.status,201);const order=await r.json();
 await api('/api/admin/product-settlement',200,master,{action:'draft-allocation',order:order.id,shares:'1'});await api('/api/admin/product-settlement',200,master,{action:'review-allocation',order:order.id,shares:'1'});
 fs.writeFileSync(require('path').join(process.env.CN_QA_SAVE_DIR,'force-maturity'),'1');
 const fault=require('path').join(process.env.CN_QA_SAVE_DIR,'reject-maturity');fs.writeFileSync(fault,'1');await api('/api/products',200,client);fs.unlinkSync(fault);
 assert.equal((await api('/api/admin/fund-settlement',200,master)).items.length,1);
 const pages=JSON.parse(fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8').match(/const replacementPages = (.+);/)[1]);
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const open=async(kind,token)=>{
  const page=await browser.newPage(kind==='mobile'?devices['iPhone 13']:{viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
  await page.addInitScript(({token,kind})=>{localStorage.setItem(kind==='admin'?'cncap.admin.session':'cncap.session',token);sessionStorage.setItem(kind==='admin'?'cncap.admin.entry':'cncap.mobile.entry','1')},{token,kind});
  await page.route('**/*',r=>{const u=new URL(r.request().url());return u.origin!==base?r.abort():u.pathname==='/'?r.fulfill({contentType:'text/html',body:pages[kind]}):r.continue()});
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});
  if(kind==='mobile'){await page.locator('[name=email]').fill(a);await page.locator('[name=password]').fill(password);await page.locator('#login-form button').click();await page.locator('nav [data-go=mine]').waitFor();}
  return page;
 };
 try{
  const admin=await open('admin',master);await admin.getByRole('button',{name:'消息通知，有未读消息'}).click();
  await admin.getByRole('dialog',{name:'到期返还待处理'}).waitFor();
  await admin.locator('[data-cp-retry]').click();await admin.getByText('暂无未完成的返还任务。',{exact:true}).waitFor();
  assert.equal((await api('/api/admin/fund-settlement',200,master)).items.length,0);
  await admin.unrouteAll({behavior:'ignoreErrors'});await admin.close();
  for(const kind of ['desktop','mobile']){
   const p=await open(kind,client);
   if(kind==='mobile'){
    await p.locator('[data-business=notifications].notification').click();
    await p.locator('[data-notification][data-business=fund-records]').filter({hasText:'已到期'}).first().click();
    await p.getByRole('heading',{name:'我的基金合约',exact:true}).waitFor();await p.locator('.tag').filter({hasText:'已到期'}).waitFor();
    await p.locator('[data-business=notifications].notification').click();await p.locator('[data-notification][data-business=ipo-records]').click();
    await p.getByRole('heading',{name:'申购与配售记录',exact:true}).waitFor();await p.getByText('Notification IPO',{exact:true}).first().waitFor();
    await p.screenshot({path:require('path').join(process.env.CN_QA_SAVE_DIR,kind+'-product-notification.png'),fullPage:true});
    await p.unrouteAll({behavior:'ignoreErrors'});await p.close();continue;
   }
   await p.getByRole('button',{name:'消息通知，有未读消息'}).click();
   await p.locator('.cn-notify-row').filter({hasText:'基金到期'}).click();
   await p.locator('.cp-card').filter({hasText:'已返还'}).first().waitFor();
   if(kind==='desktop')assert(await p.locator('#ptabs button.on').filter({hasText:'基金'}).isVisible());
   else assert(await p.locator('[data-a=sec][data-v=基金].on').isVisible());
   if(kind==='desktop')await p.keyboard.press('Escape');await p.getByRole('button',{name:'消息通知',exact:true}).click();
   await p.locator('.cn-notify-row').filter({hasText:'IPO 配售'}).click();
   await p.getByRole('dialog',{name:'IPO 与普通基金'}).waitFor();
   await p.screenshot({path:require('path').join(process.env.CN_QA_SAVE_DIR,kind+'-product-notification.png'),fullPage:true});
   await p.unrouteAll({behavior:'ignoreErrors'});await p.close();
  }
 }finally{for(const c of browser.contexts())for(const p of c.pages())await p.unrouteAll({behavior:'ignoreErrors'});await browser.close()}
 fs.writeFileSync(require('path').join(process.env.CN_QA_SAVE_DIR,'results.json'),JSON.stringify({passed:true,masterFailureBell:true,manualRetry:true,fundNoticeBothClients:true,ipoNoticeBothClients:true},null,2));
 console.log('Master settlement failure bell/retry and desktop/mobile fund maturity and IPO notification navigation passed');
})().catch(e=>{console.error(e.stack);process.exitCode=1});

