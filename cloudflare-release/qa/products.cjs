
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
const adminPath='/api/admin/product-settlement',clientPath='/api/product-settlement';
(async()=>{
 const {totpSecret}=JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE));
 const master=(await api(admin('login'),200,null,{email:'qa-master@example.test',password,otp:otp(totpSecret)})).token;
 const owner=await createAgent(master,1,a),other=await createAgent(master,2,b);
 const token=await login(a),otherToken=await login(b);
 const adminPost=(status,body)=>api(adminPath,status,master,body);
 const clientPost=(status,body)=>api(clientPath,status,token,body);
 await api(clientPath,401,null);
 await api(adminPath,403,owner.token);
 await api(adminPath,403,other.token,{action:'review-allocation'});
 for(const doc of [{kind:'IDENTITY',front:image,back:image},{kind:'BANK',bankName:'QA Bank',accountNumber:'1234567890'}]){
  await api('/api/profile-documents',201,token,doc);
  const review=await api(reviewQuery(a,doc.kind),200,owner.token);
  await api(admin('profile-documents'),200,owner.token,{email:a,kind:doc.kind,status:'APPROVED',version:review.version},'PATCH');
 }
 const deposit=await api('/api/requests',201,token,{kind:'DEPOSIT',amountCents:100000});
 for(let i=0;i<2;i++)await api(admin('requests'),200,master,{id:deposit.id,decision:'APPROVE'});
 const date='2026-11-09';
 async function create(kind,symbol,price){
  const product=await adminPost(201,{action:'create',kind,symbol,name:symbol});
  const terms=await adminPost(201,{action:'enter-price',product:product.id,date,price});
  assert(!(await api(clientPath,200,token)).catalog.some(x=>x.id===product.id));
  await adminPost(409,{action:'review-price',terms:terms.id,price:'1'});
  await adminPost(200,{action:'review-price',terms:terms.id,price});
  assert((await api(clientPath,200,token)).catalog.some(x=>x.id===product.id));
  return {product:product.id,terms:terms.id};
 }
 const ipo=await create('IPO','QAIPO','10000000');
 const fund=await create('MUTUAL_FUND','QAFUND','12500000');
 const i=await clientPost(201,{...ipo,action:'IPO_SUBSCRIBE',quantity:'10'});
 const account=async()=> (await api('/api/account',200,token)).account.cashCents;
 assert.equal(await account(),90000);
 assert.equal((await api('/api/account',200,token)).totalAssets,1000);
 await adminPost(200,{action:'draft-allocation',order:i.id,shares:'6'});
 await adminPost(409,{action:'review-allocation',order:i.id,shares:'7'});
 await adminPost(200,{action:'review-allocation',order:i.id,shares:'6'});
 await adminPost(200,{action:'review-allocation',order:i.id,shares:'6'});
 assert.equal(await account(),94000);
 assert.equal((await api('/api/account',200,token)).totalAssets,1000);
 await clientPost(201,{...fund,action:'FUND_SUBSCRIBE',amount:'12500'});
 await clientPost(409,{...fund,action:'FUND_REDEEM',quantity:'11000000'});
 await clientPost(201,{...fund,action:'FUND_REDEEM',quantity:'2500000'});
 assert.equal(await account(),84625);
 const assets=await api('/api/account',200,token);assert.equal(assets.totalAssets,1000);assert.equal(assets.account.settlementPositionValueCents,15375);
 const result=await api(clientPath,200,token);
 assert.equal(result.orders.length,3);
 assert.equal(result.positions.find(x=>x.kind==='IPO').quantity_micros,'6000000');
 assert.equal(result.positions.find(x=>x.kind==='MUTUAL_FUND').quantity_micros,'7500000');
 assert.equal(result.positions.find(x=>x.kind==='MUTUAL_FUND').product_id,fund.product,'Each holding must identify its product');
 assert.equal(result.positions.find(x=>x.kind==='IPO').product_id,ipo.product);
 const unrelated=await api(clientPath,200,otherToken);
 assert.deepEqual(unrelated.orders,[]);assert.deepEqual(unrelated.positions,[]);
 const pages=JSON.parse(fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8').match(/const replacementPages = (.+);/)[1]);
 const browser=await chromium.launch({executablePath:process.env.CN_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 async function openPage(kind,session){
  const page=await browser.newPage(kind==='mobile'?devices['iPhone 13']:{viewport:{width:1440,height:900}});
  page.setDefaultTimeout(7000);
  await page.addInitScript(({session,kind})=>{if(top===self){localStorage.setItem(kind==='admin'?'cncap.admin.session':'cncap.session',session);sessionStorage.setItem('cncap.mobile.entry','1');sessionStorage.setItem('cncap.admin.entry','1')}},{session,kind});
  const pages=JSON.parse(fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8').match(/const replacementPages = (.+);/)[1]);
  const origin=kind==='admin'?'https://admin.maacropierce.com':'https://nuvexapro.com';
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
   if(url.pathname.startsWith('/api/')||url.pathname==='/health')return route.fulfill({response:await route.fetch({url:base+url.pathname+url.search})});
   if (route.request().isNavigationRequest() && ['/', '/admin', '/login'].includes(url.pathname)) return route.fulfill({contentType:'text/html; charset=utf-8',body:pages[url.pathname==='/login'?'login':kind]});
   return route.continue();
  });
  await page.goto(origin+(kind==='admin'?'/admin':'/'),{waitUntil:'domcontentloaded'});
  return page;
 }
 async function write(page,form,fields,status=201){
  for(const [name,value] of Object.entries(fields))await form.locator('[name='+name+']').fill(value);
  const [r]=await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('product-settlement')),form.locator('[type=submit]').click()]);
  assert.equal(r.status(),status);return r.json();
 }
 try{
  const desktop=await openPage('desktop',token);
  await desktop.locator('.tn[data-p=trade]').click();await desktop.locator('[data-product-settlement-open]').click();
  const dp=desktop.locator('.ps-dialog');
  const order=await write(desktop,dp.locator('form').filter({hasText:'提交 IPO 申购'}),{quantity:'1'});
  await dp.getByText('待配售',{exact:true}).waitFor();
  await dp.locator('tr').filter({hasText:'QAFUND'}).getByText('7.5',{exact:true}).waitFor();
  await desktop.close();
  const mobile=await openPage('mobile',token);
  await mobile.locator('[name=email]').fill(a);await mobile.locator('[name=password]').fill(password);
  await mobile.locator('#login-form button').click();await mobile.locator('nav [data-go=mine]').click();
  await mobile.locator('[data-business=mutual-funds]').click();
  await mobile.locator('[data-mutual-product="'+fund.product+'"]').click();
  const held=()=>mobile.locator('.data-row').filter({hasText:'持有份额'}).locator('b');
  assert.equal(await held().textContent(),'7.5');
  await mobile.locator('[data-business-form=mutual-redeem] [name=quantity]').fill('0.5');
  const redemption=mobile.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/product-settlement');
  await mobile.locator('[data-business-form=mutual-redeem] button').click();assert.equal((await redemption).status(),201);
  await mobile.getByRole('status').waitFor();
  assert.equal(await held().textContent(),'7');
  await mobile.locator('[data-business-form=mutual-subscribe] [name=amount]').fill('12.50');
  const subscription=mobile.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/product-settlement');
  await mobile.locator('[data-business-form=mutual-subscribe] button:not([disabled])').click();assert.equal((await subscription).status(),201);
  await mobile.getByRole('status').waitFor();
  assert.equal(await held().textContent(),'8');
  await mobile.locator('[data-business-form=mutual-redeem] [name=quantity]').fill('1');
  const secondRedemption=mobile.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/product-settlement');
  await mobile.locator('[data-business-form=mutual-redeem] button:not([disabled])').click();assert.equal((await secondRedemption).status(),201);
  await mobile.getByRole('status').waitFor();
  assert.equal(await held().textContent(),'7');
  await mobile.locator('[data-business=mutual-records]').click();
  await mobile.getByText('7',{exact:true}).waitFor();
  // Issue #56: reload restores the cookie session, so holdings are re-read without signing in again.
  await mobile.reload();await mobile.locator('nav [data-go=mine]').click();
  await mobile.locator('[data-business=mutual-funds]').click();await mobile.locator('[data-mutual-product="'+fund.product+'"]').click();assert.equal(await held().textContent(),'7');
  await mobile.close();
  const delegate=await api('/api/admin/client-action',200,owner.token,{email:a,path:'/api/product-settlement',method:'GET'});
  assert.equal(delegate.positions.find(x=>x.product_id===fund.product).quantity_micros,'7000000');
  const agentPage=await openPage('admin',owner.token);await agentPage.locator('[data-p=cli]').click();
  await agentPage.locator('#t-cli tbody tr').filter({hasText:a}).getByRole('button',{name:'App 镜像',exact:true}).click();
  const frame=agentPage.frameLocator('dialog[open] iframe');await frame.locator('nav [data-go=mine]').click();await frame.locator('[data-business=mutual-funds]').click();await frame.locator('[data-mutual-product="'+fund.product+'"]').click();
  await frame.locator('.data-row').filter({hasText:'持有份额'}).locator('b').filter({hasText:/^7$/}).waitFor();
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   await agentPage.setViewportSize(viewport);
   const close=await agentPage.locator('dialog[open] .ops-heading>button').boundingBox(),body=await agentPage.locator('dialog[open] iframe').boundingBox(),bell=await frame.locator('.notification').boundingBox();
   assert(close.y+close.height<=body.y+1,'Mirror close must stay above customer content');assert(close.x>=0&&close.x+close.width<=viewport.width);assert(body.y+body.height<=viewport.height+1);assert(close.y+close.height<=bell.y,'Close must not cover notification bell');
  }
  await agentPage.screenshot({path:require('path').join(process.env.CN_QA_SAVE_DIR,'mirror-fund-position.png'),fullPage:true});await agentPage.close();
  const back=await openPage('admin',master);
  await back.locator('[data-p=cat]').click();
  await back.locator('[data-p=over]').click();
  const scope=back.locator('#cn-overview-sub');await scope.waitFor();
  assert.equal(await scope.evaluate(el=>getComputedStyle(el).textAlignLast),'center');
  await back.locator('[data-p=cat]').click();
  assert.equal(await back.locator('#cn-listing-add').isVisible(),false);
  await back.locator('[data-product-settlement-open]').click();
  const panel=back.locator('.ps-dialog');
  const row=panel.locator('tr').filter({hasText:a}).filter({hasText:'保存配售'});
  await write(back,row.locator('form'),{shares:'0'},200);
  back.once('dialog',dialog=>dialog.accept());
  await row.getByRole('button',{name:'复核配售'}).click();
  await panel.getByText('复核完成。',{exact:true}).waitFor();
  assert.equal((await api(clientPath,200,token)).orders.find(o=>o.id===order.id).status,'SETTLED');
 }finally{for(const context of browser.contexts())for(const page of context.pages())await page.unrouteAll({behavior:'ignoreErrors'});await browser.close()}
 const resultAfterBrowser=await api(clientPath,200,token);
 assert.equal(await account(),85250);
 const report={customer:a,subaccount:owner.email,cashCents:await account(),orders:resultAfterBrowser.orders,positions:resultAfterBrowser.positions};
 fs.writeFileSync(require('path').join(process.env.CN_QA_SAVE_DIR,'http-results.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({folder:process.env.CN_QA_SAVE_DIR,cashCents:report.cashCents,orders:report.orders.length,positions:report.positions.length}));
})().catch(error=>{console.error(error.stack);process.exitCode=1});

