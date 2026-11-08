from pathlib import Path
from playwright.sync_api import sync_playwright
BASE=Path(__file__).resolve().parents[1]
OUT=Path(__file__).resolve().parent/'screenshots'
OUT.mkdir(exist_ok=True)
from bs4 import BeautifulSoup
import threading, http.server, functools
httpd=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(BASE)))
threading.Thread(target=httpd.serve_forever,daemon=True).start()
PORT=httpd.server_address[1]


def capture(p,context,label,sz=(1440,900)):
 page=context.new_page();page.set_viewport_size({'width':sz[0],'height':sz[1]}); errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 html=p.read_text('utf-8')
 if p.name=='前台.html':
  needle="$('balref').onclick=function(){loadData().then(function(){toast('数据已刷新')})};\n})();"
  assert html.count(needle)==1
  hook="$('balref').onclick=function(){loadData().then(function(){toast('数据已刷新')})};\nwindow.__uiTest={snapshot:function(d){clearSnapshot();var v=safe(d);Object.keys(v).forEach(function(k){HAVE[k]=true});Object.assign(DATA,v);DATA_READY=Object.keys(HAVE).length>0;renderAll()},fail:async function(status){var saved=window.fetch,oldApi=API;API='https://test.invalid';window.fetch=function(){return Promise.resolve({ok:false,status:status})};await loadData();window.fetch=saved;API=oldApi},state:function(){return{ready:DATA_READY,fields:Object.keys(HAVE)}}};\n})();"
  html=html.replace(needle,hook)
 page.set_content(html,wait_until='domcontentloaded',timeout=45000)
 page.wait_for_timeout(300)
 path=OUT/(label+'.png');page.screenshot(path=str(path),full_page=False)
 return page,errors

def front_data(page):
 return page.evaluate('''() => ({cash:[...document.querySelectorAll('[data-b="cash"]')].map(e=>e.textContent),total:[...document.querySelectorAll('[data-b="total"]')].map(e=>e.textContent),cost:document.querySelector('[data-b="cost"]').textContent,realized:document.querySelector('[data-b="realized"]').textContent,nord:document.querySelector('[data-b="nord"]').textContent,order:document.querySelector('#tb-ord').textContent,hold:document.querySelector('#tb-hold').textContent,ready:typeof DATA_READY === 'boolean'?DATA_READY:null,has:typeof HAVE === 'object'?HAVE:null})''')

results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 # Test baseline initial offline front
 c=browser.new_context();page,errors=capture(BASE/'前台.html',c,'front-offline'); d=front_data(page)
 print('FRONT off',d,'errors',errors)
 assert d['cash'][0]=='—' and d['total'][0]=='—' and d['realized']=='—'
 assert '数据未同步' in d['order'] and '数据未同步' in d['hold']
 assert not errors, errors
 results.append('front offline unknown PASS');page.close();c.close()
 # On page under file:// evaluate isolated response directly through application parsing + binding (not backend)
 for desc,api_payload,expected in [
   ('empty',{},'—'),('zero',{'acct':'1234','cashOverride':0,'realizedPnl':0,'totalAssets':0,'orders':[],'holds':[],'reqs':[],'watch':[]},'0.00'),
   ('positive',{'acct':'1234','cashOverride':1250.5,'totalAssets':1500.75,'realizedPnl':-14.25,'orders':[],'holds':[],'reqs':[],'watch':[]},'1,250.50')]:
  c=browser.new_context();page,errors=capture(BASE/'前台.html',c,'front-'+desc)
  # use safe() processing and data binding in isolated Chromium only, no network or database calls
  page.evaluate('''(payload)=>window.__uiTest.snapshot(payload)''',api_payload)
  d=front_data(page);print('FRONT',desc,d,'errors',errors)
  assert d['cash'][0]==expected, (desc,d)
  assert d['total'][0]=='—' if desc=='empty' else d['total'][0]==('0.00' if desc=='zero' else '1,500.75')
  assert d['realized']==('—' if desc=='empty' else '0.00' if desc=='zero' else '-14.25')
  assert ('无符合条件的记录' in d['order'])== (desc !='empty')
  assert not errors, errors
  results.append('front isolated '+desc+' snapshot PASS');page.close();c.close()
 # Test genuine loadData() failure status using stubbed FETCH-only in isolation; there is no actual backend.
 for status in [401,503]:
  c=browser.new_context();page,errors=capture(BASE/'前台.html',c,'front-'+str(status))
  d=page.evaluate('''async (status)=>{await window.__uiTest.fail(status);return {cash:document.querySelector('[data-b="cash"]').textContent,orders:document.querySelector('#tb-ord').textContent,ready:window.__uiTest.state().ready}}''',status)
  print('FRONT ERROR',status,d,errors)
  assert d['cash']=='—' and '数据未同步' in d['orders'] and d['ready']==False
  assert not errors,errors
  results.append('front '+str(status)+' isolated failure PASS');page.close();c.close()
 # Independent mobile and admin may boot in unsupported context; assert no pageerrors and functional button structure remains
 for name,szs in [('手机端.html',[(390,844),(428,926)]),('后台.html',[(1440,900)])]:
  for width,height in szs:
   c=browser.new_context();page,errors=capture(BASE/name,c,name.split('.')[0]+'-'+str(width),(width,height))
   print(name,width,'title',page.title(),'errors',errors,'shadow',page.evaluate('''() => {let a=document.querySelector('#mirror');return a?.shadowRoot ? {buttons:a.shadowRoot.querySelectorAll('button').length,app:!!a.shadowRoot.querySelector('#app')} : null}'''))
   assert not errors,errors
   results.append(name+' '+str(width)+'px render PASS');page.close();c.close()
 browser.close()
print('RESULTS:',len(results),results)
