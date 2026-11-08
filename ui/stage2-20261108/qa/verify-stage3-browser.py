"""Isolated Chromium stage3 UI fidelity. Does not call production APIs or databases."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'qa'/'stage3-evidence'
OUT.mkdir(exist_ok=True)
results=[]
def check(name, condition, detail=None):
    results.append({'name':name,'pass':bool(condition),'detail':detail})
    assert condition, name+': '+str(detail)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    for width,height in [(360,780),(390,844),(428,926)]:
        ctx=browser.new_context(viewport={'width':width,'height':height},is_mobile=True,has_touch=True)
        page=ctx.new_page();errors=[]
        page.on('pageerror',lambda err:errors.append(str(err)))
        page.set_content((ROOT/'手机端.html').read_text('utf8'),wait_until='domcontentloaded')
        dims=page.evaluate("""() => {let host=document.querySelector('#host'),a=host?.shadowRoot?.querySelector('.app'),r=a?.getBoundingClientRect(),css=a?getComputedStyle(a):null;
          return {x:r?.x,y:r?.y,w:r?.width,h:r?.height,border:css?.borderTopWidth,radius:css?.borderTopLeftRadius,login:!!host?.shadowRoot?.querySelector('#lg'),documentWidth:document.documentElement.scrollWidth}}""")
        check('mobile-fullscreen-'+str(width),dims['x']==0 and dims['y']==0 and dims['w']==width and dims['h']==height and dims['border']=='0px' and dims['radius']=='0px' and dims['login'] and dims['documentWidth']<=width and not errors,dims)
        if width==428:
            page.locator('#host').locator('#lu').fill('invalid-test-user')
            page.locator('#host').locator('#lpw').fill('invalid-test-password')
            button=page.locator('#host').locator('#lg')
            check('mobile-login-control',button.is_enabled())
            button.click()
            check('mobile-cannot-bypass-auth',page.locator('#host').locator('#lg').count()==1)
        ctx.close()
    ctx=browser.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce')
    page=ctx.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content((ROOT/'前台.html').read_text('utf8'),wait_until='domcontentloaded')
    cash=page.locator('[data-b="cash"]').all_text_contents()
    check('desktop-unknown-cash',bool(cash) and all(t=='—' for t in cash) and not errors,cash)
    page.locator('[data-open="m-dep"]').first.evaluate('(el)=>el.click()')
    check('desktop-funding-modal',page.locator('#m-dep').is_visible())
    ctx.close()
    ctx=browser.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce')
    page=ctx.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content((ROOT/'后台.html').read_text('utf8'),wait_until='domcontentloaded')
    ids=['over','cli','appr','fund','cat']
    check('admin-five-pages',all(page.locator('#p-'+x).count()==1 for x in ids) and not errors)
    mods=['mir','ap','det','sub','sec','ed','chat','subpass','sublock','com','cf']
    check('admin-eleven-modals',all(page.locator('#m-'+x).count()==1 for x in mods))
    check('admin-no-fake-four-approvals','—' in (page.locator('#p-appr .ph small').first.text_content() or ''))
    page.locator('[data-p="cli"]').first.evaluate('(el)=>el.click()')
    check('admin-navigation',page.locator('#p-cli').is_visible())
    ctx.close()
    browser.close()

assert len(results)==11
(OUT/'results.json').write_text(json.dumps({'results':results,'note':'Isolated browser only; backend APIs and real phone hardware not tested'},ensure_ascii=False,indent=2),encoding='utf8')
print('UI_STAGE3_BROWSER_OK '+str(len(results))+'/'+str(len(results)))
