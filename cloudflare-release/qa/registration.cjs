const fs=require('fs'),a=require('assert/strict'),{createHmac}=require('crypto'),{chromium,devices}=require('playwright');
const base='http://127.0.0.1:'+process.env.CN_OPS_QA_PORT,password='FixturePass123456!',stamp=Date.now();
function otp(s){const bits=[...s].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join('');const t=Buffer.alloc(8);t.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac('sha1',Buffer.from(bits.match(/.{8}/g).map(x=>parseInt(x,2)))).update(t).digest();return String((h.readUInt32BE(h[19]&15)&0x7fffffff)%1000000).padStart(6,'0')}
async function api(path,status,data,token){const r=await fetch(base+path,{method:data?'POST':'GET',headers:{'content-type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined});const j=await r.json();a.equal(r.status,status,path+' '+(j.error||''));return j}
(async()=>{
 const master=(await api('/api/admin/login',200,{email:'qa-master@example.test',password,otp:otp(JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE)).totpSecret)})).token;
 const email='qa-register-agent-'+stamp+'@example.test',agent=await api('/api/admin/subaccounts',201,{email,password},master),auth={email,password,otp:otp(agent.totpSecret)};
 await api('/api/admin/activate',200,auth);const agentToken=(await api('/api/admin/login',200,auth)).token;
 const pages=JSON.parse(fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8').match(/const replacementPages = (.+);/)[1]);
 const browser=await chromium.launch({executablePath:process.env.CN_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{for(const [kind,opts] of [['desktop',{}],['mobile',devices['iPhone 13']]]){
  const p=await browser.newPage(opts);const customer='qa-register-'+kind+'-'+stamp+'@example.test';
  await p.route(base+'/**',r=>{const path=new URL(r.request().url()).pathname;if(path==='/api/registration-policy')return r.fulfill({json:{inviteRequired:true}});if(r.request().resourceType()==='document')return r.fulfill({contentType:'text/html',body:path==='/login'?pages.login:pages[kind]});return r.continue()});
  if(kind==='mobile'){
   await p.goto(base+'/');await p.locator('[data-auth=register]').click();
   await p.locator('[name=email]').fill(customer);await p.locator('[name=password]').fill(password);await p.locator('[name=inviteCode]').fill(agent.inviteCode);
   const response=p.waitForResponse(r=>r.url().endsWith('/api/auth/register'));await p.locator('#auth-form button').click();a.equal((await response).status(),201);
   await p.locator('#login-form').waitFor();
   await p.locator('[name=password]').fill(password);await p.locator('#login-form button').click();await p.locator('nav [data-go=mine]').waitFor();
   const clients=(await api('/api/admin/clients',200,null,agentToken)).items;a(clients.some(x=>x.email===customer));
   console.log('Current mobile registration, explicit login and invite attribution passed');
   await p.unrouteAll({behavior:'ignoreErrors'});await p.close();continue;
  }
  await p.goto(base+'/login');
  await p.locator('[data-tab=register]').click();await p.locator('#regEmail').fill(customer);await p.locator('#regPassword').fill(password);await p.locator('#inviteCode').fill(agent.inviteCode);
  const [r]=await Promise.all([p.waitForResponse(x=>x.url().endsWith('/api/auth/register'),{timeout:8000}),p.locator('#regBtn').click()]);a.equal(r.status(),201);
  await p.waitForURL('**/index.html');await p.waitForFunction(()=>Boolean(localStorage.getItem('cncap.session')));
  const clients=(await api('/api/admin/clients',200,null,agentToken)).items;a(clients.some(x=>x.email===customer));console.log(kind+' registration form, automatic login and invite attribution passed');
  await p.unrouteAll({behavior:'ignoreErrors'});await p.close();
 }}finally{for(const context of browser.contexts())for(const page of context.pages())await page.unrouteAll({behavior:'ignoreErrors'});await browser.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
