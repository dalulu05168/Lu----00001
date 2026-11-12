// Anonymous, read-only browser verification. No customer session or business writes.
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium,devices}=require('playwright');
(async()=>{
 const dir=path.resolve(process.env.CN_DESIGN_EVIDENCE||'artifacts/design-online');fs.mkdirSync(dir,{recursive:true});
 const preview=process.env.CN_DESIGN_PREVIEW,results=[];
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{for(const kind of ['desktop','mobile','admin']){
  const page=await browser.newPage(kind==='mobile'?devices['iPhone 13']:{viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Block even accidental background writes during this production smoke check.
  await page.route('**/*',route=>['GET','HEAD','OPTIONS'].includes(route.request().method())?route.continue():route.abort());
  const origin=preview||('https://'+(kind==='admin'?'admin.maacropierce.com':'nuvexapro.com'));
  await page.goto(origin+(preview&&kind==='admin'?'/login?admin=1':'/'),{waitUntil:'domcontentloaded'});
  await page.locator('#cn-design-system').waitFor({state:'attached'});
  await page.locator('input[type=password]:visible').first().waitFor();
  if(await page.locator('.cn-brand-entry').count())await page.locator('.cn-brand-entry').waitFor({state:'hidden'});
  const styles=await page.evaluate(()=>({font:getComputedStyle(document.body).fontFamily,overflow:document.documentElement.scrollWidth>innerWidth+1,motion:getComputedStyle(document.documentElement).getPropertyValue('--cn-motion-duration').trim(),forms:document.querySelectorAll('input[type=password]').length}));
  assert(styles.font.includes('PingFang SC')&&styles.font.includes('Segoe UI'),kind+' shared font');assert.equal(styles.motion,'180ms');assert(!styles.overflow,kind+' horizontal overflow');assert(styles.forms>0,kind+' anonymous login missing');assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(dir,kind+'.png')});results.push({kind,url:page.url(),...styles,javascriptErrors:0});await page.close();
 }}finally{await browser.close()}
 const report={checkedAt:new Date().toISOString(),passed:true,productionCustomerWrites:false,physicalDeviceVerified:false,authenticatedBusinessFlows:'isolated acceptance only',results};
 fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
