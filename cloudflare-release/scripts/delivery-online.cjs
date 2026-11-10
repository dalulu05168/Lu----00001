
const fs=require('fs'),assert=require('assert/strict'),{chromium,devices}=require('playwright');
(async()=>{
const dir=fs.mkdtempSync(require('path').resolve('artifacts/delivery-online-')),results=[];
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{for(const kind of ['desktop','mobile','admin']){
const p=await browser.newPage(kind==='mobile'?devices['iPhone 13']:{viewport:{width:1440,height:900}});
const url=kind==='admin'?'https://admin.maacropierce.com/':'https://nuvexapro.com/';
const r=await p.goto(url,{waitUntil:'domcontentloaded'});assert.equal(r.status(),200);
await p.locator('input[type=password]').first().waitFor();
await p.waitForFunction(()=>[...document.images].some(i=>i.naturalWidth>0));
const icon=await p.locator('link[rel=icon]').first().getAttribute('href');
results.push({kind,url:p.url(),status:r.status(),logoLoaded:true,icon});
await p.screenshot({path:require('path').join(dir,kind+'.png'),fullPage:true});await p.close();
}}finally{await browser.close()}
assert.equal(new Set(results.map(x=>x.icon)).size,1);
for(const origin of ['https://nuvexapro.com','https://admin.maacropierce.com']){
assert.equal((await (await fetch(origin+'/ready')).json()).database,'connected');
for(const [route,method] of [['/api/account','GET'],['/api/products','GET'],['/api/bulk-orders','POST'],['/api/admin/clients','GET'],['/api/admin/requests','GET'],['/api/admin/client-action','POST'],['/api/admin/fund-settlement','GET']]){const status=(await fetch(origin+route,{method})).status;const crossHost=origin==='https://nuvexapro.com'&&route.startsWith('/api/admin/');assert(crossHost?[401,404].includes(status):status===401,origin+route+' '+status);}
}
fs.writeFileSync(require('path').join(dir,'results.json'),JSON.stringify({passed:true,version:require('../release-manifest.json').version,results},null,2));console.log(JSON.stringify({passed:true,evidence:dir,version:require('../release-manifest.json').version}));
})().catch(e=>{console.error(e.stack);process.exitCode=1});

