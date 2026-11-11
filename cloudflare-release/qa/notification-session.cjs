const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHmac}=require('node:crypto');
const {chromium,devices}=require('playwright');
const base='http://127.0.0.1:'+process.env.CN_OPS_QA_PORT,password='FixturePass123456!',email='notify-session@example.test',dir=process.env.CN_QA_SAVE_DIR;
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=';
function otp(secret){const bits=[...secret].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join(''),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const b=createHmac('sha1',Buffer.from(bits.match(/.{8}/g).map(x=>parseInt(x,2)))).update(counter).digest();return String((b.readUInt32BE(b[19]&15)&0x7fffffff)%1000000).padStart(6,'0')}
async function api(route,status,token,body,method=body?'POST':'GET'){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined}),data=r.status===204?{}:await r.json();assert.equal(r.status,status,route+' '+JSON.stringify(data));return data}
(async()=>{
 const master=(await api('/api/admin/login',200,null,{email:'qa-master@example.test',password,otp:otp(JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE)).totpSecret)})).token;
 const sub=await api('/api/admin/subaccounts',201,master,{email:'notify-agent@example.test',password}),credentials={email:'notify-agent@example.test',password,otp:otp(sub.totpSecret)};
 await api('/api/admin/activate',200,null,credentials);const agent=(await api('/api/admin/login',200,null,credentials)).token;
 await api('/api/auth/register',201,null,{email,password,inviteCode:sub.inviteCode});const client=(await api('/api/auth/login',200,null,{email,password})).token;
 for(const doc of [{kind:'IDENTITY',fullName:'通知验收客户',front:image,back:image},{kind:'BANK',bankName:'Notification Bank',accountNumber:'1234567890'}]){
  await api('/api/profile-documents',201,client,doc);const review=await api('/api/admin/profile-documents?'+new URLSearchParams({email,kind:doc.kind}),200,agent);
  await api('/api/admin/profile-documents',200,agent,{email,kind:doc.kind,status:'APPROVED',version:review.version},'PATCH');await api('/api/profile-documents',409,client,doc);
 }
 await api('/api/admin/support',201,master,{email:'qa-mobile@example.test',message:'旧账户客服专属消息'});
 await api('/api/admin/support',201,master,{email,message:'新账户客服专属消息'});
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),pages=JSON.parse(fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8').match(/const replacementPages = (.+);/)[1]);
 let held,heldResponse,releaseHeld;const heldReady=new Promise(r=>releaseHeld=r);
 try{
  const p=await browser.newPage(devices['iPhone 13']);p.setDefaultTimeout(12000);let holdFirst=true;
  await p.route(base+'/**',async route=>{const u=new URL(route.request().url());if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:pages.mobile});if(u.pathname==='/logo.png')return route.fulfill({contentType:'image/png',body:fs.readFileSync(path.join(__dirname,'../web/logo.png'))});
   if(u.pathname==='/api/notifications'&&holdFirst){holdFirst=false;heldResponse=await route.fetch();held=route;releaseHeld();return;}return route.continue();});
  async function login(address){await p.locator('[name=email]').fill(address);await p.locator('[name=password]').fill(password);await p.locator('#login-form button').click();await p.locator('nav [data-go=mine]').waitFor();}
  await p.goto(base);await login('qa-mobile@example.test');await heldReady;await p.locator('nav [data-go=mine]').click();await p.locator('[data-action=logout]').click();await p.locator('#login-form').waitFor();
  await login(email);await p.locator('[data-business=notifications].notification .unread-dot').waitFor();
  const oldResponse=p.waitForResponse(r=>r.url().endsWith('/api/notifications'));await held.fulfill({response:heldResponse});await oldResponse;held=null;
  await p.locator('nav [data-go=mine]').click();await p.locator('.profile strong').filter({hasText:'通知验收客户'}).waitFor();
  await p.locator('[data-business=notifications].notification').click();await p.locator('[data-notification][data-business=support]').waitFor();assert.equal(await p.locator('[data-notification]').count(),3);
  await p.locator('[data-notification][data-business=support]').click();await p.getByRole('heading',{name:'在线客服',exact:true}).waitFor();await p.getByText('新账户客服专属消息',{exact:true}).waitFor();assert.equal(await p.getByText('旧账户客服专属消息',{exact:true}).count(),0);
  await p.locator('[data-business=notifications].notification').click();await p.locator('[data-notification][data-business=support] .is-read').waitFor();
  await p.locator('[data-notification][data-business=documents]').first().click();await p.getByRole('heading',{name:'资料与审核',exact:true}).waitFor();
  for(const action of ['identity','bank']){
   await p.locator('[data-business='+action+'].menulink').click();await p.getByText('资料已提交并审核通过，如需更改请联系在线客服。',{exact:true}).waitFor();assert.equal(await p.locator('[data-business-form='+action+']').count(),0);
   await p.locator('[data-business=support].menulink').click();await p.getByRole('heading',{name:'在线客服',exact:true}).waitFor();
   await p.locator('[data-business=notifications].notification').click();await p.locator('[data-notification][data-business=documents]').first().click();
  }
  await p.locator('nav [data-go=mine]').click();await api('/api/admin/support',201,master,{email,message:'后续客服回复自动刷新'});
  const refreshed=p.waitForResponse(r=>r.url().endsWith('/api/notifications'));await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await refreshed;
  await p.locator('[data-business=notifications].notification .unread-dot').waitFor();await p.locator('[data-business=notifications].notification').click();await p.locator('[data-notification][data-business=support] .is-unread').waitFor();
  await p.locator('[data-notification][data-business=support]').first().click();await p.getByText('后续客服回复自动刷新',{exact:true}).waitFor();
  await p.screenshot({path:path.join(dir,'support-after-session-switch.png'),fullPage:true});
  fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify({passed:true,sessionSwitchWhileOldRequestPending:true,oldAccountResponseIgnored:true,approvedName:true,supportNotificationNavigation:true,readMarkerPersisted:true,focusRefresh:true,approvedIdentityAndBankLocked:true,serverDuplicateRejected:true,contactSupportFromApprovedDocuments:true},null,2));
 }finally{if(held)await held.abort().catch(()=>{});await browser.close()}
 console.log('Pending old notification response cannot block new login; support routing, read state, approved name and document locks passed');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
