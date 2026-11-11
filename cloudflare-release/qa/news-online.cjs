// Read-only production smoke check. No production customer is registered or logged in.
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium,devices}=require('playwright');
(async()=>{
 const origin='https://nuvexapro.com',checks=[];
 const response=await fetch(origin+'/api/news',{signal:AbortSignal.timeout(20000)}),feed=await response.json();
 assert.equal(response.status,200);assert.equal(feed.source,'FinVibe');assert(feed.items.length>0);
 const html=await (await fetch(origin+'/')).text();
 const news=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('window.CNNews = {render, open, mountBulletin, mountFeed}'));
 assert(news,'Published desktop response must contain the shared image-card implementation');
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{for(const kind of ['desktop','mobile']){
  const page=await browser.newPage(kind==='mobile'?devices['iPhone 13']:{viewport:{width:1440,height:900}});
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  // Exercise the exact published component against the production public API in an overlay.
  // This is not an authenticated customer-page acceptance test; those flows use isolated QA.
  await page.evaluate(news);
  await page.evaluate(()=>{const shell=document.createElement('div');shell.id='news-readonly-probe';shell.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#f5f7fa;overflow:auto;padding:16px;box-sizing:border-box';const host=document.createElement('section');host.style.cssText='max-width:600px;margin:auto';shell.append(host);document.body.append(shell);CNNews.mountFeed(host)});
  const card=page.locator('#news-readonly-probe .cn-news-card').first();await card.waitFor({timeout:20000});
  await card.locator('img').evaluate(img=>img.loading='eager');
  await page.waitForFunction(()=>document.querySelector('#news-readonly-probe .cn-news-card img')?.naturalWidth>0);
  assert.equal(await card.locator('time').getAttribute('datetime'),feed.items[0].publishedAt);
  assert.equal(await card.locator('a').getAttribute('href'),feed.items[0].url);
  await page.screenshot({path:'artifacts/news-online-'+kind+'.png'});
  checks.push({kind,publishedComponentRendered:true,productionAPI:true,coverLoaded:true,originalDateAndLink:true,authenticatedProductionPageTest:false});
  await page.close();
 }}finally{await browser.close()}
 const published=require('../release-manifest.json');
 const report={version:published.version,sourceSha256:published.sourceSha256,checkedAt:new Date().toISOString(),passed:true,productionCustomerWrites:false,source:feed.source,articleCount:feed.items.length,coverCount:feed.items.filter(x=>x.image?.url).length,latestPublishedAt:feed.items[0].publishedAt,checks};
 fs.writeFileSync('docs/news-cards-online.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.message);process.exitCode=1});
