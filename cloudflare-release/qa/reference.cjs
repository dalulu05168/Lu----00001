
const fs=require('node:fs'),assert=require('node:assert/strict'),{createHmac}=require('node:crypto');
const {chromium,devices}=require('playwright');
const base='http://127.0.0.1:'+process.env.CN_OPS_QA_PORT;
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
const pin='749286',nextPin='749287';
const w=fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8');
const pages=JSON.parse(w.match(/const replacementPages = (.+);/)[1]);
(async()=>{
 const master=(await api(admin('login'),200,null,{email:'qa-master@example.test',password,otp:otp(JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE)).totpSecret)})).token;
 const agent=await createAgent(master,1,a);
 const client=await login(a);
 for(const doc of [{kind:'IDENTITY',front:image,back:image},{kind:'BANK',bankName:'QA Bank',accountNumber:'1234567890'}]){
  await api('/api/profile-documents',201,client,doc);
  const review=await api(reviewQuery(a,doc.kind),200,agent.token);
  await api(admin('profile-documents'),200,agent.token,{email:a,kind:doc.kind,status:'APPROVED',version:review.version},'PATCH');
 }
 const deposit=await api('/api/requests',201,client,{kind:'DEPOSIT',amountCents:100000});
 for(let i=0;i<2;i++)await api(admin('requests'),200,master,{id:deposit.id,decision:'APPROVE'});
 const security={market:'US',status:'PUBLISHED'};
 const stock=await api(admin('listings'),201,master,{...security,itemType:'FUND',symbol:'GLD',name:'SPDR Gold Shares',tradePin:pin});
 const fund=await api(admin('listings'),201,master,{...security,itemType:'FUND',symbol:'SLV',name:'iShares Silver Trust'});
 assert(!Object.hasOwn(stock,'tradePin'));
 await api(admin('listings'),403,agent.token,{id:fund.id,tradePin:nextPin},'PATCH');
 await api(admin('listings'),200,master,{id:fund.id,tradePin:nextPin},'PATCH');
 const buy={market:'US',symbol:'SLV',side:'BUY',quantity:1,limitPriceCents:50000};
 await api('/api/orders',403,client,{...buy,tradePin:pin});
 await api('/api/orders',409,client,{...buy,tradePin:nextPin,limitPriceCents:1200});
 const browser=await chromium.launch({executablePath:process.env.CN_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  for(const [kind,symbol,password] of [['desktop','GLD',pin],['mobile','SLV',nextPin]]){
   const p=await browser.newPage(kind==='mobile'?devices['iPhone 13']:{viewport:{width:1440,height:900}});
   p.setDefaultTimeout(6000);p.on("pageerror",e=>console.log(kind,e.message));p.on("request",r=>{if(r.url().endsWith("/api/orders"))console.log(kind,"orders request",r.method())});
   await p.addInitScript(t=>{if(top===self){localStorage.setItem('cncap.session',t);sessionStorage.setItem('cncap.mobile.entry','1')}},client);
   await p.route('**/*',r=>{const url=new URL(r.request().url());return url.origin!==base?r.abort():url.pathname==='/'?r.fulfill({contentType:'text/html',body:pages[kind]}):r.continue()});
   await p.goto(base+'/',{waitUntil:'domcontentloaded',timeout:12000});console.log(kind+' loaded');
   if(kind==='desktop'){
    await p.locator('#ptabs').getByRole('button',{name:'基金',exact:true}).click();await p.locator('[data-buy="'+symbol+'"]').click();
    await p.locator('#tr-next').click();await p.locator('#tr-limit').fill('500');await p.locator('#tr-pw').fill(password);await p.locator('#tr-ag').check();
   }else{
    await p.locator('[data-a=tab][data-v=trade]').click();
    await p.locator('[data-a=sec][data-v=基金]').click();
    await p.locator('[data-a=sym][data-v=SLV]').click();await p.locator('#lp').fill('50');await p.locator('#qty').fill('2');await p.locator('#tb').click();
    await p.locator('[data-a=rk]').click();await p.locator('#tpw').fill(password);
   }
   console.log(kind+' submitting '+symbol);const [response]=await Promise.all([p.waitForResponse(r=>r.url().endsWith('/api/orders')&&r.request().method()==='POST'),p.locator(kind==='desktop'?'#tr-go':'#pl').click()]);
   console.log(kind,"response",response.status());assert.equal(response.status(),201);
   await p.unrouteAll({behavior:'ignoreErrors'});await p.close();
  }
 }finally{for(const context of browser.contexts())for(const page of context.pages())await page.unrouteAll({behavior:'ignoreErrors'});await browser.close()}
 await api(admin('listings'),201,master,{...security,itemType:'FUND',symbol:'USO',name:'United States Oil Fund',tradePin:pin});
 await api('/api/orders',201,client,{...buy,symbol:'USO',tradePin:pin});
 console.log('Checking sells');for(const symbol of ['GLD','SLV','USO'])await api('/api/orders',201,client,{market:'US',symbol,side:'SELL',quantity:1});
 const result=await api(detailPath(a),200,agent.token);
 assert.equal(result.orders.length,6);
 assert.equal(result.orders.filter(o=>o.side==='BUY').length,3);
 assert(result.orders.some(o=>o.symbol==='SLV'&&o.side==='SELL'));
 const records=JSON.parse(fs.readFileSync(process.env.CN_QUOTE_REPORT)).data.results;
 assert.equal(result.account.cashCents,95186);
 for(const row of result.orders){
  const feed=records.find(x=>x.symbol===row.symbol);
  assert.equal(Number(row.price_cents),Math.round(feed.last[1]*100));
 }
 assert.deepEqual(result.positions.filter(p=>Number(p.quantity)>0).map(p=>[p.symbol,Number(p.quantity)]),[['SLV',1]]);
 fs.writeFileSync(path.join(process.env.CN_QA_SAVE_DIR,'results.json'),JSON.stringify({customer:a,subaccount:agent.email,orders:result.orders,positions:result.positions,balance:result.account.cashCents,source:"Eulerpool ETF historical reference",sourceRecords:records.map(r=>({symbol:r.symbol,timestamp:new Date(r.last[0]).toISOString(),price:r.last[1]}))},null,2));
 console.log(JSON.stringify({folder:process.env.CN_QA_SAVE_DIR,orders:result.orders.length,balance:result.account.cashCents}));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
