const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{randomUUID}=require('crypto'),{PGlite}=require('@electric-sql/pglite'),{pathToFileURL}=require('url');
(async()=>{
 const dir=fs.mkdtempSync(path.resolve('artifacts/account-history-'));const pg=new PGlite(path.join(dir,'db'));await pg.waitReady;await pg.exec("CREATE TABLE schema_migrations(filename text PRIMARY KEY,applied_at timestamptz DEFAULT now())");
 const files=fs.readdirSync('db');for(const f of [...files.filter(f=>/^\d/.test(f)).sort(),...files.filter(f=>f.startsWith('migration-')).sort(),'product-settlement-schema.sql','product-settlement-workflows.sql','commodity-reference-order-prices.sql'])await pg.exec(fs.readFileSync('db/'+f,'utf8').replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/ig,''));
 const db={query:(...x)=>pg.query(...x),connect:async()=>({query:(...x)=>pg.query(...x),release(){}})};
 let source=fs.readFileSync('dist/worker.mjs','utf8').replace('import { handleAsNodeRequest } from "cloudflare:node";','');source+='\nexport {getAccountSnapshot,cnProductSave,cnProductList,cnFundSubscribe,cnSettleDueFunds,placeInternalOrder,createApi,hashPassword};';
 const runtime=path.join(dir,'runtime.mjs');fs.writeFileSync(runtime,source);const app=await import(pathToFileURL(runtime));
 const uid=randomUUID(),aid=randomUUID();await pg.query('INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3)',[uid,'qa-tier@example.test',await app.hashPassword('FixturePass123456!')]);await pg.query('INSERT INTO accounts(id,user_id,cash_cents) VALUES($1,$2,100000000)',[aid,uid]);

 for(let i=0;i<501;i++){
   await app.placeInternalOrder(db,aid,'history-'+i,{market:'US',symbol:'AAPL',side:'BUY',quantity:1,priceCents:100,fxUsdMicros:1000000},randomUUID());
 }
 await app.placeInternalOrder(db,aid,'fifo-sell',{market:'US',symbol:'AAPL',side:'SELL',quantity:1,priceCents:200,fxUsdMicros:1000000},randomUUID());
 for(let i=0;i<13;i++)await app.placeInternalOrder(db,aid,'holding-'+i,{market:'US',symbol:'B'+i,side:'BUY',quantity:1,priceCents:300,fxUsdMicros:1000000},randomUUID());
 const snapshot=await app.getAccountSnapshot(db,aid);
 assert.equal(snapshot.orders.length,515);
 assert.equal(new Set(snapshot.orders.map(o=>o.id)).size,515);
 assert.equal(snapshot.tradeTotal,542);
 assert.equal(snapshot.realizedPnl,1);
 assert.equal(snapshot.positions.length,14);
 let fail=false;
 const server=app.createApi({db,resolveSession:async()=>({userId:uid,accountId:aid}),resolveProductQuote:async p=>{
   if(fail&&p.symbol==='B0')throw Error('Unavailable quote');
   return {...p,priceCents:400,timestampMs:Date.now()};
 }}).listen(0,'127.0.0.1');
 await new Promise(r=>server.listening?r():server.once('listening',r));
 const get=async()=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/account',{headers:{Authorization:'Bearer fixture'}});assert.equal(r.status,200);return r.json()};
 const full=await get();
 assert.equal(full.totalAssets,(snapshot.account.cashCents+513*400)/100);
 assert.equal(full.valuationEstimated,false);
 fail=true;const partial=await get();
 assert.equal(partial.totalAssets,full.totalAssets-1);
 assert.equal(partial.valuationEstimated,true);
 assert.equal(partial.orders.length,515);

 const {chromium,devices}=require('playwright');
 const pages=JSON.parse(source.match(/const replacementPages = (.+);/)[1]);
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  for(const kind of ['desktop','mobile']){
   const page=await browser.newPage(kind==='mobile'?devices['iPhone 13']:{viewport:{width:1440,height:900}});
   await page.addInitScript(()=>{localStorage.setItem('cncap.session','fixture');sessionStorage.setItem('cncap.mobile.entry','1')});
   await page.route('**/*',r=>{const url=new URL(r.request().url());return url.origin!==origin?r.abort():url.pathname==='/'?r.fulfill({contentType:'text/html',body:pages[kind]}):r.continue()});
   await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
   if(kind==='desktop'){
    await page.locator('[data-p=acct]').click();
    await page.locator('#p-acct [data-b=realized]').filter({hasText:'1.00'}).waitFor();
    assert.equal(await page.locator('[data-b=nord]').first().textContent(),'515');
    assert.match(await page.locator('[data-b=valuationNote]').first().textContent(),/估算/);
   }else{
    await page.locator('[name=email]').fill('qa-tier@example.test');
    await page.locator('[name=password]').fill('FixturePass123456!');
    await page.locator('#login-form button').click();
    await page.locator('nav [data-go=mine]').click();
    await page.locator('.compact-grid .panel').filter({hasText:'已实现盈亏'}).filter({hasText:'1.00'}).waitFor();
    await page.locator('nav [data-go=trade]').click();
    assert.equal(await page.locator('[data-position]').count(),14);
    await page.locator('[data-subtab=orders]').click();
    assert.equal(await page.locator('main .menulink').count(),515);
   }
   await page.screenshot({path:path.join(dir,kind+'.png'),fullPage:true});
   await page.unrouteAll({behavior:'ignoreErrors'});await page.close();
  }
 }finally{await browser.close()}
 server.close();
 fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify({passed:true,orders:515,positions:14,tradeTotal:snapshot.tradeTotal,realizedPnl:snapshot.realizedPnl,totalAssets:full.totalAssets,estimatedTotal:partial.totalAssets},null,2));
 console.log(JSON.stringify({passed:true,evidence:dir}));await pg.close();
})().catch(e=>{console.error(e.stack);process.exit(1)});
