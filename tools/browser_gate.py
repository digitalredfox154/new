"""Three-engine functional checks. All API requests are intercepted; never create live leads."""
import contextlib, functools, http.server, json, os, threading, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path('artifacts');out.mkdir(exist_ok=True)
results=[];errors=[];last_page=None
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',8765),functools.partial(Handler,directory='dist'))
threading.Thread(target=server.serve_forever,daemon=True).start()
def check(name,ok):
    results.append({'name':name,'passed':bool(ok)});assert ok,name

def install_api_routes(context,leads,events,mode):
    cors={'access-control-allow-origin':'http://127.0.0.1:8765','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'content-type'}
    def lead(route,request):
        if request.method=='OPTIONS':return route.fulfill(status=204,headers=cors)
        payload=json.loads(request.post_data or '{}');leads.append(payload)
        assert payload.get('consent') is True and payload.get('consentVersion')=='2026-09-16'
        body={'error':'Временная ошибка тестового API'} if mode['fail'] else {'ok':True,'accepted':True,'id':'synthetic-lead','notification':'queued'}
        return route.fulfill(status=503 if mode['fail'] else 201,headers={**cors,'content-type':'application/json'},body=json.dumps(body))
    def event(route,request):
        if request.method=='OPTIONS':return route.fulfill(status=204,headers=cors)
        events.append(json.loads(request.post_data or '{}'));return route.fulfill(status=204,headers=cors)
    context.route('https://app.samaiconsulting.ru/api/webhooks/leads/samai-public/contact',lead)
    context.route('https://app.samaiconsulting.ru/api/webhooks/leads/samai-public/events',event)
    # No unmocked connection to the real application is permitted by this gate.
    context.route('https://app.samaiconsulting.ru/api/public/**',lambda route:route.abort())

try:
  with sync_playwright() as p:
    for engine in [x for x in os.environ.get('SAMAI_BROWSERS','chromium,firefox,webkit').split(',') if x]:
      browser=getattr(p,engine).launch()
      context=browser.new_context(viewport={'width':1440,'height':1000})
      context.add_init_script('window.__SAMAI_TEST_TRANSPORT=true')
      leads=[];events=[];mode={'fail':False};install_api_routes(context,leads,events,mode)
      context.tracing.start(screenshots=True,snapshots=True,sources=True)
      page=context.new_page();last_page=page;requests=[]
      page.on('pageerror',lambda e:errors.append(str(e)))
      page.on('request',lambda r:requests.append(r.url))
      response=page.goto('http://127.0.0.1:8765/?utm_source=ci&utm_medium=test&utm_campaign=v05&private=not-for-analytics',wait_until='load')
      check(engine+' HTTP',response.status==200)
      page.wait_for_function('window.SamaiMotion && window.SAMAI_TRACK && document.querySelector(".assembly-system")')
      check(engine+' headline','В одних руках.' in page.locator('h1').inner_text().replace('\n',' '))
      check(engine+' CTA visible',page.locator('.hero-lower a[href="#contact"]').is_visible())
      check(engine+' original logo loaded',page.locator('.brand-image').evaluate('(e)=>e.complete && e.naturalWidth > 0'))
      check(engine+' SVG route geometry',page.locator('.route-ink path[pathLength="1"]').count()==7)
      check(engine+' no external font request',not any('fonts.googleapis.com' in u or 'fonts.gstatic.com' in u for u in requests))
      check(engine+' OG title',page.locator('meta[property="og:title"]').count()==1)
      check(engine+' structured data',page.locator('script[type="application/ld+json"]').count()==1)
      check(engine+' noindex preview','noindex' in (page.locator('meta[name="robots"]').get_attribute('content') or ''))
      page.evaluate('window.SamaiMotion.replay("signal")')
      page.wait_for_function('document.querySelector("[data-assembly=\\"2\\"]").getAttribute("aria-pressed") === "true"',timeout=6000)
      check(engine+' assembly final state',True)
      page.locator('[data-assembly="0"]').click();page.wait_for_timeout(1700)
      check(engine+' manual assembly stable',page.locator('[data-assembly="0"]').get_attribute('aria-pressed')=='true')
      page.locator('.motion-toggle').first.click()
      check(engine+' motion switch',page.locator('html').get_attribute('data-motion')=='off')
      page.locator('.hero-lower a[href="#contact"]').click()
      page.locator('#name').fill('Тест сборки')
      page.locator('input[name="method"][value="email"]').check()
      page.locator('#contact-value').fill('release-check@example.invalid')
      page.locator('#company').fill('CI Test');page.locator('#task').fill('Проверка без реального лида')
      page.locator('.form-submit').click();page.wait_for_timeout(100)
      check(engine+' consent required before network',len(leads)==0 and page.locator('#consent-error').is_visible())
      page.locator('#privacy-consent').check();page.locator('.form-submit').click()
      page.wait_for_function('document.querySelector("#form-status")?.dataset.state === "success"');page.wait_for_timeout(100)
      check(engine+' accepted UI','Заявка отправлена.' in page.locator('#form-status').inner_text())
      check(engine+' one lead request',len(leads)==1)
      payload=leads[0]
      check(engine+' lead carries UTM',payload.get('utm',{}).get('source')=='ci' and payload.get('utm',{}).get('campaign')=='v05')
      check(engine+' stable idempotency key',len(payload.get('idempotencyKey',''))>=20)
      check(engine+' versioned consent',payload.get('consent') is True and payload.get('consentVersion')=='2026-09-16')
      check(engine+' no arbitrary URL query',all('not-for-analytics' not in json.dumps(x) for x in events))
      check(engine+' analytics excludes form PII',all('release-check@example.invalid' not in json.dumps(x) and 'Тест сборки' not in json.dumps(x,ensure_ascii=False) for x in events))
      check(engine+' conversion event',any(x.get('event')=='form_submit_success' for x in events))
      page.locator('.form-submit').click();page.wait_for_timeout(100)
      check(engine+' repeat accepted click creates no lead',len(leads)==1)
      mode['fail']=True
      page.locator('#name').fill('Тест ошибки');page.locator('#contact-value').fill('retry-check@example.invalid')
      page.locator('.form-submit').click();page.wait_for_function('document.querySelector("#form-status")?.dataset.state === "error"')
      check(engine+' failed data preserved',page.locator('#contact-value').input_value()=='retry-check@example.invalid')
      check(engine+' transport error visible','Заявка не отправлена.' in page.locator('#form-status').inner_text())
      failed_key=leads[-1]['idempotencyKey']
      page.locator('.form-submit').click();page.wait_for_timeout(250)
      check(engine+' retry same idempotency',leads[-1]['idempotencyKey']==failed_key)
      page.locator('#task').fill('Изменённая задача');page.locator('.form-submit').click();page.wait_for_timeout(250)
      check(engine+' changed inquiry gets new identity',leads[-1]['idempotencyKey']!=failed_key)
      for width in [360,390,640,768,1024,1440,1920]:
        page.set_viewport_size({'width':width,'height':900});page.wait_for_timeout(100)
        check(engine+' no overflow '+str(width),page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
      page.set_viewport_size({'width':390,'height':844});page.evaluate('window.scrollTo(0,0)');page.wait_for_timeout(120)
      page.locator('.mobile-menu > summary').click();check(engine+' mobile menu opens',page.locator('.mobile-menu').get_attribute('open') is not None)
      page.keyboard.press('Escape');check(engine+' escape closes menu',page.locator('.mobile-menu').get_attribute('open') is None)
      page.screenshot(path=str(out/(engine+'-mobile.png')),full_page=True)
      page.set_viewport_size({'width':1440,'height':1000});page.evaluate('window.scrollTo(0,0)');page.wait_for_timeout(120)
      page.screenshot(path=str(out/(engine+'-desktop.png')),full_page=True)
      legal=context.new_page();check(engine+' privacy page',legal.goto('http://127.0.0.1:8765/privacy.html').status==200);check(engine+' operator exists','Самай Сергей Леонидович' in legal.locator('body').inner_text());check(engine+' consent page',legal.goto('http://127.0.0.1:8765/consent.html').status==200);legal.close()
      context.tracing.stop(path=str(out/(engine+'-trace.zip')));context.close()
      reduced=browser.new_context(reduced_motion='reduce',viewport={'width':390,'height':844});page=reduced.new_page();last_page=page;page.on('pageerror',lambda e:errors.append(str(e)));page.goto('http://127.0.0.1:8765/',wait_until='load');page.wait_for_function('window.SamaiMotion');check(engine+' OS reduced motion',page.evaluate('window.SamaiMotion.mode')=='off');check(engine+' content readable',page.locator('h1').is_visible());reduced.close()
      plain=browser.new_context(java_script_enabled=False);page=plain.new_page();last_page=page;page.goto('http://127.0.0.1:8765/',wait_until='load');check(engine+' no-JS content',page.locator('h1').is_visible());check(engine+' no-JS form disabled',page.locator('.form-submit').is_disabled());check(engine+' no-JS legal link',page.locator('a[href="privacy.html"]').count()>=1);plain.close();browser.close();last_page=None
    check('No JavaScript runtime errors',not errors)
except Exception:
  errors.append(traceback.format_exc())
  if last_page:
    with contextlib.suppress(Exception):last_page.screenshot(path=str(out/'failure.png'),full_page=True)
  raise
finally:
  server.shutdown();(out/'checks.json').write_text(json.dumps({'passed':sum(x['passed'] for x in results),'checks':results,'errors':errors},ensure_ascii=False,indent=2));print(json.dumps({'checks':len(results),'errors':len(errors)}))
