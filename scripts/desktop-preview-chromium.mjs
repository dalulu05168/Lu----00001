// Issue #42: actual Chromium QA of the separate desktop-only Render-style UI.
// Uses an ephemeral localhost static server. Never sends credentials or writes to a production API.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {chromium} from 'playwright';

const root=resolve('web');
const artifacts='artifacts/desktop-static-preview';
const apis=[],pageErrors=[];
const contentType=file=>file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html';
const server=createServer(async(req,res)=>{
 const url=new URL(req.url||'/', 'http://localhost');
 if(url.pathname.startsWith('/api/')){
  apis.push({method:req.method,path:url.pathname});
  res.writeHead(418,{'content-type':'application/json'});res.end(JSON.stringify({error:'Static preview must not contact account API'}));return;
 }
 const pathname=url.pathname==='/'?'/desktop.html':url.pathname;
 const file=resolve(root,'.'+pathname);
 if(!file.startsWith(root+sep)){
  res.writeHead(403);res.end();return;
 }
 try{
  const bytes=await readFile(file);
  res.writeHead(200,{'content-type':contentType(file),'cache-control':'no-store'});
  res.end(bytes);
 }catch{
  res.writeHead(404);res.end('Not found');
 }
});
await mkdir(artifacts,{recursive:true});
await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',err=>err?reject(err):resolve()));
const base='http://127.0.0.1:'+server.address().port+'/desktop.html?preview=1';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const desktop=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
 desktop.on('pageerror',error=>pageErrors.push(error.message));
 const response=await desktop.goto(base,{waitUntil:'domcontentloaded',timeout:30000});
 assert.equal(response.status(),200);
 await desktop.locator('html.cn-ready').waitFor({state:'attached',timeout:15000});
 await desktop.waitForFunction(()=>document.getElementById('tb-ord')?.textContent.includes('账户交易数据未连接'),null,{timeout:10000});
 const trade=await desktop.evaluate(()=>{
  const notice=document.getElementById('desktop-public-preview');
  const main=document.querySelector('main');
  const banner=notice.getBoundingClientRect();
  return {
   title:document.title,noticeVisible:!notice.hidden,
   noticePosition:getComputedStyle(notice).position,
   noticeBottom:banner.bottom,mainTop:main.getBoundingClientRect().top,
   emptyOrders:document.getElementById('tb-ord').textContent,
   orderCount:[...document.querySelectorAll('[data-b="nord"]')].map(e=>e.textContent),
   cash:[...document.querySelectorAll('[data-b="cash"]')].map(e=>e.textContent),
   tradeTabVisible:!document.getElementById('p-trade').hidden,
   exportDisabled:document.getElementById('exp').disabled,
   depositInputDisabled:document.getElementById('damt').disabled,
   publicPreview:document.body.classList.contains('desktop-readonly-preview')
  };
 });
 assert.match(trade.title,/NUVEXA PRO/);
 assert.equal(trade.noticeVisible,true);
 assert.notEqual(trade.noticePosition,'fixed','Preview notice must not float over the content');
 assert.ok(trade.noticeBottom<=trade.mainTop+5,'Preview notice cannot overlap the dashboard');
 assert.match(trade.emptyOrders,/账户交易数据未连接/);
 assert.ok(trade.orderCount.length>0&&trade.orderCount.every(v=>v==='—'),'No fake zero order counts');
 assert.ok(trade.cash.length>0&&trade.cash.every(v=>v==='—'),'No fake zero balances');
 assert.equal(trade.exportDisabled,true);
 assert.equal(trade.depositInputDisabled,true);
 assert.equal(trade.publicPreview,true);
 await desktop.screenshot({path:artifacts+'/trade-1440.png',fullPage:true});
 await desktop.locator('.nav button[data-p="acct"]').click();
 await desktop.locator('#p-acct').waitFor({state:'visible',timeout:8000});
 assert.match(await desktop.locator('#tb-hold').innerText(),/账户持仓数据未连接/);
 await desktop.screenshot({path:artifacts+'/account-1440.png',fullPage:true});

 const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
 mobile.on('pageerror',error=>pageErrors.push(error.message));
 await mobile.goto(base,{waitUntil:'domcontentloaded',timeout:30000});
 await mobile.locator('html.cn-ready').waitFor({state:'attached',timeout:15000});
 const mobileNote=await mobile.locator('.desktop-mobile-hint').evaluate(el=>({text:el.textContent,display:getComputedStyle(el).display}));
 assert.match(mobileNote.text,/电脑浏览器/);
 assert.notEqual(mobileNote.display,'none','Desktop-only note must show at mobile width');
 await mobile.screenshot({path:artifacts+'/mobile-warning-390.png',fullPage:true});
 assert.equal(apis.length,0,'UI-only preview must never request /api endpoints');
 assert.deepEqual(pageErrors,[],'No uncaught page JavaScript exceptions');
 const evidence={environment:'isolated localhost static preview',sha:process.env.GITHUB_SHA||'local',
  production:false,authenticated:false,tradingWrites:0,apiRequests:apis,desktop:trade,mobileNote,pageErrors};
 await writeFile(artifacts+'/evidence.json',JSON.stringify(evidence,null,2));
 console.log('DESKTOP_PREVIEW_CHROMIUM_OK '+JSON.stringify(evidence));
 await mobile.close();await desktop.close();
}finally{
 await browser.close();
 server.closeAllConnections();
 await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
}
