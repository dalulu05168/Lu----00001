
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
 const master=(await api(admin('login'),200,null,{email:'qa-master@example.test',password,otp:otp(JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE)).totpSecret)})).token;
 const agent=await createAgent(master,1,a),client=await login(a);
 await api('/api/admin/products',403,agent.token);
 await api('/api/products',401);
 for(const doc of [{kind:'IDENTITY',front:image,back:image},{kind:'BANK',bankName:'QA Bank',accountNumber:'1234567890'}]){
 await api('/api/profile-documents',201,client,doc);const review=await api(reviewQuery(a,doc.kind),200,agent.token);await api(admin('profile-documents'),200,agent.token,{email:a,kind:doc.kind,status:'APPROVED',version:review.version},'PATCH');}
 for(let n=0;n<20;n++){const deposit=await api('/api/requests',201,client,{kind:'DEPOSIT',amountCents:5000000});for(let i=0;i<2;i++)await api(admin('requests'),200,master,{id:deposit.id,decision:'APPROVE'});}
 const browser=await chromium.launch({executablePath:process.env.CN_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const errors=[];
 async function page(kind,t){const p=await browser.newPage(kind==='mobile'?devices['iPhone 13']:{viewport:{width:1440,height:1000}});p.setDefaultTimeout(12000);p.on('pageerror',e=>{errors.push(kind+': '+e.message);console.log('ERROR '+kind+' '+e.message)});await p.addInitScript(({t,kind})=>{localStorage.setItem(kind==='admin'?'cncap.admin.session':'cncap.session',t);sessionStorage.setItem('cncap.mobile.entry','1');sessionStorage.setItem('cncap.admin.entry','1')},{t,kind});await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.pathname==='/logo.png')return r.fulfill({contentType:'image/png',body:fs.readFileSync(path.join(__dirname,'../web/logo.png'))});return u.origin!==base?r.abort():['/','/admin'].includes(u.pathname)?r.fulfill({contentType:'text/html',body:pages[kind]}):r.continue()});await p.goto(base+(kind==='admin'?'/admin':'/'),{waitUntil:'commit',timeout:30000});console.log('Opened '+kind);await p.waitForTimeout(1000);console.log('URL '+p.url());return p;}
 try{
 const p=await page('admin',master);await p.locator('[data-p=cat]').click();
 await p.locator('#p-cat .tabs [data-product-settlement-open]').click();await p.locator('.ps-dialog[open]').waitFor();await p.locator('.ps-dialog header').getByRole('button',{name:'关闭',exact:true}).click();
assert.equal(await p.locator('#cn-listing-add').isVisible(),false);await p.locator('[data-cp=create][data-kind=TERM_FUND]').click();await p.locator('#cp-overlay [name=name]').fill('客户期限基金 QA');
 await p.locator('#cp-overlay [name=image]').setInputFiles({name:'fund.png',mimeType:'image/png',buffer:Buffer.from(image.split(',')[1],'base64')});
 await p.locator('[data-add-tier]').click();await p.locator('#cp-overlay [name=principal]').nth(1).fill('100000');await p.locator('#cp-overlay [name=days]').nth(1).fill('15');await p.locator('#cp-overlay [name=profit]').nth(1).fill('2.5');
 let [r]=await Promise.all([p.waitForResponse(r=>r.url().endsWith('/api/admin/products')&&r.request().method()==='POST'),p.locator('#cp-overlay [type=submit]').click()]);assert.equal(r.status(),201);await p.locator('#cp-overlay').waitFor({state:'detached'});
 await p.locator('[data-t=t-com]').click();await p.locator('[data-cp=create][data-kind=BULK_STOCK]').click();await p.locator('#cp-overlay [name=symbol]').fill('AAPL');await p.locator('[data-identify]').click();await p.locator('[data-profile]').filter({hasText:'Apple Inc'}).waitFor();
 await p.locator('#cp-overlay [name=discount]').fill('12');await p.locator('#cp-overlay [name=days]').fill('7');await p.locator('#cp-overlay [name=minimum]').fill('10');await p.locator('#cp-overlay [name=password]').fill('123456');
 [r]=await Promise.all([p.waitForResponse(r=>r.url().endsWith('/api/admin/products')&&r.request().method()==='POST'),p.locator('#cp-overlay [type=submit]').click()]);assert.equal(r.status(),201);await p.locator('#cp-overlay').waitFor({state:'detached'});await p.locator('[data-cp-admin=BULK_STOCK] [data-cp=edit]').waitFor();await p.screenshot({path:path.join(process.env.CN_QA_SAVE_DIR,'admin-products.png'),fullPage:true});
 await p.unrouteAll({behavior:'ignoreErrors'});await p.close();
 for(const kind of ['desktop']){
 const p=await page(kind,client);
 if(kind==='mobile')await p.locator('[data-a=tab][data-v=trade]').click();
 else {await p.locator('header [data-p=trade]').click();await p.locator('#trade-drawer-close').click();}
 await p.locator('#csbtn').click();await p.locator('#cp').evaluate(async el=>{await Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})))});
 const composer=await p.locator('#f-chat').evaluate(el=>{let i=el.querySelector('input'),b=el.querySelector('button'),a=i.getBoundingClientRect(),z=b.getBoundingClientRect();return {background:getComputedStyle(i).backgroundColor,inputHeight:a.height,buttonHeight:z.height,top:a.top-z.top}});
 assert.equal(composer.background,'rgb(245, 248, 252)');assert.equal(composer.inputHeight,44);assert.equal(composer.buttonHeight,44);assert(Math.abs(composer.top)<2);
 await p.screenshot({path:path.join(process.env.CN_QA_SAVE_DIR,'support-composer.png')});
 await p.locator('#cmsg').fill('客户布局验收消息');const sent=p.waitForResponse(r=>r.url().endsWith('/api/support')&&r.request().method()==='POST');await p.locator('#f-chat button').click();assert.equal((await sent).status(),201);await p.locator('#csx').click();
 await p.locator('[data-p=market]').first().click();await p.locator('#p-market [data-kind=STOCK]').click();await p.locator('#market-symbol-select').selectOption('NASDAQ:AAPL');await p.locator('#market-buy').click();await p.locator('#cp-overlay [name=password]').waitFor();await p.locator('#cp-overlay [data-cp-close]').first().click();await p.locator('header [data-p=trade]').click();
 assert.deepEqual(await p.locator(kind==='mobile'?'.trade-tabs [data-a=sec]':'#ptabs button').allTextContents(),['\u5927\u5b97\u4ea4\u6613','\u57fa\u91d1','IPO']);
 await p.locator(kind==='mobile'?'[data-a=sec][data-v=\u57fa\u91d1]':'#ptabs button').filter({hasText:'\u57fa\u91d1'}).click();
 await p.locator('[data-cp=subscribe]').first().click();assert.equal(await p.locator('#cp-overlay input[type=password]').count(),0);
 [r]=await Promise.all([p.waitForResponse(r=>r.url().endsWith('/api/fund-subscriptions')&&r.request().method()==='POST'),p.locator('#cp-overlay [type=submit]').click()]);assert.equal(r.status(),201);await p.locator('#cp-overlay').waitFor({state:'detached'});
 await p.locator(kind==='mobile'?'[data-a=sec][data-v=\u5927\u5b97\u4ea4\u6613]':'#ptabs button:first-child').click();await p.locator('[data-cp=buy]').first().click();await p.locator('#cp-overlay [name=password]').fill('123456');
 [r]=await Promise.all([p.waitForResponse(r=>r.url().endsWith('/api/bulk-orders')&&r.request().method()==='POST'),p.locator('#cp-overlay [type=submit]').click()]);assert.equal(r.status(),201);await p.locator('#cp-overlay').waitFor({state:'detached'});await p.screenshot({path:path.join(process.env.CN_QA_SAVE_DIR,kind+'-products.png'),fullPage:true});
 await p.unrouteAll({behavior:'ignoreErrors'});await p.close();
 }
 const mobile=await page('mobile',client);
 await mobile.locator('[name=email]').fill(a);await mobile.locator('[name=password]').fill(password);await mobile.locator('#login-form button').click();await mobile.locator('nav [data-go=mine]').click();
 await mobile.locator('[data-business=ipo]').click();await mobile.getByRole('heading',{name:'IPO申购',exact:true}).waitFor();
 await mobile.screenshot({path:path.join(process.env.CN_QA_SAVE_DIR,'mobile-ipo.png'),fullPage:true});
 await mobile.locator('nav [data-go=mine]').click();await mobile.locator('[data-business=products]').click();await mobile.locator('[data-product]').filter({hasText:'AAPL'}).click();await mobile.locator('[data-business=bulk-buy]').click();await mobile.locator('[name=tradePassword]').waitFor();
 await mobile.locator('nav [data-go=mine]').click();await mobile.locator('[data-business=support]').click();await mobile.locator('[name=message]').fill('手机客服入口验收');
 const mobileSent=mobile.waitForResponse(r=>r.url().endsWith('/api/support')&&r.request().method()==='POST');await mobile.locator('form button').click();assert.equal((await mobileSent).status(),201);
 await mobile.getByRole('status').waitFor();await mobile.screenshot({path:path.join(process.env.CN_QA_SAVE_DIR,'mobile-support.png'),fullPage:true});
 await mobile.unrouteAll({behavior:'ignoreErrors'});await mobile.close();
 }finally{for(const context of browser.contexts())for(const p of context.pages())await p.unrouteAll({behavior:'ignoreErrors'});await browser.close()}
 const snap=await api('/api/account',200,client);const products=await api('/api/products',200,client);assert.equal(products.contracts.length,1);assert.equal(snap.orders.length,1);assert.equal(snap.account.cashCents,94691390);assert.equal(snap.account.activeFundPrincipalCents,5000000);assert.equal(snap.totalAssets,(94691390+5000000+10*35069)/100);assert.equal(Number(snap.positions.find(x=>x.symbol==='AAPL').quantity),10);
 const product=products.items.find(x=>x.kind==='BULK_STOCK');
 const r=await fetch(base+'/api/bulk-orders',{method:'POST',headers:{Authorization:'Bearer '+client,'Content-Type':'application/json','Idempotency-Key':'locked-sell-check'},body:JSON.stringify({productId:product.id,quantity:1,side:'SELL',expectedVersion:product.version,expectedPriceCents:35069,tradePassword:'123456'})});assert.equal(r.status,409);
 fs.writeFileSync(path.join(process.env.CN_QA_SAVE_DIR,'results.json'),JSON.stringify({snapshot:snap,products,errors},null,2));assert.deepEqual(errors,[]);console.log('Admin IPO entry, uniform products, desktop buy entry and support composer operations passed');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
