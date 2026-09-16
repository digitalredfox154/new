"""Focused v08 checks. General form/browser coverage remains in browser_gate.py."""
import functools, http.server, json, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

out=Path('artifacts');out.mkdir(exist_ok=True)
server=http.server.ThreadingHTTPServer(('127.0.0.1',8766),functools.partial(http.server.SimpleHTTPRequestHandler,directory='dist'))
threading.Thread(target=server.serve_forever,daemon=True).start()
checks=[]
def check(name,value,detail=None):
    checks.append({'name':name,'passed':bool(value),'detail':detail});assert value,f'{name}: {detail}'
try:
  with sync_playwright() as p:
    for engine in ['chromium','firefox','webkit']:
      browser=getattr(p,engine).launch()
      page=browser.new_page(viewport={'width':1440,'height':1000})
      errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
      response=page.goto('http://127.0.0.1:8766/',wait_until='load')
      check(engine+' HTTP',response.status==200)
      page.wait_for_function('window.SamaiV08 && document.querySelector(".hero-v08-field") && document.querySelector(".v08-format-selector")')
      check(engine+' v08 runtime',page.evaluate('window.SamaiV08.version')=='8.0.0')
      check(engine+' cinematic field',page.locator('.hero-v08-field').count()==1)
      check(engine+' threshold',page.locator('.v08-threshold').count()==1)
      check(engine+' system labels',page.locator('.v08-system-labels').count()==1)
      check(engine+' prefooter',page.locator('.v08-prefooter').count()==1)
      title=page.locator('[data-title-line="1"]').bounding_box();plate=page.locator('.plate-front').bounding_box()
      clear=bool(title and plate and title['x']+title['width'] <= plate['x']-4)
      check(engine+' headline clear of visible logo plate',clear,{'title':title,'plate':plate})
      tabs=page.locator('[data-v08-format]')
      check(engine+' format selector tabs',tabs.count()==3)
      check(engine+' management selected',tabs.nth(1).get_attribute('aria-selected')=='true')
      tabs.nth(0).click();page.wait_for_timeout(120)
      check(engine+' consulting selector works',page.locator('.service[data-v08-active="true"]').count()==1 and tabs.nth(0).get_attribute('aria-selected')=='true')
      tabs.nth(2).click();page.wait_for_timeout(120)
      check(engine+' director selector works',tabs.nth(2).get_attribute('aria-selected')=='true')
      page.evaluate('window.scrollTo(0, document.querySelector("#process").offsetTop + 900)');page.wait_for_timeout(240)
      check(engine+' process meter',page.locator('.v08-process-meter i').count()==4)
      check(engine+' no desktop overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
      check(engine+' no runtime errors',not errors,errors)
      page.set_viewport_size({'width':390,'height':844});page.goto('http://127.0.0.1:8766/',wait_until='load');page.wait_for_function('window.SamaiV08')
      check(engine+' mobile selector hidden',page.locator('.v08-format-selector').evaluate('(e)=>getComputedStyle(e).display')=='none')
      check(engine+' native services preserved',page.locator('.service').count()==3)
      check(engine+' mobile prefooter',page.locator('.v08-prefooter').is_visible())
      check(engine+' no mobile overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
      browser.close()
finally:
  server.shutdown()
  (out/'v08-checks.json').write_text(json.dumps({'passed':sum(x['passed'] for x in checks),'checks':checks},ensure_ascii=False,indent=2),encoding='utf-8')
  print(json.dumps({'checks':len(checks)}))
