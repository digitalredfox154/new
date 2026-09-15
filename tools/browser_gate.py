"""Functional release gate. All form tests use a local preview and fictitious data."""
import contextlib, functools, http.server, json, threading, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
out = Path('artifacts'); out.mkdir(exist_ok=True)
results = []; errors = []; last_page = None
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), functools.partial(Handler, directory='dist'))
threading.Thread(target=server.serve_forever, daemon=True).start()
def check(name, ok):
    results.append({'name': name, 'passed': bool(ok)})
    assert ok, name
try:
    with sync_playwright() as p:
        for engine in ['chromium', 'firefox']:
            browser = getattr(p, engine).launch()
            context = browser.new_context(viewport={'width': 1440, 'height': 1000})
            context.tracing.start(screenshots=True, snapshots=True, sources=True)
            page = context.new_page(); last_page = page
            page.on('pageerror', lambda e: errors.append(str(e)))
            response = page.goto('http://127.0.0.1:8765/', wait_until='load')
            check(engine + ' HTTP', response.status == 200)
            page.wait_for_function('window.SamaiMotion && document.querySelector(".assembly-system")')
            check(engine + ' headline', page.locator('h1').inner_text().replace('\n', ' ').find('В одних руках.') >= 0)
            check(engine + ' CTA visible', page.locator('.hero-lower a[href="#contact"]').is_visible())
            check(engine + ' original logo loaded', page.locator('.brand-image').evaluate('(e)=>e.complete && e.naturalWidth > 0'))
            check(engine + ' seven SVG routes normalized', page.locator('.route-ink path[pathLength="1"]').count() == 7)
            page.evaluate('window.SamaiMotion.replay("signal")')
            page.wait_for_function('document.querySelector("[data-assembly=\\"2\\"]").getAttribute("aria-pressed") === "true"', timeout=6000)
            check(engine + ' assembly reaches final state', True)
            page.locator('[data-assembly="0"]').click()
            page.wait_for_timeout(1700)
            check(engine + ' manual selection stable', page.locator('[data-assembly="0"]').get_attribute('aria-pressed') == 'true')
            page.locator('.motion-toggle').first.click()
            check(engine + ' motion switch', page.locator('html').get_attribute('data-motion') == 'off')
            page.evaluate('window.scrollTo(0,0)'); page.wait_for_timeout(150)
            page.screenshot(path=str(out / (engine + '-desktop.png')), full_page=True)
            posts = []
            page.on('request', lambda r: posts.append(r.url) if r.method == 'POST' else None)
            page.locator('.hero-lower a[href="#contact"]').click()
            page.locator('#name').fill('Тест сборки')
            page.locator('input[name="method"][value="email"]').check()
            page.locator('#contact-value').fill('release-check@example.invalid')
            page.locator('.form-submit').click()
            check(engine + ' honest demo form', 'не отправлена' in page.locator('#form-status').inner_text())
            check(engine + ' no form data transmitted', len(posts) == 0)
            for width in [360, 390, 640, 768, 1024, 1440, 1920]:
                page.set_viewport_size({'width': width, 'height': 900})
                page.wait_for_timeout(150)
                check(engine + ' no overflow ' + str(width), page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
            page.set_viewport_size({'width': 390, 'height': 844})
            page.evaluate('window.scrollTo(0,0)'); page.wait_for_timeout(150)
            page.locator('.mobile-menu > summary').click()
            check(engine + ' mobile menu opens', page.locator('.mobile-menu').get_attribute('open') is not None)
            page.keyboard.press('Escape')
            check(engine + ' escape closes menu', page.locator('.mobile-menu').get_attribute('open') is None)
            page.screenshot(path=str(out / (engine + '-mobile.png')), full_page=True)
            context.tracing.stop(path=str(out / (engine + '-trace.zip')))
            context.close()
            reduced = browser.new_context(reduced_motion='reduce', viewport={'width': 390, 'height': 844})
            page = reduced.new_page(); last_page = page
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto('http://127.0.0.1:8765/', wait_until='load')
            page.wait_for_function('window.SamaiMotion')
            check(engine + ' OS reduced motion', page.evaluate('window.SamaiMotion.mode') == 'off')
            check(engine + ' reduced motion content readable', page.locator('h1').is_visible())
            reduced.close()
            plain = browser.new_context(java_script_enabled=False)
            page = plain.new_page(); last_page = page
            page.goto('http://127.0.0.1:8765/', wait_until='load')
            check(engine + ' no-JS content visible', page.locator('h1').is_visible())
            check(engine + ' no-JS form remains disabled', page.locator('.form-submit').is_disabled())
            plain.close(); browser.close(); last_page = None
        check('No JavaScript runtime errors', not errors)
except Exception:
    errors.append(traceback.format_exc())
    if last_page:
        with contextlib.suppress(Exception): last_page.screenshot(path=str(out / 'failure.png'), full_page=True)
    raise
finally:
    server.shutdown()
    (out / 'checks.json').write_text(json.dumps({'passed': sum(x['passed'] for x in results), 'checks': results, 'errors': errors}, ensure_ascii=False, indent=2))
    print(json.dumps({'checks': len(results), 'errors': len(errors)}))
