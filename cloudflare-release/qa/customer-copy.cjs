// Customer-facing copy: every submit point shows the rights/execution/risk disclosure before the customer can
// submit, and no developer wording (API paths, isolated-environment notes) leaks into customer pages.
// All writes go to the isolated local database. Set CN_COPY_BASELINE=1 to only capture screenshots of an older
// bundle (no assertions) for before/after comparison.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHmac}=require('node:crypto');
const {chromium,devices}=require('playwright');
const base='http://127.0.0.1:'+(process.env.CN_OPS_QA_PORT||8942);
const password='FixturePass123456!',stamp=Date.now(),email='qa-copy-'+stamp+'@example.test',pin='749286';
const baseline=process.env.CN_COPY_BASELINE==='1',dir=process.env.CN_QA_SAVE_DIR||path.join(__dirname,'..','artifacts');
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=';
const pages=JSON.parse(fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8').match(/const replacementPages = (.+);/)[1]);
function otp(secret){const bits=[...secret].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join(''),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const sum=createHmac('sha1',Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)))).update(counter).digest();return String((sum.readUInt32BE(sum[19]&15)&0x7fffffff)%1000000).padStart(6,'0')}
async function api(route,status,token,body,method=body?'POST':'GET'){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(route==='/api/orders'&&body?{'idempotency-key':require('node:crypto').randomUUID()}:{})},body:body?JSON.stringify(body):undefined});const data=r.status===204?{}:await r.json();assert.equal(r.status,status,route+' '+JSON.stringify(data.error||data));return data}
const noLeak=(t,w)=>{if(!baseline)assert(!LEAK.test(t),w+': '+t.slice(0,200))};
const must=(text,...needles)=>{if(baseline)return;for(const n of needles)assert(text.includes(n),'missing "'+n+'" in: '+text.slice(0,300))};
const logoFile=fs.readFileSync(path.join(__dirname,'..','web','logo.png'));
const LEAK=/\/api\/|隔离|接口|服务端|服务器|本地虚构|模拟曲线|原型/;
(async()=>{
 fs.mkdirSync(dir,{recursive:true});
 const master=(await api('/api/admin/login',200,null,{email:'qa-master@example.test',password,otp:otp(JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE)).totpSecret)})).token;
 const agentMail='qa-copy-agent-'+stamp+'@example.test',sub=await api('/api/admin/subaccounts',201,master,{email:agentMail,password}),cred={email:agentMail,password,otp:otp(sub.totpSecret)};
 await api('/api/admin/activate',200,null,cred);const agent=(await api('/api/admin/login',200,null,cred)).token;
 await api('/api/auth/register',201,null,{email,password,inviteCode:sub.inviteCode});const client=(await api('/api/auth/login',200,null,{email,password})).token;
 for(const doc of [{kind:'IDENTITY',fullName:'文案验收客户',front:image,back:image},{kind:'BANK',bankName:'QA Bank',accountNumber:'1234567890'}]){
  await api('/api/profile-documents',201,client,doc);const review=await api('/api/admin/profile-documents?'+new URLSearchParams({email,kind:doc.kind}),200,agent);
  await api('/api/admin/profile-documents',200,agent,{email,kind:doc.kind,status:'APPROVED',version:review.version},'PATCH');
 }
 const deposit=await api('/api/requests',201,client,{kind:'DEPOSIT',amountCents:1000000});for(let n=0;n<2;n++)await api('/api/admin/requests',200,master,{id:deposit.id,decision:'APPROVE',expectedStatus:n===0?'PENDING':'REVIEWED'});
 const listing={market:'US',status:'PUBLISHED',itemType:'STOCK',tradePin:pin};
 await api('/api/admin/listings',201,master,{...listing,symbol:'NVDA',name:'NVIDIA'});await api('/api/admin/listings',201,master,{...listing,symbol:'AAPL',name:'Apple'});
 for(const symbol of ['AAPL','NVDA'])await api('/api/orders',201,client,{market:'US',symbol,side:'BUY',quantity:3,limitPriceCents:1300,tradePin:pin});
 async function settlement(kind,symbol,price){const p=await api('/api/admin/product-settlement',201,master,{action:'create',kind,symbol,name:symbol}),t=await api('/api/admin/product-settlement',201,master,{action:'enter-price',product:p.id,date:new Date().toISOString().slice(0,10),price});await api('/api/admin/product-settlement',200,master,{action:'review-price',terms:t.id,price});return p.id}
 const ipo=await settlement('IPO','COPYIPO','10000000'),fund=await settlement('MUTUAL_FUND','COPYFUND','1250000');
 const term=await api('/api/admin/products',201,master,{kind:'TERM_FUND',name:'文案验收期限基金',status:'PUBLISHED',tiers:[{principalCents:5000,holdingDays:7,profitBps:100}]});
 const bulk=await api('/api/admin/products',201,master,{kind:'BULK_STOCK',name:'Apple 大宗',symbol:'AAPL',market:'US',status:'PUBLISHED',discountBps:1200,holdingDays:7,minQuantity:10,tradePassword:'123456'});
 const browser=await chromium.launch({executablePath:process.env.CN_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const shot=async(page,name)=>page.screenshot({path:path.join(dir,name+'.png'),fullPage:true});
 const results=[];
 try{
  // ---------- desktop ----------
  const d=await browser.newPage({viewport:{width:1440,height:900}});d.setDefaultTimeout(9000);
  await d.addInitScript(t=>localStorage.setItem('cncap.session',t),client);
  await d.route('**/*',r=>{const u=new URL(r.request().url());return u.origin!==base?r.abort():u.pathname==='/logo.png'?r.fulfill({contentType:'image/png',body:logoFile}):u.pathname==='/'?r.fulfill({contentType:'text/html',body:pages.desktop}):r.continue()});
  await d.goto(base+'/',{waitUntil:'domcontentloaded'});
  await d.locator('.tn[data-p=acct]').click();await d.locator('[data-account-section=holdings]').click();await d.locator('#tb-hold tr[data-s=AAPL]').click();
  await d.locator('#tq').fill('2');await d.locator('#tr-next').click();await d.locator('#tr-ag').waitFor();
  must(await d.locator('#m-trade').innerText(),'平台内部记账权益','不向券商或交易所下单','不提供证券托管','以适用的产品条款为准');
  await shot(d,'desktop-sell-preview');results.push('desktop sell preview');
  await d.goto(base+'/',{waitUntil:'domcontentloaded'});
  await d.locator('.tn[data-p=trade]').click();await d.locator('[data-product-settlement-open]').click();
  const dp=d.locator('.ps-dialog');await dp.locator('form').first().waitFor();
  if(!baseline){assert.equal(await dp.locator('.ps-rights').count(),2);must(await dp.innerText(),'不是在交易所或券商处的实际申购','不代表一定获配','不是登记在您名下的基金份额','您可能损失本金');}
  await shot(d,'desktop-ipo-fund-dialog');results.push('desktop IPO and fund dialog');
  await d.keyboard.press('Escape');
  await d.evaluate(()=>window.CNProducts.openBuy('AAPL'));await d.locator('#cp-overlay form').waitFor();
  must(await d.locator('#cp-overlay').innerText(),'平台内部记账权益','不向券商或交易所下单','最低买入 10 股','锁定 7 天');
  await shot(d,'desktop-bulk-buy-dialog');results.push('desktop bulk buy dialog');
  await d.keyboard.press('Escape');
  await d.locator('#ptabs button').filter({hasText:'基金'}).click();await d.locator('[data-cp=subscribe]').first().click();await d.locator('#cp-overlay form').waitFor();
  must(await d.locator('#cp-overlay').innerText(),'不是证券','持有期内本页不提供提前退出功能','以产品条款为准');
  await shot(d,'desktop-term-fund-dialog');results.push('desktop term fund dialog');
  noLeak(await d.locator('body').innerText(),'developer wording on desktop');
  await d.close();
  // ---------- mobile ----------
  const m=await browser.newPage(devices['iPhone 13']);m.setDefaultTimeout(9000);
  await m.route('**/*',route=>{const u=new URL(route.request().url());return u.origin!==base?route.abort():u.pathname==='/logo.png'?route.fulfill({contentType:'image/png',body:logoFile}):u.pathname==='/'?route.fulfill({contentType:'text/html',body:pages.mobile}):route.continue()});
  await m.goto(base+'/',{waitUntil:'domcontentloaded'});
  await m.locator('#login-form [name=email]').fill(email);await m.locator('#login-form [name=password]').fill(password);await m.locator('#login-form button').click();await m.locator('nav [data-go=mine]').waitFor();
  const text=()=>m.locator('main.content').innerText();
  // home / market / detail / trade must be free of developer wording and still show quote time + source
  await shot(m,'mobile-home');noLeak(await text(),'leak on mobile home: ');
  await m.locator('nav [data-go=market]').click();await m.locator('#results .stock').first().waitFor();await shot(m,'mobile-market');noLeak(await text(),'leak on mobile market');
  await m.locator('#results .stock').first().click();await m.locator('.quote-block').waitFor();
  must(await m.locator('.quote-block').innerText(),'报价时间','报价来源');await shot(m,'mobile-detail');noLeak(await text(),'leak on mobile detail');
  await m.locator('nav [data-go=trade]').click();await m.locator('.holding').filter({hasText:'NVDA'}).locator('[data-position]').click();
  await m.locator('form[data-business-form=position-sell]').waitFor();
  must(await text(),'平台内部记账权益','不向券商或交易所下单','持有期未满或已锁定的数量不可卖出','以适用的产品条款为准');
  await shot(m,'mobile-sell');results.push('mobile sell');noLeak(await text(),'leak on mobile sell');
  await m.locator('nav [data-go=mine]').click();await m.locator('[data-business=ipo]').click();await m.locator('[data-ipo-product="'+ipo+'"]').click();await m.locator('[name=quantity]').waitFor();
  must(await text(),'不是在交易所或券商处的实际申购','申购不代表一定获配','按配售结果退回可用资金','配售确认前，预留资金不可用于其他用途');
  await shot(m,'mobile-ipo');results.push('mobile IPO');
  await m.locator('nav [data-go=mine]').click();await m.locator('[data-business=mutual-funds]').click();await m.locator('[data-mutual-product="'+fund+'"]').click();await m.locator('[data-business-form=mutual-subscribe]').waitFor();
  must(await text(),'不是登记在您名下的基金份额','提交后即时结算','您可能损失本金');
  await shot(m,'mobile-mutual-fund');results.push('mobile mutual fund');
  await m.locator('nav [data-go=mine]').click();await m.locator('[data-business=products].menulink').click();await m.locator('[data-product="'+bulk.id+'"]').click();await m.locator('[data-business=bulk-buy]').click();await m.locator('main.content h1').filter({hasText:'买入'}).waitFor();
  must(await text(),'平台内部记账权益','最低买入 10 股','买入后锁定 7 天','价格下跌时您可能损失本金');
  await shot(m,'mobile-bulk-buy');results.push('mobile bulk buy');
  await m.locator('nav [data-go=mine]').click();await m.locator('[data-business=products].menulink').click();await m.locator('[data-product="'+term.id+'"]').click();await m.locator('[data-tier]').first().click();await m.locator('[data-business=subscribe]').waitFor();
  must(await text(),'不是证券','持有期内本页不提供提前退出功能','持有 7 天');
  await shot(m,'mobile-term-fund');results.push('mobile term fund');
  if(!baseline)await m.locator('p.notice').filter({hasText:'客户持有平台内部记账权益'}).waitFor();
  await m.close();
 }finally{await browser.close()}
 fs.writeFileSync(path.join(dir,'customer-copy-results.json'),JSON.stringify({baseline,checked:results},null,2));
 console.log(JSON.stringify({folder:dir,baseline,checked:results}));
})().catch(e=>{console.error(e);process.exit(1)});
