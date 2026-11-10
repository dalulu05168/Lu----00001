
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
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
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
async function expectButtonResult(page,button,path,status,method){
  const [result]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===path&&r.request().method()===method),button.click()]);
  assert.equal(result.status(),status,JSON.stringify(await result.json()));
  return result;
}
async function setupPage(browser,token,viewport={width:1280,height:900}){
  const page=await browser.newPage({viewport,reducedMotion:'reduce'});
  page.setDefaultTimeout(9000);
  page.on('pageerror',error=>console.log('browser:',error.message));
  await page.addInitScript(value=>{localStorage.setItem('cncap.admin.session',value);sessionStorage.setItem('cncap.admin.entry','1')},token);
  if(process.env.CN_OPS_LIVE_UI==='1'){
    const origin='https://admin.maacropierce.com';
    await page.route(origin+'/**',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname.startsWith('/api/'))return route.fulfill({response:await route.fetch({url:base+url.pathname+url.search})});
      if(url.pathname==='/admin'||url.pathname==='/'){const source=fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8');const pages=JSON.parse(source.match(/const replacementPages = (.+);/)[1]);return route.fulfill({contentType:'text/html',body:pages.admin})}
      return route.continue();
    });
    await page.goto(origin+'/admin#cli');
  }else{
    const html=fs.readFileSync('master-support-admin.html','utf8');
    await page.route(base+'/admin',route=>route.fulfill({contentType:'text/html',body:html}));
    await page.goto(base+'/admin#cli');
  }
  await page.locator('#cn-client-refresh').waitFor({state:'attached'});
  return page;
}

