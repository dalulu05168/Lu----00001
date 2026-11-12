

const fs=require('node:fs'),assert=require('node:assert/strict'),{createHmac}=require('node:crypto');

const {chromium,devices}=require('playwright');

const base='http://127.0.0.1:'+(process.env.CN_OPS_QA_PORT||8844);

const password='FixturePass123456!',stamp=Date.now(),a='x</script><script>window.cntest=1</script>'+stamp+'@example.test',b='qa-qixi-'+stamp+'@example.test';

const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=';

function otp(secret){

  const bits=[...secret].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join('');

  const time=Buffer.alloc(8);time.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));

  const sum=createHmac('sha1',Buffer.from(bits.match(/.{8}/g).map(x=>parseInt(x,2)))).update(time).digest();

  return String((sum.readUInt32BE(sum[19]&15)&0x7fffffff)%1000000).padStart(6,'0');

}

async function api(path,status,token,body,method=body?'POST':'GET'){

  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(path==='/api/orders'&&body?{'idempotency-key':require('node:crypto').randomUUID()}:{})},body:body?JSON.stringify(body):undefined});

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



const path=require('node:path');

const pages=JSON.parse(fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8').match(/const replacementPages = (.+);/)[1]);


(async()=>{
 const master=(await api('/api/admin/login',200,null,{email:'qa-master@example.test',password,otp:otp(JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE)).totpSecret)})).token;
 const owner=await createAgent(master,1,a),other=await createAgent(master,2,b);
 const client=await login(a);
 for(const doc of [{kind:'IDENTITY',front:image,back:image},{kind:'BANK',bankName:'Mirror QA Bank',accountNumber:'1234567890'}]){
  await api('/api/profile-documents',201,client,doc);const review=await api('/api/admin/profile-documents?'+new URLSearchParams({email:a,kind:doc.kind}),200,owner.token);
  await api('/api/admin/profile-documents',200,owner.token,{email:a,kind:doc.kind,status:'APPROVED',version:review.version},'PATCH');
 }
 const deposit=await api('/api/requests',201,client,{kind:'DEPOSIT',amountCents:100000});for(let i=0;i<2;i++)await api('/api/admin/requests',200,master,{id:deposit.id,decision:'APPROVE',expectedStatus:i===0?'PENDING':'REVIEWED'});
 const p=await api('/api/admin/products',201,master,{kind:'BULK_STOCK',name:'Apple Inc',symbol:'AAPL',market:'US',status:'PUBLISHED',discountBps:1200,holdingDays:0,minQuantity:1,tradePassword:'123456'});
 const act=(token,status,data)=>api('/api/admin/client-action',status,token,{email:a,...data});
 await act(other.token,404,{path:'/api/account',method:'GET'});
 await act(owner.token,403,{path:'/api/admin/requests',method:'POST',payload:{id:deposit.id,decision:'APPROVE'}});
 await act(owner.token,403,{path:'/api/requests',method:'POST',payload:{kind:'DEPOSIT',amountCents:10000}});
 await act(owner.token,403,{path:'/api/support',method:'GET'});
 await act(owner.token,400,{path:'https://example.com/',method:'GET'});
 const response=await act(master,201,{path:'/api/support',method:'POST',payload:{message:'Master mirror response'}});assert.equal(response.sender_role,'MASTER');
 await act(owner.token,200,{path:'/api/announcements',method:'GET'});
 await act(master,200,{path:'/api/announcements',method:'GET'});
 await act(other.token,404,{path:'/api/announcements',method:'GET'});
 await act(owner.token,403,{path:'/api/announcements',method:'POST',payload:{title:'denied'}});
 const initial=await act(owner.token,200,{path:'/api/account',method:'GET'});assert.equal(initial.account.cashCents,100000);
 const source=fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8'),pages=JSON.parse(source.match(/const replacementPages = (.+);/)[1]);
 // Isolated acceptance uses this exact candidate's policy, never a production GET.
 const policyMatch=source.match(/var CSP = (\[[\s\S]*?\])\.join/);assert(policyMatch,'Candidate CSP missing');
 const livePolicy=JSON.parse(policyMatch[1]).join('; ');
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
  await page.addInitScript(t=>{localStorage.setItem('cncap.admin.session',t);sessionStorage.setItem('cncap.admin.entry','1')},owner.token);
  let loseResponse=true;
  await page.route('**/*',async r=>{const u=new URL(r.request().url());if(u.pathname==='/api/admin/client-action'&&r.request().method()==='POST'){const data=r.request().postDataJSON();if(loseResponse&&data.path==='/api/bulk-orders'){loseResponse=false;await r.fetch();return r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Isolated response lost after commit'})});}}return u.origin!==base?r.abort():u.pathname==='/admin'?r.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':livePolicy},body:pages.admin}):r.continue()});
  page.on('response',async r=>{if(r.url().endsWith('/api/admin/client-action')&&r.request().postDataJSON()?.method==='POST')console.log('mirror mutation',r.status(),await r.text())});
  await page.goto(base+'/admin#cli',{waitUntil:'domcontentloaded'});
  const row=page.locator('#t-cli tbody tr').filter({hasText:a});await row.getByRole('button',{name:'App 镜像',exact:true}).click();
  const frame=page.frameLocator('dialog[open] iframe');await frame.locator('h1').first().waitFor();assert.equal(await frame.getByText('Delegated action forbidden',{exact:false}).count(),0);const mirrorBox=await page.locator('dialog[open] iframe').boundingBox();assert(Math.abs(mirrorBox.width-390)<1,'Mirror content should use the phone width');assert(Math.abs(mirrorBox.height-844)<1,'Mirror content should use the phone height');assert.equal(await frame.locator('body').evaluate(()=>window.cntest),undefined);await frame.locator('nav [data-go=mine]').click();await frame.locator('[data-business=products]').click();await frame.locator('[data-product]').first().click();
  await frame.locator('[data-business=bulk-buy]').click();await frame.locator('[name=quantity]').fill('1');
  await frame.locator('[name=tradePassword]').fill('123456');
  await frame.locator('form button').click();await frame.getByRole('alert').waitFor();
  assert(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('cn.mirror.pending.'))));
  await page.locator('dialog[open]>.ops-heading').getByRole('button',{name:'关闭',exact:true}).click();
  await row.getByRole('button',{name:'App 镜像',exact:true}).click();
  await frame.locator('nav [data-go=mine]').click();await frame.locator('[data-business=products]').click();await frame.locator('[data-product]').first().click();await frame.locator('[data-business=bulk-buy]').click();await frame.locator('[name=quantity]').fill('1');await frame.locator('[name=tradePassword]').fill('123456');await frame.locator('form button').click();await frame.getByRole('status').waitFor();
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('cn.mirror.pending.'))),false);
  await frame.locator('nav [data-go=trade]').click();
  await frame.getByText('AAPL',{exact:false}).first().waitFor();
  const bought=await act(owner.token,200,{path:'/api/account',method:'GET'});
  assert.equal(bought.account.cashCents,69139);assert.equal(bought.orders.length,1);
  await page.screenshot({path:require('path').join(process.env.CN_QA_SAVE_DIR,'subaccount-operable-mirror.png'),fullPage:true});
  await page.unrouteAll({behavior:'ignoreErrors'});await page.close();
 }finally{for(const c of browser.contexts())for(const p of c.pages())await p.unrouteAll({behavior:'ignoreErrors'});await browser.close()}
 const order={path:'/api/orders',method:'POST',key:'mirror-sell',payload:{market:'US',symbol:'AAPL',side:'SELL',quantity:1}};
 const sold=await act(master,201,order);assert(sold.order.id);
 await act(master,200,order);
 assert.equal((await act(owner.token,200,{path:'/api/account',method:'GET'})).account.cashCents,104208);
 const blockedFile=require('path').join(process.env.CN_QA_SAVE_DIR,'reject-delegated-audit');fs.writeFileSync(blockedFile,'1');
 const buy={path:'/api/bulk-orders',method:'POST',key:'mirror-audit-rollback',payload:{productId:p.id,quantity:1,side:'BUY',tradePassword:'123456',expectedVersion:p.version,expectedPriceCents:30861}};
 await act(owner.token,500,buy);fs.unlinkSync(blockedFile);
 const after=await act(owner.token,200,{path:'/api/account',method:'GET'});assert.equal(after.account.cashCents,104208);assert.equal(after.orders.length,2);
 fs.writeFileSync(require('path').join(process.env.CN_QA_SAVE_DIR,'results.json'),JSON.stringify({passed:true,mirrorBrowserBuy:true,masterSell:true,scopeIsolation:true,subaccountFundsDenied:true,auditFailureRollback:true,snapshot:after},null,2));
 console.log('Operable current mobile mirror: subaccount buy, master sell, scope isolation, funding restrictions, audit rollback passed');
})().catch(e=>{console.error(e.stack);process.exitCode=1});

