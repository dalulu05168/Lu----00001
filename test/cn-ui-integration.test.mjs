import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const source=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('existing customer and administrator login forms remain available',async()=>{
  const customer=await source('web/index.html'),admin=await source('web/admin.html');
  assert.match(customer,/id="authForm"/);
  assert.match(customer,/id="email"/);
  assert.match(customer,/id="password"/);
  assert.match(admin,/id="adminLoginForm"/);
  assert.match(admin,/id="adminOtp"/);
  assert.match(customer,/cn-entry-redirect\.mjs/);
  assert.match(admin,/cn-admin-entry-redirect\.mjs/);
});

test('new desktop terminal preserves customer dialogs and validates account session',async()=>{
  const html=await source('web/cn-terminal.html'),js=await source('web/cn-terminal-bridge.mjs');
  for(const id of ['m-dep','m-id','m-bank','m-req','m-trade','m-ord']){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.match(js,/sessionStorage\.getItem\('gsp_token'\)/);
  assert.match(js,/fetch\('\/api\/account'/);
  assert.match(html,/window\.CN_SYNC_ACCOUNT/);
});

test('admin redesign removes static client/order fixtures while retaining current API access',async()=>{
  const html=await source('web/cn-admin.html'),js=await source('web/cn-admin-bridge.mjs');
  assert.doesNotMatch(html,/linyi05168|chenbei05168|a078db2d|1000000/);
  assert.doesNotMatch(html,/<script>\s*\(function\(\)/);
  for(const id of ['cn-client-rows','cn-subadmin-rows','cn-listing-rows','cn-create-subadmin','cn-create-listing']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  for(const route of ['me','clients','subaccounts','listings'])assert.ok(js.includes("api('"+route+"'"),route);
  assert.match(js,/role!=='MASTER'/);
  assert.match(js,/api\('listings',\{method:'PATCH'/);
});

test('admin management panels populate from authorized API without bundled account records',async()=>{
  const html=await source('web/cn-admin.html');
  const old={document:globalThis.document,sessionStorage:globalThis.sessionStorage,location:globalThis.location,history:globalThis.history,fetch:globalThis.fetch};
  const dom=new JSDOM(html,{url:'https://example.test/cn-admin.html'});
  const calls=[];
  const listings=[{id:'12345678-1234-1234-1234-123456789012',itemType:'STOCK',market:'US',symbol:'AA',name:'Alcoa',status:'DRAFT'}];
  const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
  try{
    Object.assign(globalThis,{document:dom.window.document,sessionStorage:dom.window.sessionStorage,location:dom.window.location,history:dom.window.history});
    globalThis.sessionStorage.setItem('gsp_admin_token','fake-ci-admin-token');
    globalThis.fetch=async(url,opts={})=>{
      calls.push({url,method:opts.method||'GET',headers:opts.headers});
      assert.equal(opts.headers.authorization,'Bearer fake-ci-admin-token');
      if(url==='/api/admin/me')return json(200,{role:'MASTER'});
      if(url==='/api/admin/clients')return json(200,{items:[{email:'test@example.test',id:'client-id-1',subadmin_user_id:'admin-id-2',created_at:'2026-01-01T00:00:00Z'}]});
      if(url==='/api/admin/subaccounts')return json(200,{items:[{email:'staff@example.test',uses:2,max_uses:100,twofa_confirmed_at:'2026-01-01T00:00:00Z'}]});
      if(url==='/api/admin/listings'){
        if(opts.method==='PATCH'){
          const b=JSON.parse(opts.body);listings[0].status=b.status;return json(200,{id:b.id,status:b.status});
        }
        return json(200,{items:listings});
      }
      throw new Error('Unknown requested endpoint: '+url);
    };
    await import('../web/cn-admin-bridge.mjs');
    for(let i=0;i<40&&dom.window.document.getElementById('cn-count-clients').textContent==='—';i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(dom.window.document.getElementById('cn-count-clients').textContent,'1');
    assert.equal(dom.window.document.getElementById('cn-count-subadmins').textContent,'1');
    assert.equal(dom.window.document.getElementById('cn-count-listings').textContent,'1');
    assert.match(dom.window.document.getElementById('cn-client-rows').textContent,/test@example\.test/);
    assert.doesNotMatch(dom.window.document.body.textContent,/linyi05168/);
    assert.equal(dom.window.document.getElementById('cn-create-subadmin').hidden,false);
    dom.window.document.querySelector('.tn[data-p="cat"]').click();
    assert.equal(dom.window.document.getElementById('p-cat').hidden,false);
    const publish=dom.window.document.querySelector('#cn-listing-rows button');
    assert.ok(publish);publish.click();
    for(let i=0;i<40&&listings[0].status!=='PUBLISHED';i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(listings[0].status,'PUBLISHED');
    assert.ok(calls.some(x=>x.method==='PATCH'));
  }finally{
    for(const [key,value] of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
    dom.window.close();
  }
});

test('US vendor chart integration is unchanged and includes AA, NEM',async()=>{
  const chart=await source('web/stock-chart.mjs');
  assert.match(chart,/s3\.tradingview\.com/);
  assert.match(chart,/"US:AA": "NYSE:AA"/);
  assert.match(chart,/"US:NEM": "NYSE:NEM"/);
  assert.match(await source('web/cn-terminal-bridge.mjs'),/mountStockChart/);
});