async function sendCustomerMessage(browser,kind,token,message){
  const mobile=kind==='mobile',page=await browser.newPage(mobile?devices['iPhone 13']:{});
  try{
    await page.addInitScript(t=>{localStorage.setItem('cncap.session',t);sessionStorage.setItem('cncap.mobile.entry','1')},token);
    const live=process.env.CN_OPS_LIVE_UI==='1';
    const origin=live?'https://nuvexapro.com':base;
    if(live)await page.route(origin+'/**',async route=>{
      const url=new URL(route.request().url());
      return url.pathname.startsWith('/api/')?route.fulfill({response:await route.fetch({url:base+url.pathname+url.search})}):route.continue();
    });
    else{
      const pages=JSON.parse(fs.readFileSync('worker.master-support-release.mjs','utf8').match(/const replacementPages = (.+);/)[1]);
      await page.route(base+'/',route=>route.fulfill({contentType:'text/html',body:pages[kind]}));
    }
    await page.goto(origin+'/');
    await page.locator(mobile?'[data-a=chat]':'#csbtn').first().click();
    await page.locator(mobile?'#cm':'#cmsg').fill(message);
    await expectButtonResult(page,page.locator(mobile?'#sd':'#f-chat button[type=submit]'),'/api/support',201,'POST');
  }finally{await page.unrouteAll({behavior:'ignoreErrors'});await page.close()}
}
(async()=>{
  const secret=JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE||'qa-local-master-support.json')).totpSecret;
  const master=(await api(admin('login'),200,null,{email:'qa-master@example.test',password,otp:otp(secret)})).token;
  const agentA=await createAgent(master,1,a),agentB=await createAgent(master,2,b);
  const ta=await login(a),tb=await login(b);
  const identity={kind:'IDENTITY',front:image,back:image};
  await api('/api/profile-documents',201,ta,identity);
  await api('/api/profile-documents',201,ta,{kind:'BANK',bankName:'QA Example Bank',accountNumber:'000000001234'});
  await api('/api/profile-documents',201,tb,identity);
  const masterClients=(await api(admin('clients'),200,master)).items;
  const scoped=(await api(admin('clients'),200,agentA.token)).items;
  assert.equal(scoped.length,1);assert.equal(scoped[0].email,a);assert.equal(scoped[0].subadmin_email,agentA.email);
  assert.equal(masterClients.find(x=>x.email===b).subadmin_email,agentB.email);
  await api(detailPath(b),404,agentA.token);
  await api(admin('clients'),404,agentA.token,{email:b,field:'vip_level',value:'VIP4',reason:'Unauthorized test'},'PATCH');
  assert.deepEqual((await api(admin('profile-documents'),200,agentA.token)).items.map(x=>x.email),[a,a]);
  await api(reviewQuery(b,'IDENTITY'),404,agentA.token);
  await api(admin('profile-documents'),404,agentA.token,{email:b,kind:'IDENTITY',status:'APPROVED',version:new Date().toISOString()},'PATCH');
  await api(admin('profile-documents'),403,master);
  await api(admin('profile-documents'),403,master,{email:a,kind:'IDENTITY',status:'APPROVED',version:new Date().toISOString()},'PATCH');
  await api(admin('requests'),403,agentA.token);
  assert(!(await api(admin('notifications'),200,agentA.token)).items.some(x=>x.category==='CASH'));
  console.log('Invitation scopes and unauthorized details, updates, approvals verified');
  const browser=await chromium.launch({executablePath:process.env.CN_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
    const owner=await setupPage(browser,master),sub=await setupPage(browser,agentA.token);
    const clientRow=(p,email)=>p.locator('#t-cli tbody tr').filter({hasText:email});
    await owner.locator('#t-sub [data-sub-client]').filter({hasText:agentA.email}).click();await clientRow(owner,a).waitFor();assert.equal(await clientRow(owner,b).count(),0);
    await clientRow(sub,a).waitFor();assert.equal(await clientRow(sub,b).count(),0);
    await sub.locator('#cn-client-search').fill(b);
    await sub.getByText('未找到符合条件的客户').waitFor();
    await sub.locator('#cn-client-search').clear();
    await clientRow(sub,a).getByRole('button',{name:'客户详情'}).click();
    const detail=sub.locator('dialog[open]');
    await detail.getByText('账户权限与 VIP').waitFor();
    assert.equal(await detail.getByRole('button',{name:'客服消息',exact:true}).count(),0);
    for(const [field,value,label] of [
      ['vip_level','VIP3','VIP 等级'],['withdraw_policy','DENY','提现权限'],
      ['account_type','REAL_PENDING','账户类别'],['loan_policy','DENY','贷款申请权限'],
      ['login_policy','DENY','登录权限'],['login_policy','ALLOW','登录权限']
    ]){
      const select=detail.locator('select[name='+field+']');
      await select.selectOption(value);
      await detail.locator('textarea[name=reason]').fill('QA '+field);
      await expectButtonResult(sub,select.locator('..').getByRole('button',{name:'保存'}),admin('clients'),200,'PATCH');
      await detail.getByText(label+'已更新。').waitFor();
    }
    assert.equal((await api(detailPath(a),200,agentA.token)).controls.vip_level,'VIP3');
    await api('/api/account',401,ta);
    const freshA=await login(a);
    await detail.getByRole('button',{name:'关闭',exact:true}).click();
    await clientRow(sub,a).getByRole('button',{name:'App 镜像'}).click();
    const iframe=sub.locator('dialog[open] iframe');
    await iframe.waitFor();
    const size=await iframe.evaluate(frame=>{const r=frame.getBoundingClientRect();return [r.width,r.height,frame.closest('dialog').getBoundingClientRect().bottom,innerHeight]});
    assert(size[1]>400);assert(size[2]<=size[3]);assert(size[0]<=390);
    const frame=sub.frameLocator('dialog[open] iframe');
    await frame.getByText(a,{exact:false}).first().waitFor();
    assert.equal(await frame.getByRole('button',{name:'客服',exact:true}).count(),0);
    await frame.locator('[data-a=tab][data-v=assets]').click();
    await frame.locator('[data-a=sheet][data-v=kyc]').first().waitFor();
    await sub.keyboard.press('Escape');await clientRow(sub,a).getByRole('button',{name:'客户详情'}).click();
    await detail.getByText('账户权限与 VIP').waitFor();
    await detail.getByRole('button',{name:'关闭',exact:true}).click();
    console.log('Owner-only browser list, five customer controls, session revocation, phone aspect and navigation verified');
    await sub.locator('[data-p=appr]').click();
    await sub.locator('#cn-doc-rows').getByText(a,{exact:true}).first().waitFor();
    assert.equal(await sub.locator('#cn-doc-rows').getByText(b,{exact:true}).count(),0);
    assert(!await sub.locator('#cn-cash-approval').isVisible());
    await sub.locator('#cn-doc-kind').selectOption('IDENTITY');
    await sub.locator('#cn-doc-rows').getByRole('button',{name:'查看并审核'}).click();
    await detail.locator('img[alt="身份证正面"]').waitFor();
    await detail.getByRole('button',{name:'身份证正面 · 放大'}).click();
    assert(!await detail.locator('img[alt="身份证反面"]').isVisible());
    await detail.getByRole('button',{name:'身份证正面 · 还原'}).click();
    await detail.getByRole('button',{name:'驳回资料'}).click();
    await detail.getByText('请输入驳回原因。').waitFor();
    await detail.locator('textarea').fill('QA image mismatch');
    await expectButtonResult(sub,detail.getByRole('button',{name:'驳回资料'}),admin('profile-documents'),200,'PATCH');
    await api('/api/profile-documents',201,freshA,identity);
    await sub.locator('#cn-doc-refresh').click();
    await sub.locator('#cn-doc-rows').getByRole('button',{name:'查看并审核'}).click();
    await detail.locator('img[alt="身份证反面"]').waitFor();
    const seen=await api(reviewQuery(a,'IDENTITY'),200,agentA.token);
    await expectButtonResult(sub,detail.getByRole('button',{name:'通过审核'}),admin('profile-documents'),200,'PATCH');
    await api(admin('profile-documents'),409,agentA.token,{email:a,kind:'IDENTITY',status:'APPROVED',version:seen.version},'PATCH');
    await sub.locator('#cn-doc-kind').selectOption('BANK');
    await sub.locator('#cn-doc-rows').getByRole('button',{name:'查看并审核'}).click();
    await detail.getByText('QA Example Bank').waitFor();
    await detail.getByText('1234',{exact:true}).waitFor();
    assert.equal(await detail.getByText('000000001234',{exact:true}).count(),0);
    await expectButtonResult(sub,detail.getByRole('button',{name:'通过审核'}),admin('profile-documents'),200,'PATCH');
    const journal=(await api(admin('audit'),200,agentA.token)).items;
    assert.equal(journal.filter(x=>x.action==='client.documents.review').length,3);
    assert(journal.some(x=>x.detail.reason==='QA image mismatch'));
    console.log('Document queue, review images, reject reason, resubmit, masked bank, audit and conflict verified');
    const deposit=await api('/api/requests',201,freshA,{kind:'DEPOSIT',amountCents:3000});
    await api(admin('requests'),403,agentA.token,{id:deposit.id,decision:'APPROVE'});
    await owner.locator('[data-p=appr]').click();assert(!await owner.locator('#cn-doc-approval').isVisible());
    const cash=owner.locator('#cn-cash-approval tbody tr').filter({hasText:a});
    await owner.locator('#cn-cash-refresh').click();
    await cash.getByText('30.00',{exact:true}).waitFor();
    await expectButtonResult(owner,cash.getByRole('button',{name:'初审通过'}),admin('requests'),200,'POST');
    await expectButtonResult(owner,cash.getByRole('button',{name:'终审通过'}),admin('requests'),200,'POST');
    assert.equal((await api('/api/account',200,freshA)).account.cashCents,3000);
    await api(admin('requests'),400,master,{id:deposit.id,decision:'APPROVE'});

    await api(admin('clients'),200,agentA.token,{email:a,field:'withdraw_policy',value:'ALLOW',reason:'QA restore'},'PATCH');
    await api('/api/withdrawal-pin',200,freshA,{password,pin:'472863'});
    const withdrawal=await api('/api/requests',201,freshA,{kind:'WITHDRAW',amountCents:1000,withdrawalPin:'472863'});
    await api(admin('requests'),403,agentA.token,{id:withdrawal.id,decision:'APPROVE'});
    await owner.locator('#cn-cash-kind').selectOption('WITHDRAW');
    await cash.getByText('10.00',{exact:true}).waitFor();
    await expectButtonResult(owner,cash.getByRole('button',{name:'初审通过'}),admin('requests'),200,'POST');
    await expectButtonResult(owner,cash.getByRole('button',{name:'终审通过'}),admin('requests'),200,'POST');
    assert.equal((await api('/api/account',200,freshA)).account.cashCents,2000);
    await api(admin('requests'),400,master,{id:withdrawal.id,decision:'APPROVE'});
    console.log('Master-only deposit and withdrawal review, filters and one ledger entry per request verified');
    const messageA='QA owned message '+stamp,messageB='QA other message '+stamp;
    await sendCustomerMessage(browser,'desktop',freshA,messageA);
    await sendCustomerMessage(browser,'mobile',tb,messageB);
    assert(!await sub.locator('#cn-support-open').isVisible());
    assert.equal(await clientRow(sub,a).getByRole('button',{name:'客服消息',exact:true}).count(),0);
    await api(admin('support/inbox'),403,agentA.token);
    await api(admin('support?email=')+encodeURIComponent(a),403,agentA.token);
    await api(admin('support'),403,agentA.token,{email:a,message:'QA forbidden'});
    assert.deepEqual((await api(detailPath(a),200,agentA.token)).support,[]);
    assert((await api(detailPath(a),200,master)).support.some(x=>x.body===messageA));
    const scopedNotices=(await api(admin('notifications'),200,agentA.token)).items;
    assert(!scopedNotices.some(x=>x.category==='CASH'));
    assert(scopedNotices.every(x=>x.category!=='SUPPORT'));
    const masterNotices=(await api(admin('notifications'),200,master)).items;
    assert(masterNotices.some(x=>x.category==='SUPPORT'&&x.email===a));
    assert(masterNotices.some(x=>x.category==='SUPPORT'&&x.email===b));
    const waiting=sub.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/notifications'&&r.ok());
    await sub.evaluate(()=>window.dispatchEvent(new Event('cn-notifications-refresh')));
    await waiting;
    await sub.locator('.cn-bell').click();
    await sub.locator('.cn-notify[open]').waitFor();
    assert.equal(await sub.locator('.cn-notify[open]').getByText('提现申请',{exact:false}).count(),0);
    assert.equal(await sub.locator('.cn-notify[open]').getByText('客户发来客服消息',{exact:true}).count(),0);
    await sub.locator('.cn-notify[open]').getByRole('button',{name:'关闭'}).click();
    await owner.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await owner.locator('#cn-support-count').getByText('2',{exact:true}).waitFor();
    await owner.locator('#cn-support-open').click();
    await owner.locator('dialog[open] tr').filter({hasText:a}).getByRole('button',{name:'打开会话'}).click();
    await owner.locator('#chat-log').getByText(messageA,{exact:true}).waitFor();
    await owner.locator('#cn-support-count').getByText('1',{exact:true}).waitFor();
    const reply='QA master reply '+stamp;
    await owner.locator('#chat-input').fill(reply);
    await expectButtonResult(owner,owner.locator('#chat-send'),admin('support'),201,'POST');
    assert((await api('/api/support',200,freshA)).items.some(x=>x.body===reply));
    console.log('Desktop and mobile sent to master; master inbox, bell and reply passed; subaccount denied by API, list, detail and mirror');
  }finally{for(const context of browser.contexts())for(const page of context.pages())await page.unrouteAll({behavior:'ignoreErrors'});await browser.close()}
})().catch(error=>{console.error(error.stack);process.exitCode=1});
