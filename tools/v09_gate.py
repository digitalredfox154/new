"""Focused v09 trust, responsive typography and fail-closed form checks."""
import functools, http.server, json, os, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

out=Path('artifacts');out.mkdir(exist_ok=True)
server=http.server.ThreadingHTTPServer(('127.0.0.1',8767),functools.partial(http.server.SimpleHTTPRequestHandler,directory='dist'))
threading.Thread(target=server.serve_forever,daemon=True).start()
checks=[]
def check(name,value,detail=None):
    checks.append({'name':name,'passed':bool(value),'detail':detail});assert value,f'{name}: {detail}'
def last_line_words(locator):
    return locator.evaluate('''el=>{const n=el.firstChild;if(!n||n.nodeType!==Node.TEXT_NODE)return 0;const words=[...n.data.matchAll(/\\S+/g)].map(m=>{const r=document.createRange();r.setStart(n,m.index);r.setEnd(n,m.index+m[0].length);return {word:m[0],top:Math.round(r.getBoundingClientRect().top)};});const last=Math.max(...words.map(w=>w.top));return words.filter(w=>Math.abs(w.top-last)<=2).length;}''')
try:
  with sync_playwright() as p:
    for engine in [x for x in os.environ.get('SAMAI_BROWSERS','chromium,firefox,webkit').split(',') if x]:
      print(json.dumps({'engine':engine,'state':'starting'}),flush=True)
      browser=getattr(p,engine).launch()
      page=browser.new_page(viewport={'width':1440,'height':1000})
      errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
      response=page.goto('http://127.0.0.1:8767/',wait_until='load')
      page.wait_for_function('window.SamaiV08 && window.SAMAI_TRACK')
      check(engine+' HTTP',response.status==200)
      check(engine+' v09 build marker',page.locator('meta[name="samai-build"]').get_attribute('content').startswith('09-ci-'))
      check(engine+' evidence section',page.locator('#evidence-heading').count()==1)
      check(engine+' evidence items',page.locator('.evidence-list article').count()==3)
      check(engine+' production form enabled',not page.locator('.form-submit').is_disabled())
      check(engine+' fine print readable',float(page.locator('.form-fineprint').first.evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)'))>=12)
      check(engine+' no runtime errors',not errors,errors)
      page.locator('#evidence-heading').scroll_into_view_if_needed();page.wait_for_timeout(120)
      page.screenshot(path=str(out/(engine+'-v09-desktop.png')))
      for width in [320,390,430]:
        page.set_viewport_size({'width':width,'height':844});page.evaluate('window.scrollTo(0,0)');page.wait_for_timeout(80)
        toggle=page.locator('.motion-toggle').bounding_box()
        check(engine+f' motion target {width}',toggle and toggle['width']>=44 and toggle['height']>=44,toggle)
        words=last_line_words(page.locator('#situation-heading'))
        check(engine+f' balanced situation heading {width}',words>=2,{'lastLineWords':words})
        check(engine+f' no mobile overflow {width}',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
      page.set_viewport_size({'width':390,'height':844});page.locator('#evidence-heading').scroll_into_view_if_needed();page.wait_for_timeout(120)
      page.locator('.mobile-leadbar').evaluate('(e)=>e.hidden=true')
      page.screenshot(path=str(out/(engine+'-v09-mobile.png')))
      blocked=browser.new_context(viewport={'width':390,'height':844})
      blocked.route('**/assets/v05.*.js',lambda route:route.abort())
      fail_page=blocked.new_page();fail_page.goto('http://127.0.0.1:8767/',wait_until='domcontentloaded',timeout=10000)
      print(json.dumps({'engine':engine,'state':'fail-closed-page-loaded'}),flush=True)
      check(engine+' form fails closed without transport',fail_page.locator('.form-submit').is_disabled())
      print(json.dumps({'engine':engine,'state':'checks-passed'}),flush=True)
      browser.close()
      print(json.dumps({'engine':engine,'state':'closed'}),flush=True)
finally:
  server.shutdown()
  (out/'v09-checks.json').write_text(json.dumps({'passed':sum(x['passed'] for x in checks),'checks':checks},ensure_ascii=False,indent=2),encoding='utf-8')
  print(json.dumps({'checks':len(checks)}))
