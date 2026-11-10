
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
 await api(admin('listings'),201,master,{...security,itemType:'STOCK',symbol:'NVDA',name:'NVIDIA',tradePin:pin});
 const stock=await api(admin('listings'),201,master,{...security,itemType:'STOCK',symbol:'AAPL',name:'Apple',tradePin:pin});
 const fund=await api(admin('listings'),201,master,{...security,itemType:'FUND',symbol:'SPY',name:'SPY ETF'});
 assert(!Object.hasOwn(stock,'tradePin'));
 await api(admin('listings'),403,agent.token,{id:fund.id,tradePin:nextPin},'PATCH');
 await api(admin('listings'),200,master,{id:fund.id,tradePin:nextPin},'PATCH');
 const buy={market:'US',symbol:'SPY',side:'BUY',quantity:1,limitPriceCents:1300};
 await api('/api/orders',403,client,{...buy,tradePin:pin});
 await api('/api/orders',409,client,{...buy,tradePin:nextPin,limitPriceCents:1200});
 const browser=await chromium.launch({executablePath:process.env.CN_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  for(const symbol of ['AAPL','NVDA','SPY'])for(const quantity of [1,2])await api('/api/orders',201,client,{market:'US',symbol,side:'BUY',quantity,limitPriceCents:1300,tradePin:symbol==='SPY'?nextPin:pin});
 const sellPage=await browser.newPage({viewport:{width:1440,height:900}});
 sellPage.setDefaultTimeout(8000);
 await sellPage.addInitScript(t=>localStorage.setItem('cncap.session',t),client);
 await sellPage.route('**/*',r=>{const u=new URL(r.request().url());return u.origin!==base?r.abort():u.pathname==='/'?r.fulfill({contentType:'text/html',body:pages.desktop}):r.continue()});
 await sellPage.goto(base+'/',{waitUntil:'domcontentloaded'});
 await sellPage.locator('#tb-hold tr[data-s=AAPL]').click();
 await sellPage.locator('#tq').fill('3');
 await sellPage.locator('#tr-next').click();
 await sellPage.locator('#tr-ag').check();
 const [sold]=await Promise.all([sellPage.waitForResponse(r=>r.url().endsWith('/api/orders')&&r.request().method()==='POST'),sellPage.locator('#tr-go').click()]);
 assert.equal(sold.status(),201);
 const confirmation=sellPage.locator('.tr-ok[role=status]');
 await confirmation.getByText('\u5356\u51fa\u5df2\u8bb0\u5f55').waitFor();
 assert.match(await confirmation.innerText(),/AAPL.*3/);
 assert.equal(await confirmation.locator('.check').evaluate(el=>getComputedStyle(el).color),'rgb(79, 221, 143)');
 assert.equal(await confirmation.locator('.check svg').evaluate(el=>getComputedStyle(el).transform),'none');
 await sellPage.locator('#tb-hold tr[data-s=AAPL]').waitFor({state:'detached'});
 await sellPage.unrouteAll({behavior:'ignoreErrors'});await sellPage.close();
 console.log('Desktop sell confirmation and refreshed holdings verified');
 }finally{for(const context of browser.contexts())for(const page of context.pages())await page.unrouteAll({behavior:'ignoreErrors'});await browser.close()}
 console.log('Checking remaining sells');for(const symbol of ['NVDA','SPY'])await api('/api/orders',201,client,{market:'US',symbol,side:'SELL',quantity:3});
 const result=await api(detailPath(a),200,agent.token);
 assert.equal(result.orders.length,9);
 assert.equal(result.account.cashCents,99991);
 assert(!result.positions.some(x=>Number(x.quantity)>0));
 assert.equal(result.orders.filter(o=>o.side==='BUY').length,6);
 assert(result.orders.some(o=>o.symbol==='SPY'&&o.side==='SELL'));
 fs.writeFileSync(path.join(process.env.CN_QA_SAVE_DIR,'results.json'),JSON.stringify({customer:a,subaccount:agent.email,orders:result.orders,positions:result.positions,balance:result.account.cashCents},null,2));
 console.log(JSON.stringify({folder:process.env.CN_QA_SAVE_DIR,orders:result.orders.length,balance:result.account.cashCents}));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
