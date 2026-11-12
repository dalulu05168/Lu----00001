
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHmac} = require('node:crypto');
const {chromium} = require('playwright');

const base = 'http://127.0.0.1:' + process.env.CN_OPS_QA_PORT;
const output = process.env.CN_QA_SAVE_DIR;
const pages = JSON.parse(fs.readFileSync(process.env.CN_ACCEPTANCE_SOURCE, 'utf8').match(/^const replacementPages = (.+);$/m)[1]);
const password = 'FixturePass123456!';
const checks = [];
function otp(secret) {
  const bits = [...secret].map(c => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join('');
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const mac = createHmac('sha1',Buffer.from(bits.match(/.{8}/g).map(v=>parseInt(v,2)))).update(counter).digest();
  return String((mac.readUInt32BE(mac[19]&15)&0x7fffffff)%1000000).padStart(6,'0');
}
async function api(route, token, body, method=body?'POST':'GET') {
  const response = await fetch(base+route, {
    method, headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    body:body?JSON.stringify(body):undefined,
  });
  return {status:response.status, body:await response.json()};
}
function ok(result, code) {
  assert.equal(result.status,code,JSON.stringify(result.body));
  return result.body;
}
const views = {
  home:'工作台',accounts:'客户账户',orders:'交易订单',positions:'持仓资产',approvals:'资金审批',
  products:'产品与证券',documents:'客户资料审核',support:'客服与公告',settlement:'IPO 与基金复核',
  mirror:'App 镜像',permissions:'子管理员权限',audit:'操作审计',
};
const subDenied = new Set(['approvals','products','support','settlement','permissions']);
const endpoints = [
  ['me','GET'],['clients','GET'],['requests','GET'],['products','GET'],['profile-documents','GET'],
  ['support/inbox','GET'],['subaccounts','GET'],['audit','GET'],['funding-overview','GET'],
  ['product-settlement','GET'],['notifications','GET'],['announcements','GET'],
];
(async()=>{
  const masterSecret=JSON.parse(fs.readFileSync(process.env.CN_OPS_MASTER_FILE)).totpSecret;
  const master=ok(await api('/api/admin/login',null,{email:'qa-master@example.test',password,otp:otp(masterSecret)}),200).token;
  const sub=ok(await api('/api/admin/subaccounts',master,{email:'layout-owner@example.test',password}),201);
  const credentials={email:'layout-owner@example.test',password,otp:otp(sub.totpSecret)};
  ok(await api('/api/admin/activate',null,credentials),200);
  const agent=ok(await api('/api/admin/login',null,credentials),200).token;
  ok(await api('/api/auth/register',null,{email:'layout-client@example.test',password,inviteCode:sub.inviteCode}),201);
  const customer=ok(await api('/api/auth/login',null,{email:'layout-client@example.test',password}),200).token;

  const roleResults=[];
  for(const [role,token] of [['MASTER',master],['SUBADMIN',agent],['CLIENT',customer]]) {
    const result={role,routes:[]};
    for(const [route,method] of endpoints) {
      const response=await api('/api/admin/'+route,token,undefined,method);
      if(role==='CLIENT') assert.equal(response.status,403,role+' '+route);
      else if(role==='MASTER') {
        assert.equal(response.status,route==='profile-documents'?403:200,role+' '+route);
      } else {
        const denied=['requests','products','support/inbox','subaccounts','product-settlement','announcements'].includes(route);
        assert.equal(response.status,denied?403:200,role+' '+route);
      }
      result.routes.push({route,status:response.status});
    }
    roleResults.push(result);
  }
  const customerWrite=await api('/api/admin/requests',customer,{id:'00000000-0000-0000-0000-000000000000',decision:'APPROVE'});
  assert.equal(customerWrite.status,403);
  const elevate=await api('/api/admin/subaccounts',agent,{email:'illegal@example.test',password});
  assert.equal(elevate.status,403);
  checks.push('three account types obey management API boundaries and reject customer writes and subadministrator elevation');

  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const errors=[];
  const layoutResults=[];
  try {
    for(const [role,token] of [['MASTER',master],['SUBADMIN',agent],['CLIENT',customer]]) {
      for(const viewport of [{width:1440,height:1000},{width:1280,height:720},{width:390,height:844}]) {
        if(role==='CLIENT'&&viewport.width!==1440)continue;
        const page=await browser.newPage({viewport});
        page.on('pageerror',error=>errors.push({role,width:viewport.width,error:error.message}));
        page.setDefaultTimeout(12000);
        await page.addInitScript(value=>{
          if(location.href!=='about:srcdoc')localStorage.setItem('cncap.admin.session',value);
        },token);
        await page.route(base+'/**',route=>{
          const url=new URL(route.request().url());
          if(url.pathname==='/admin-next')return route.fulfill({contentType:'text/html',body:pages.adminNext});
          if(url.pathname==='/admin-compat')return route.fulfill({contentType:'text/html',body:pages.admin});
          if(url.pathname==='/logo.png')return route.fulfill({contentType:'image/png',body:fs.readFileSync(path.join(__dirname,'../web/logo.png'))});
          return route.continue();
        });
        for(const [view,title] of Object.entries(views)) {
          if(role==='CLIENT'&&view!=='home')continue;
          await page.goto(base+'/admin-next?layout='+view+'#'+view,{waitUntil:'domcontentloaded'});
          if(role==='CLIENT') {
            await page.getByRole('heading',{name:'无法验证管理员会话',exact:true}).waitFor();
            assert.equal(await page.locator('#workspace table').count(),0);
            continue;
          }
          await page.locator('#identity').filter({hasText:role==='MASTER'?'总管理员':'子管理员'}).waitFor();
          await page.waitForFunction(title=>document.getElementById('current-page')?.textContent===title&&!document.querySelector('#workspace [aria-busy=true]'),title);
          const target=page.getByRole('button',{name:title,exact:true}).first();
          assert.equal(await target.isDisabled(),role==='SUBADMIN'?subDenied.has(view):view==='documents');
          if(role==='SUBADMIN'&&subDenied.has(view))await page.getByRole('heading',{name:/权限受限|客服与公告由总管理员管理/}).waitFor();
          const state=await page.evaluate(title=>{
            const visible=node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return r.width>1&&r.height>1&&s.display!=='none'&&s.visibility!=='hidden'};
            const textNodes=[...document.querySelectorAll('body *')].filter(node=>visible(node)&&[...node.childNodes].some(child=>child.nodeType===Node.TEXT_NODE&&child.textContent.trim()));
            const bold=textNodes.filter(node=>Number(getComputedStyle(node).fontWeight)>400).map(node=>({tag:node.tagName,text:node.textContent.slice(0,45)}));
            const repeats=[...document.querySelectorAll('#workspace h1,#workspace h2,#workspace h3')].filter(node=>visible(node)&&node.textContent.trim()===title).length;
            const nav=document.querySelector('#navigation .active'),style=getComputedStyle(nav);
            return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,bold,repeats,
              navigation:{radius:style.borderRadius,color:style.backgroundColor,gradient:style.backgroundImage},
              headings:document.querySelectorAll('.topbar h1').length};
          },title);
          assert.equal(state.overflow,false,role+' '+view+' width '+viewport.width);
          assert.equal(state.repeats,0,role+' '+view+' repeated title');
          assert.equal(state.headings,1);
          assert.equal(await page.locator('.main-area > footer.disclosure').count(),0,'Admin footer must be removed');
          assert.deepEqual(state.bold,[],role+' '+view+' font');
          assert.deepEqual(state.navigation,{radius:'0px',color:'rgba(0, 0, 0, 0)',gradient:'none'});
          layoutResults.push({role,view,viewport,passed:true});
          if(['home','accounts','documents','settlement','mirror'].includes(view))
            await page.screenshot({path:path.join(output,role+'-'+viewport.width+'-'+view+'.png'),fullPage:true});
        }
        if(role==='MASTER'&&viewport.width===1440){
          await page.waitForFunction(()=>!document.getElementById('workspace').inert);
          await page.evaluate(()=>{window.qaFades=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){if(this.id==='workspace')window.qaFades.push({frames,duration:options.duration});return animate.call(this,frames,options)}});
          await page.getByRole('button',{name:'客户账户',exact:true}).first().click();
          await page.waitForFunction(()=>document.body.dataset.view==='accounts'&&!document.getElementById('workspace').inert);
          const fades=await page.evaluate(()=>window.qaFades);
          assert(fades.some(x=>x.duration===90&&x.frames.at(-1).opacity===.2));
          assert(fades.some(x=>x.duration===150&&x.frames.at(-1).opacity===1));
          await page.evaluate(()=>{const buttons=[...document.querySelectorAll('#navigation button')];buttons.find(b=>b.textContent.trim()==='产品与证券').click();buttons.find(b=>b.textContent.trim()==='操作审计').click()});
          await page.waitForFunction(()=>document.body.dataset.view==='audit'&&!document.getElementById('workspace').inert);
          assert.equal(await page.locator('#current-page').textContent(),'操作审计');
          await page.emulateMedia({reducedMotion:'reduce'});const count=await page.evaluate(()=>window.qaFades.length);
          await page.getByRole('button',{name:'客户账户',exact:true}).first().click();
          await page.waitForFunction(()=>document.body.dataset.view==='accounts'&&!document.getElementById('workspace').inert);
          assert.equal(await page.evaluate(()=>window.qaFades.length),count);
          checks.push('actual fade-out and fade-in run; rapid navigation keeps last destination; reduced-motion skips animations');
        }
        await page.close();
      }
    }
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
  checks.push('all native workspaces use regular font weight, single page title and flat navigation across desktop and phone widths');
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,checks,roleResults,layoutResults,errors},null,2));
  console.log(JSON.stringify({passed:true,roleTypes:roleResults.length,apiChecks:roleResults.reduce((n,r)=>n+r.routes.length,0)+2,layoutChecks:layoutResults.length,checks}));
})().catch(error=>{console.error(error.stack);process.exitCode=1});


