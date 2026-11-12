const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHmac}=require('node:crypto');
const {chromium}=require('playwright');
const base='http://127.0.0.1:'+process.env.CN_OPS_QA_PORT,password='FixturePass123456!',stamp=Date.now(),dir=process.env.CN_QA_SAVE_DIR;
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=';
function otp(secret){const bits=[...secret].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join(''),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const sum=createHmac('sha1',Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)))).update(counter).digest();return String((sum.readUInt32BE(sum[19]&15)&0x7fffffff)%1000000).padStart(6,'0')}
async function api(route,status,token,body,method=body?'POST':'GET'){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const data=r.status===204?{}:await r.json();assert.equal(r.status,status,route+' '+JSON.stringify(data));return data}
(async()=>{
 const master=(await api('/api/admin/login',200,null,{email:'qa-master@example.test',password,otp:otp(JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE)).totpSecret)})).token;
 const agents=[];
 for(let n=0;n<3;n++){
  const email='funding-agent-'+stamp+'-'+n+'@example.test',sub=await api('/api/admin/subaccounts',201,master,{email,password}),credentials={email,password,otp:otp(sub.totpSecret)};
  await api('/api/admin/activate',200,null,credentials);const token=(await api('/api/admin/login',200,null,credentials)).token;
  agents.push({email,token,code:sub.inviteCode,clients:[]});
 }
 for(let n=0;n<3;n++){
  const agent=agents[n===2?0:n],email='funding-client-'+stamp+'-'+n+'@example.test';
  await api('/api/auth/register',201,null,{email,password,inviteCode:agent.code});const token=(await api('/api/auth/login',200,null,{email,password})).token;agent.clients.push({email,token});
  for(const doc of [{kind:'IDENTITY',fullName:'验收客户'+n,front:image,back:image},{kind:'BANK',bankName:'QA Bank',accountNumber:'1234567890'}]){
   await api('/api/profile-documents',201,token,doc);const review=await api('/api/admin/profile-documents?'+new URLSearchParams({email,kind:doc.kind}),200,agent.token);
   await api('/api/admin/profile-documents',200,agent.token,{email,kind:doc.kind,status:'APPROVED',version:review.version},'PATCH');
  }
 }
 const ca=agents[0].clients[0],cb=agents[1].clients[0];
 async function deposit(client,amount){const r=await api('/api/requests',201,client.token,{kind:'DEPOSIT',amountCents:amount});for(let n=0;n<2;n++)await api('/api/admin/requests',200,master,{id:r.id,decision:'APPROVE'});return r}
 await deposit(ca,10000);await deposit(cb,30000);
 await api('/api/withdrawal-pin',200,ca.token,{password,pin:'123456'});
 const withdraw=await api('/api/requests',201,ca.token,{kind:'WITHDRAW',amountCents:4000,withdrawalPin:'123456'});for(let n=0;n<2;n++)await api('/api/admin/requests',200,master,{id:withdraw.id,decision:'APPROVE'});
 await api('/api/requests',201,cb.token,{kind:'DEPOSIT',amountCents:2000});
 const overview=async(token,email='')=>api('/api/admin/funding-overview?'+new URLSearchParams({subaccount:email}),200,token);
 const all=await overview(master),a=await overview(master,agents[0].email),b=await overview(master,agents[1].email),empty=await overview(master,agents[2].email);
 assert.deepEqual(all.summary,{clients:3,subaccounts:3});assert.deepEqual(a.summary,{clients:2,subaccounts:1});assert.deepEqual(b.summary,{clients:1,subaccounts:1});assert.deepEqual(empty.summary,{clients:0,subaccounts:1});
 assert.equal(all.items.length,4);assert.equal(a.items.length,2);assert.equal(b.items.length,2);assert.equal(empty.items.length,0);
 assert.deepEqual((await overview(agents[0].token)).items,a.items);await api('/api/admin/funding-overview?subaccount='+encodeURIComponent(agents[1].email),403,agents[0].token);
 const subDetail=await api('/api/admin/subaccounts/overview?email='+encodeURIComponent(agents[0].email),200,master);assert.equal(subDetail.clients,2);assert.equal(subDetail.totals.deposits,'10000');assert.equal(subDetail.totals.withdrawals,'4000');
 const pages=JSON.parse(fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8').match(/const replacementPages = (.+);/)[1]),browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),errors=[];
 async function open(token){const p=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(t=>{localStorage.setItem('cncap.admin.session',t);sessionStorage.setItem('cncap.admin.entry','1')},token);await p.route(base+'/**',r=>{const u=new URL(r.request().url());return u.pathname==='/'?r.fulfill({contentType:'text/html',body:pages.admin}):u.pathname==='/logo.png'?r.fulfill({contentType:'image/png',body:fs.readFileSync(path.join(__dirname,'../web/logo.png'))}):r.continue()});await p.goto(base);await p.locator('#stats .sc').nth(3).locator('em').filter({hasText:/\d/}).waitFor();return p}
 const checks=[];
 try{
  const p=await open(master);await p.locator('#cn-overview-sub option').filter({hasText:agents[2].email}).waitFor({state:'attached'});
  async function check(label,selected,net,deposit,clients,subs,emails){
   if(selected!==null){const response=p.waitForResponse(r=>r.url().includes('/api/admin/funding-overview?')&&new URL(r.url()).searchParams.get('subaccount')===selected);await p.locator('#cn-overview-sub').selectOption(selected);await response;}
   await p.waitForFunction(({net,clients})=>document.querySelector('#stats .sc em')?.textContent==='$'+net&&document.querySelectorAll('#stats .sc em')[3]?.textContent===String(clients),{net,clients});
   assert.equal(await p.locator('#stats .sc').nth(1).locator('em').innerText(),'$'+deposit);assert.match(await p.locator('#stats .sc').nth(3).innerText(),new RegExp('子管理员 '+subs));
   const rows=await p.locator('#tb').innerText();for(const email of emails)assert(rows.includes(email));for(const c of [ca,cb])if(!emails.includes(c.email))assert(!rows.includes(c.email));
   const ops=await p.locator('#ops').innerText();assert.match(ops,new RegExp('客户账户\\s*'+clients));assert.match(ops,new RegExp('子管理员\\s*'+subs));
   assert(!(await p.locator('.overview-side>.pn:last-child>.ph').innerText()).includes('暂无数据'));
   assert.match(await p.locator('.ops-grid>.pb:last-child').innerText(),new RegExp('待审核\\s*'+(emails.includes(cb.email)?1:0)));
   if(!emails.length){assert.equal(await p.locator('#cs>div').first().locator('b').innerText(),'0.00');assert.match(await p.locator('#sum').innerText(),/充值 0.00/);}
   if(emails.length){const cv=p.locator('#cv');await cv.hover({position:{x:Math.max(60,(await cv.boundingBox()).width-60),y:100}});await p.locator('#tip.on').waitFor();assert.match(await p.locator('#tip').innerText(),/累计净流入/);}
   checks.push({label,net,deposit,clients,subs});await p.screenshot({path:path.join(dir,label+'.png'),fullPage:true});
  }
  await check('all',null,'360.00','420.00',3,3,[ca.email,cb.email]);
  await check('agent-a',agents[0].email,'60.00','100.00',2,1,[ca.email]);
  await check('agent-b',agents[1].email,'300.00','320.00',1,1,[cb.email]);
  await check('empty-agent',agents[2].email,'0.00','0.00',0,1,[]);
  let releaseA,seenA;const waitingA=new Promise(resolve=>seenA=resolve),gateA=new Promise(resolve=>releaseA=resolve);
  const overviewPattern=base+'/api/admin/funding-overview?**';
  await p.route(overviewPattern,async route=>{if(new URL(route.request().url()).searchParams.get('subaccount')===agents[0].email){const response=await route.fetch();seenA();await gateA;return route.fulfill({response})}return route.continue()});
  await p.locator('#cn-overview-sub').selectOption(agents[0].email);await waitingA;
  await check('fast-switch-agent-b',agents[1].email,'300.00','320.00',1,1,[cb.email]);
  const late=p.waitForResponse(r=>r.url().includes('/api/admin/funding-overview?')&&new URL(r.url()).searchParams.get('subaccount')===agents[0].email);releaseA();await late;await p.evaluate(()=>new Promise(requestAnimationFrame));
  assert.equal(await p.locator('#stats .sc').first().locator('em').innerText(),'$300.00');await p.unroute(overviewPattern);
  await p.route(overviewPattern,r=>r.fulfill({status:503,json:{error:'Isolated unavailable'}}));
  await p.locator('#cn-overview-sub').selectOption('');await p.locator('#csub').filter({hasText:'资金记录暂时无法读取'}).waitFor();assert.equal(await p.locator('#stats .sc').nth(3).locator('em').innerText(),'—');
  await p.unroute(overviewPattern);await check('recovered-agent-a',agents[0].email,'60.00','100.00',2,1,[ca.email]);
  await p.locator('[data-p=cli]').first().click();await p.locator('[data-sub-client]').filter({hasText:agents[0].email}).click();const scopedClients=p.locator('#t-cli > table > tbody');await scopedClients.getByText(ca.email,{exact:true}).waitFor();assert(!(await scopedClients.innerText()).includes(cb.email));
  await p.getByRole('button',{name:'出入金明细',exact:true}).click();await p.locator('dialog.sub-overview[open]').getByText(ca.email,{exact:true}).first().waitFor();await p.screenshot({path:path.join(dir,'subaccount-detail.png'),fullPage:true});await p.close();
  const own=await open(agents[0].token);assert(await own.locator('#cn-overview-sub').isHidden());assert.equal(await own.locator('#stats .sc').first().locator('em').innerText(),'$60.00');assert.equal(await own.locator('#stats .sc').nth(3).locator('em').innerText(),'2');await own.screenshot({path:path.join(dir,'agent-own-scope.png'),fullPage:true});await own.close();
 }finally{await browser.close()}
 assert.deepEqual(errors,[]);assert.equal((await api('/api/account',200,ca.token)).account.cashCents,6000);assert.equal((await api('/api/account',200,cb.token)).account.cashCents,30000);
 if(process.env.CN_QA_CASH_AUDIT==='1'){
  const request=await api('/api/requests',201,ca.token,{kind:'DEPOSIT',amountCents:1234});
  const decision={id:request.id,decision:'APPROVE',reason:'隔离测试核对资金审批审计'};
  await api('/api/admin/requests',200,master,decision);
  const flag=path.join(dir,'reject-cash-audit');
  fs.writeFileSync(flag,'');
  try{await api('/api/admin/requests',500,master,decision)}finally{fs.unlinkSync(flag)}
  assert.equal((await api('/api/account',200,ca.token)).account.cashCents,6000);
  assert.equal((await api('/api/admin/requests',200,master)).items.find(row=>row.id===request.id).status,'REVIEWED');
  await api('/api/admin/requests',200,master,decision);
  assert.equal((await api('/api/account',200,ca.token)).account.cashCents,7234);
  const audit=(await api('/api/admin/audit?limit=100',200,master)).items.filter(row=>row.target===request.id&&row.action==='cash_request.approve');
  assert.equal(audit.length,1);assert.equal(audit[0].detail.reason,decision.reason);
  console.log('Cash approval audit failure rolls back balance, ledger and review state; retry credits and audits exactly once');
 }
 fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify({checks,errors,all,a,b,empty,subDetail},null,2));console.log('Scoped counts, funding totals, chart tooltip, filters, client drilldown and ledger reconciliation passed');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
