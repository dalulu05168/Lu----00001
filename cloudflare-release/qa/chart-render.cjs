

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
 const client=(await api('/api/auth/login',200,null,{email:'qa-desktop@example.test',password})).token;
 const source=fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE,'utf8'),pages=JSON.parse(source.match(/const replacementPages = (.+);/)[1]);
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const results=[];
 try{for(const kind of ['desktop','mobile']){
  const p=await browser.newPage(kind==='mobile'?devices['iPhone 13']:{viewport:{width:1440,height:900}});
  p.setDefaultTimeout(35000);
  await p.addInitScript(t=>{localStorage.setItem('cncap.session',t);sessionStorage.setItem('cncap.mobile.entry','1')},client);
  await p.route(base+'/**',r=>new URL(r.request().url()).pathname==='/'?r.fulfill({contentType:'text/html',body:pages[kind]}):r.continue());
  await p.goto(base+'/',{waitUntil:'domcontentloaded'});
  if(kind==='mobile')await p.locator('[data-a=tab][data-v=market]').click();
  let frame,painted=false;
  for(let n=0;n<35;n++){
   for(const candidate of p.frames().filter(f=>/tradingview/.test(f.url()))){
    const visible=await candidate.evaluate(()=>({canvases:[...document.querySelectorAll('canvas')].filter(c=>c.width>200&&c.height>100).length,text:document.body?.innerText||''})).catch(()=>null);
    if(visible?.canvases>0&&/SPDR|SPY|ETF/.test(visible.text)){frame=candidate;painted=true;break;}
   }
   if(painted)break;
   await p.waitForTimeout(1000);
  }
  await p.screenshot({path:require('path').join(process.env.CN_QA_SAVE_DIR,kind+'-chart.png'),fullPage:true});
  results.push({kind,frame:frame?.url().split('?')[0],painted});
  if(!painted)for(const f of p.frames())console.log(await f.evaluate(()=>({url:location.origin,canvases:[...document.querySelectorAll('canvas')].map(c=>[c.width,c.height]),text:document.body?.innerText?.slice(0,160)})).catch(()=>({error:true})));
  assert(painted,kind+' TradingView did not render chart');
  await p.unrouteAll({behavior:'ignoreErrors'});await p.close();
 }}finally{await browser.close()}
 fs.writeFileSync(require('path').join(process.env.CN_QA_SAVE_DIR,'results.json'),JSON.stringify(results,null,2));
 console.log('Desktop and mobile TradingView external chart canvas and symbol verified');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
