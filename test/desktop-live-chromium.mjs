// Chromium evidence for Issue #42; isolated ephemeral HTTP server, NO real users or production APIs.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createApi} from '../src/http-api.mjs';

const screenshots='artifacts/desktop-live-browser';
await mkdir(screenshots,{recursive:true});
const app=createApi({db:{},resolveSession:async()=>null});
await new Promise((resolve,reject)=>app.listen(0,'127.0.0.1',err=>err?reject(err):resolve()));
const base='http://127.0.0.1:'+app.address().port;
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
const apiPaths=[],errors=[];
page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))apiPaths.push(new URL(request.url()).pathname);});
page.on('pageerror',error=>errors.push(error.message));
try{
 const response=await page.goto(base+'/',{waitUntil:'domcontentloaded',timeout:30000});
 assert.equal(response.status(),200,'Live API entry route must serve the customer login');
 await page.locator('#entryForm').waitFor({state:'visible',timeout:15000});
 await page.waitForFunction(()=>document.querySelectorAll('.cn-live-dialog').length===3,{timeout:15000});
 const info=await page.evaluate(()=>{
  const mark=document.querySelector('#entryGate .portal-logo img');
  const style=getComputedStyle(document.querySelector('#entryGate .portal-logo'));
  return {
   title:document.title,
   name:document.querySelector('.portal-name')?.textContent,
   loginVisible:!document.getElementById('entryGate').hidden,
   workspaceHidden:document.getElementById('overview').hidden,
   src:mark?.getAttribute('src'),
   markWidth:Math.round(document.querySelector('#entryGate .portal-logo').getBoundingClientRect().width),
   logoBackground:style.backgroundColor,
   dialogs:document.querySelectorAll('.cn-live-dialog').length,
   originalForms:['fundingRequestForm','identityUploadForm','bankLinkRequestForm'].every(id=>!!document.getElementById(id)),
   appScript:!!document.querySelector('script[src="/app.mjs"]'),
   accountLoaded:document.querySelector('#accountStatus')?.textContent
  };
 });
 assert.match(info.title,/NUVEXA PRO/);
 assert.equal(info.name,'NUVEXA PRO');
 assert.equal(info.src,'/cn-login-logo.svg');
 assert.equal(info.loginVisible,true);
 assert.equal(info.workspaceHidden,true,'An unauthenticated user must NOT see account workspace');
 assert.equal(info.originalForms,true);
 assert.equal(info.dialogs,3,'Modal bridge must preserve all original forms');
 assert.equal(info.appScript,true);
 assert.ok(info.markWidth>70&&info.markWidth<140,'Small silver N logo expected');
 assert.equal(info.logoBackground,'rgba(0, 0, 0, 0)','Transparent, not a pale tile');
 assert.equal(await page.locator('.portal-subtitle,.portal-foot').count(),0);
 await page.screenshot({path:screenshots+'/login-1440.png',fullPage:true});

 // Test the event handler using an intentionally isolated 401 response. This
 // is NOT a real user sign-in and must not be represented as production 2FA.
 await page.route('**/api/auth/login',route=>route.fulfill({
  status:401,contentType:'application/json',body:JSON.stringify({error:'Invalid credentials'})
 }));
 await page.locator('#entryEmail').fill('test-only@example.invalid');
 await page.locator('#entryPassword').fill('not-a-real-password-123');
 await page.locator('#entrySubmit').click();
 await page.waitForFunction(()=>document.getElementById('entryFeedback').textContent.includes('认证失败'),{timeout:10000});
 assert.equal(await page.locator('#overview').isVisible(),false,'Invalid login must not unlock workspace');
 await page.screenshot({path:screenshots+'/invalid-login-1440.png',fullPage:true});

 assert.deepEqual(errors,[],'Browser must not log uncaught JavaScript errors');
 assert.ok(apiPaths.includes('/api/health'),'Client should query real health endpoint');
 assert.ok(apiPaths.includes('/api/ready'),'Client should query readiness');
 assert.ok(apiPaths.includes('/api/auth/login'),'Original login must actually issue POST /api/auth/login');
 assert.ok(!apiPaths.includes('/api/account'),'Unauthorized client must never fetch account without a valid token');
 const evidence={revision:process.env.GITHUB_SHA||'local',environment:'isolated localhost Chromium',previewOnly:true,
  noRealCredentials:true,noRealUserAuthenticated:true,noProductionWrites:true,viewport:'1440x900',info,apiPaths,pageErrors:errors};
 await writeFile(screenshots+'/evidence.json',JSON.stringify(evidence,null,2));
 console.log('PASS Chromium desktop login UI and negative auth, no real user: '+JSON.stringify(evidence));
}finally{
 await browser.close();
 app.closeAllConnections();
 await new Promise((resolve,reject)=>app.close(err=>err?reject(err):resolve()));
}
