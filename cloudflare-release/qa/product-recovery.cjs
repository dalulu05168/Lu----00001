const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHmac}=require('node:crypto');
const {chromium,devices}=require('playwright');
const base='http://127.0.0.1:'+process.env.CN_OPS_QA_PORT,password='FixturePass123456!',dir=process.env.CN_QA_SAVE_DIR,email='recovery-client@example.test';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=';
function otp(secret){const bits=[...secret].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join(''),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const sum=createHmac('sha1',Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)))).update(counter).digest();return String((sum.readUInt32BE(sum[19]&15)&0x7fffffff)%1000000).padStart(6,'0')}
async function api(route,status,token,body,method=body?'POST':'GET'){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const data=r.status===204?{}:await r.json();assert.equal(r.status,status,route+' '+JSON.stringify(data));return data}
(async()=>{
 const master=(await api('/api/admin/login',200,null,{email:'qa-master@example.test',password,otp:otp(JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE)).totpSecret)})).token;
 const sub=await api('/api/admin/subaccounts',201,master,{email:'recovery-agent@example.test',password}),credentials={email:'recovery-agent@example.test',password,otp:otp(sub.totpSecret)};
 await api('/api/admin/activate',200,null,credentials);const agent=(await api('/api/admin/login',200,null,credentials)).token;
 await api('/api/auth/register',201,null,{email,password,inviteCode:sub.inviteCode});let client=(await api('/api/auth/login',200,null,{email,password})).token;
 for(const doc of [{kind:'IDENTITY',fullName:'恢复验收客户',front:png,back:png},{kind:'BANK',bankName:'QA Bank',accountNumber:'1234567890'}]){
  await api('/api/profile-documents',201,client,doc);const review=await api('/api/admin/profile-documents?'+new URLSearchParams({email,kind:doc.kind}),200,agent);
  await api('/api/admin/profile-documents',200,agent,{email,kind:doc.kind,status:'APPROVED',version:review.version},'PATCH');
 }
 const deposit=await api('/api/requests',201,client,{kind:'DEPOSIT',amountCents:100000});for(let n=0;n<2;n++)await api('/api/admin/requests',200,master,{id:deposit.id,decision:'APPROVE'});
 async function settlement(kind,symbol,price){const p=await api('/api/admin/product-settlement',201,master,{action:'create',kind,symbol,name:symbol}),t=await api('/api/admin/product-settlement',201,master,{action:'enter-price',product:p.id,date:new Date().toISOString().slice(0,10),price});await api('/api/admin/product-settlement',200,master,{action:'review-price',terms:t.id,price});return p.id}
 const ipo=await settlement('IPO','RETRYIPO','10000000'),fund=await settlement('MUTUAL_FUND','RETRYFUND','1250000');
 const term=await api('/api/admin/products',201,master,{kind:'TERM_FUND',name:'恢复验收期限基金',status:'PUBLISHED',tiers:[{principalCents:5000,holdingDays:7,profitBps:100}]});
 const pages=JSON.parse(fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8').match(/const replacementPages = (.+);/)[1]),browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),checks=[];
 try{
  const p=await browser.newPage(devices['iPhone 13']);p.setDefaultTimeout(12000);let fault=null;
  await p.route(base+'/**',async route=>{const req=route.request(),u=new URL(req.url());if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:pages.mobile});if(u.pathname==='/logo.png')return route.fulfill({contentType:'image/png',body:fs.readFileSync(path.join(__dirname,'../web/logo.png'))});
   if(fault&&u.pathname===fault.path&&req.method()==='POST'){
    const body=req.postDataJSON();if(!fault.action||body.action===fault.action){fault.keys.push(req.headers()['idempotency-key']);
     if(fault.phase===0){const committed=await route.fetch();assert.equal(committed.status(),201);fault.order=await committed.json();fault.phase++;return route.fulfill({status:503,json:{error:'Isolated response lost after commit'}})}
     if(fault.phase===1){const revoked=await fetch(base+'/api/auth/logout',{method:'POST',headers:{...(req.headers().authorization?{Authorization:req.headers().authorization}:{}),...(req.headers().cookie?{Cookie:req.headers().cookie,'X-CN-Session-Mode':'cookie'}:{})}});assert.equal(revoked.status,204);fault.phase++;return route.fulfill({status:401,json:{error:'Session expired'}})}
     const replay=await route.fetch();const data=await replay.json();assert.equal(replay.status(),fault.kind==='TERM'?200:201);assert.equal(data.contract?.id||data.id,fault.order.contract?.id||fault.order.id,'Recovery must return the original committed order');fault.replay=data;fault.phase++;return route.fulfill({response:replay});
    }
   }return route.continue();
  });
  const login=async()=>{await p.locator('[name=email]').fill(email);await p.locator('[name=password]').fill(password);await p.locator('#login-form button').click();await p.locator('nav [data-go=mine]').waitFor()};
  await p.goto(base);await login();
  async function openForm(kind){await p.locator('nav [data-go=mine]').click();
   if(kind==='IPO'){await p.locator('[data-business=ipo].menulink').click();await p.locator('[data-ipo-product="'+ipo+'"]').click();await p.locator('[name=quantity]').fill('3');return p.locator('[data-business-form=ipo] button')}
   if(kind==='TERM'){await p.locator('[data-business=products].menulink').click();await p.locator('[data-product="'+term.id+'"]').click();await p.locator('[data-tier]').first().click();return p.locator('[data-business=subscribe].primary')}
   await p.locator('[data-business=mutual-funds].menulink').click();await p.locator('[data-mutual-product="'+fund+'"]').click();const form=p.locator('[data-business-form=mutual-'+(kind==='REDEEM'?'redeem':'subscribe')+']');await form.locator('input').fill(kind==='REDEEM'?'5':'25');return form.locator('button');
  }
  for(const kind of ['IPO','SUBSCRIBE','REDEEM','TERM']){
   fault={kind,path:kind==='TERM'?'/api/fund-subscriptions':'/api/product-settlement',action:({IPO:'IPO_SUBSCRIBE',SUBSCRIBE:'FUND_SUBSCRIBE',REDEEM:'FUND_REDEEM'})[kind],phase:0,keys:[]};
   let button=await openForm(kind),r=p.waitForResponse(r=>new URL(r.url()).pathname===fault.path&&r.request().method()==='POST');await button.click();assert.equal((await r).status(),503);
   await p.getByRole('alert').first().waitFor();assert.equal(await p.evaluate(e=>!!sessionStorage.getItem('cn.pending.'+e),email),true);
   await p.reload();await login();button=await openForm(kind);r=p.waitForResponse(r=>new URL(r.url()).pathname===fault.path&&r.request().method()==='POST');await button.click();assert.equal((await r).status(),401);await p.locator('#login-form').waitFor();
   assert.equal(await p.evaluate(e=>!!sessionStorage.getItem('cn.pending.'+e),email),true,'Expired login must preserve receipt');
   await login();button=await openForm(kind);r=p.waitForResponse(r=>new URL(r.url()).pathname===fault.path&&r.request().method()==='POST');await button.click();assert.equal((await r).status(),kind==='TERM'?200:201);await p.getByRole('status').waitFor();
   assert.equal(new Set(fault.keys).size,1);assert.equal(fault.keys.length,3);assert.equal(await p.evaluate(e=>sessionStorage.getItem('cn.pending.'+e),email),null);
   checks.push({kind,requests:3,sameKey:true,replayed:true});await p.screenshot({path:path.join(dir,kind+'-recovered.png'),fullPage:true});fault=null;
  }
  client=(await api('/api/auth/login',200,null,{email,password})).token;
  const account=await api('/api/account',200,client),orders=await api('/api/product-settlement',200,client),products=await api('/api/products',200,client);
  assert.equal(orders.orders.length,3);assert.equal(products.contracts.length,1);assert.equal(account.account.cashCents,90125);assert.equal(account.totalAssets,1000);assert.equal(orders.positions.find(x=>x.kind==='MUTUAL_FUND').quantity_micros,'15000000');
  await p.locator('nav [data-go=mine]').click();await p.locator('.compact-grid .panel').filter({hasText:'现金余额'}).getByText('901.25',{exact:true}).waitFor();
  await p.reload();await login();await p.locator('nav [data-go=mine]').click();await p.locator('.compact-grid .panel').filter({hasText:'现金余额'}).getByText('901.25',{exact:true}).waitFor();
  const desktop=await browser.newPage({viewport:{width:1440,height:900}});await desktop.addInitScript(t=>{localStorage.setItem('cncap.session',t)},client);await desktop.route(base+'/**',route=>new URL(route.request().url()).pathname==='/'?route.fulfill({contentType:'text/html',body:pages.desktop}):route.continue());await desktop.goto(base);await desktop.locator('[data-b=cash]').first().filter({hasText:'901.25'}).waitFor();
  await desktop.screenshot({path:path.join(dir,'desktop-same-balance.png'),fullPage:true});
  fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify({checks,cashCents:account.account.cashCents,totalAssets:account.totalAssets,settlementOrders:orders.orders.length,fundContracts:products.contracts.length,fundUnits:'15000000',crossClientBalance:true},null,2));
 }finally{await browser.close()}
 console.log('IPO, fund subscribe/redeem and term fund survive lost response, refresh and expired login without duplicate debit; balances agree');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
