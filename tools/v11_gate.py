"""Focused v11 trust, conversion and responsive-layout checks."""
import functools
import http.server
import json
import os
import re
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright


out = Path('artifacts')
out.mkdir(exist_ok=True)
server = http.server.ThreadingHTTPServer(
    ('127.0.0.1', 8768),
    functools.partial(http.server.SimpleHTTPRequestHandler, directory='dist'),
)
threading.Thread(target=server.serve_forever, daemon=True).start()
checks = []


def check(name, value, detail=None):
    checks.append({'name': name, 'passed': bool(value), 'detail': detail})
    assert value, f'{name}: {detail}'


try:
    with sync_playwright() as playwright:
        engines = [item for item in os.environ.get('SAMAI_BROWSERS', 'chromium,firefox,webkit').split(',') if item]
        for engine in engines:
            print(json.dumps({'engine': engine, 'state': 'starting'}), flush=True)
            browser = getattr(playwright, engine).launch(timeout=15000)
            page = browser.new_page(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
            page.set_default_timeout(10000)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            response = page.goto('http://127.0.0.1:8768/', wait_until='load', timeout=15000)
            page.wait_for_function('window.SamaiV08 && window.SAMAI_TRACK')
            check(engine + ' HTTP', response.status == 200)
            marker = page.locator('meta[name="samai-build"]').get_attribute('content') or ''
            check(engine + ' v11 build marker', bool(re.fullmatch(r'11-ci-[0-9a-f]{12}', marker)), marker)
            check(engine + ' decision section', page.locator('#decision-heading').count() == 1)
            check(engine + ' decision steps', page.locator('.decision-steps article').count() == 3)
            check(engine + ' honest strategy boundary', 'не обещаем' in page.locator('.decision-intro').inner_text().lower())
            check(engine + ' concise form intro', page.locator('#form-intro').inner_text() == 'Оставьте имя и удобный контакт. Ответит руководитель проекта.')
            check(engine + ' no runtime errors', not errors, errors)

            decision = page.locator('.decision-panel')
            decision.scroll_into_view_if_needed()
            page.wait_for_timeout(120)
            cta = page.locator('.decision-cta')
            cta.focus()
            outline = cta.evaluate('(element) => getComputedStyle(element).outlineStyle')
            check(engine + ' visible CTA focus', outline != 'none', outline)
            cta.click()
            check(engine + ' CTA service prefill', page.locator('#service-value').input_value() == 'Первичный разбор задачи')

            page.set_viewport_size({'width': 1440, 'height': 1000})
            page.locator('#decision-heading').scroll_into_view_if_needed()
            page.wait_for_timeout(80)
            check(engine + ' no desktop overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
            page.locator('.decision-panel').screenshot(path=str(out / (engine + '-v11-desktop.png')))

            for width in [320, 390, 430]:
                page.set_viewport_size({'width': width, 'height': 844})
                page.locator('#decision-heading').scroll_into_view_if_needed()
                page.wait_for_timeout(80)
                bounds = cta.bounding_box()
                check(engine + f' mobile CTA target {width}', bounds and bounds['height'] >= 48, bounds)
                body_size = float(page.locator('.decision-steps p').first.evaluate('(element) => parseFloat(getComputedStyle(element).fontSize)'))
                check(engine + f' readable decision copy {width}', body_size >= 13.5, body_size)
                check(engine + f' no mobile overflow {width}', page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))

            page.set_viewport_size({'width': 390, 'height': 844})
            page.locator('#decision-heading').scroll_into_view_if_needed()
            page.wait_for_timeout(80)
            page.locator('.mobile-leadbar').evaluate('(element) => element.hidden = true')
            page.locator('.decision-panel').screenshot(path=str(out / (engine + '-v11-mobile.png')))
            browser.close()
            print(json.dumps({'engine': engine, 'state': 'checks-passed'}), flush=True)
finally:
    server.shutdown()
    (out / 'v11-checks.json').write_text(
        json.dumps({'passed': sum(item['passed'] for item in checks), 'checks': checks}, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )
    print(json.dumps({'checks': len(checks)}))
