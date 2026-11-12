const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHmac}=require('node:crypto');
const {chromium,devices}=require('playwright');
const base='http://127.0.0.1:'+process.env.CN_OPS_QA_PORT,password='FixturePass123456!';
const source=fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8'),pages=JSON.parse(source.match(/const replacementPages = (.+);/)[1]);
function otp(secret){const bits=[...secret].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join(''),time=Buffer.alloc(8);time.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac('sha1',Buffer.from(bits.match(/.{8}/g).map(x=>parseInt(x,2)))).update(time).digest();return String((h.readUInt32BE(h[19]&15)&0x7fffffff)%1000000).padStart(6,'0')}
async function api(route,body){const r=await fetch(base+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert(r.ok,route+' '+r.status);return r.json()}
(async()=>{
 const master=JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE));
 await api('/api/admin/login',{email:'qa-master@example.test',password,otp:otp(master.totpSecret)});
 assert.equal((await fetch(base+'/api/news')).headers.get('cache-control'),'public, max-age=60');
 const feed=await api('/api/news');assert(feed.items.length>0,'Real provider must return articles');
 assert.equal((await fetch(base+'/api/news',{method:'POST'})).status,405);
 assert(feed.items.every(x=>x.source==='FinVibe'&&Date.parse(x.publishedAt)<=Date.now()+60000));
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),results=[],errors=[];
 try{
  for(const kind of ['desktop','mobile']){
   const email='qa-'+kind+'@example.test',login=await api('/api/auth/login',{email,password});
   const page=await browser.newPage(kind==='mobile'?devices['iPhone 13']:{viewport:{width:1440,height:1000}});page.setDefaultTimeout(20000);
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(({token,email})=>{if(top!==self)return;localStorage.setItem('cncap.session',token);localStorage.setItem('cncap.user',email);sessionStorage.setItem('cncap.mobile.entry','1')},{token:login.token,email});
   await page.route(base+'/**',route=>{const u=new URL(route.request().url());if(route.request().resourceType()==='document'&&u.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:pages[kind]});if(u.pathname==='/logo.png')return route.fulfill({contentType:'image/png',body:Buffer.from(source.match(/const replacementLogo = "([^"]+)";/)[1],'base64')});return route.continue()});
   await page.goto(base,{waitUntil:'domcontentloaded'});
   if(kind==='mobile'){await page.locator('[name=email]').fill(email);await page.locator('[name=password]').fill(password);await page.locator('#login-form button').click();await page.locator('nav [data-go=market]').click();}
   else await page.locator('[data-market-side=news]').click();
   const host=page.locator(kind==='mobile'?'#mobile-news':'#market-news');
   const first=host.locator('.cn-news-card').first();await first.waitFor();
   await require('./design-contract.cjs')(page,kind+' news',[(kind==='mobile'?'#mobile-news':'#market-news')+' header button'],{touch:kind==='mobile'});
   await first.scrollIntoViewIfNeeded();await first.locator('img').evaluate(img=>img.loading='eager');
   await page.waitForFunction(selector=>{const img=document.querySelector(selector+' .cn-news-card img');return img?.complete&&img.naturalWidth>0},kind==='mobile'?'#mobile-news':'#market-news');
   const link=first.locator('.cn-news-article-link');assert.equal(await link.textContent(),feed.items[0].title);
   assert.equal(await first.locator('time').getAttribute('datetime'),feed.items[0].publishedAt);
   assert(await host.getByText('按原文发布日期排列',{exact:false}).count());
   if(feed.items[0].aiAssisted)assert(await first.getByText('AI 辅助撰写',{exact:true}).count());
   const popupWait=page.waitForEvent('popup');await link.click();const popup=await popupWait;
   await popup.waitForLoadState('domcontentloaded');assert(popup.url().startsWith('https://www.finvibe.blog/blogs/'));await popup.close();
   if(kind==='mobile'){
    await page.evaluate(()=>{document.querySelector('#mobile-news').dataset.retained='yes';window.dispatchEvent(new Event('focus'))});
    await page.waitForTimeout(2000);assert.equal(await host.getAttribute('data-retained'),'yes');
    for(const width of [360,390,412,768]){await page.setViewportSize({width,height:900});assert(await first.evaluate(el=>el.getBoundingClientRect().right<=innerWidth+1));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
    await page.setViewportSize({width:390,height:844});
   }
   await first.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(process.env.CN_QA_SAVE_DIR,kind+'-news.png')});
   // A failed provider request must show a recoverable product state, never fake a news card.
   let failed=true;await page.route(base+'/api/news',route=>failed?route.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'}):route.continue());
   await host.getByRole('button',{name:'刷新新闻',exact:true}).click();await host.getByRole('alert').waitFor();assert.equal(await host.locator('.cn-news-card').count(),0);
   failed=false;await host.getByRole('button',{name:'重新加载',exact:true}).click();await host.locator('.cn-news-card').first().waitFor();
   results.push({kind,realFeed:true,coverLoaded:true,originalDate:true,articleLinkOpened:true,errorRetryPassed:true});await page.close();
  }
 }finally{await browser.close()}
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(process.env.CN_QA_SAVE_DIR,'results.json'),JSON.stringify({passed:true,results,provider:'FinVibe',latestPublishedAt:feed.items[0].publishedAt},null,2));
 console.log('Real editorial covers, original dates, desktop/mobile cards, article navigation, 360/390/412/768px layout and failure recovery passed');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
