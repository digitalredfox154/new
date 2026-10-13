"""Release gate for the qualified-leads landing. Production writes stay intercepted."""
import contextlib
import functools
import http.server
import json
import mimetypes
import os
import threading
import traceback
from pathlib import Path
from urllib.parse import unquote, urlparse

from playwright.sync_api import sync_playwright


artifacts = Path("artifacts")
artifacts.mkdir(exist_ok=True)
checks = []
errors = []
manifest = json.loads((Path("dist") / "release.json").read_text(encoding="utf-8"))
capture_artifacts = os.environ.get("SAMAI_CAPTURE_SCREENSHOTS", "1") != "0"


def check(name, value):
    checks.append({"name": name, "passed": bool(value)})
    assert value, name


def capture(page, path):
    if capture_artifacts:
        page.screenshot(path=artifacts / path)


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


server = None
try:
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 8765),
        functools.partial(Handler, directory="dist"),
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
except PermissionError:
    # Windows' offline sandbox can deny loopback binds. The browser route below
    # serves the exact same immutable dist files without weakening the gate.
    pass


def install_api_routes(context, leads, events, mode):
    cors = {
        "access-control-allow-origin": "http://127.0.0.1:8765",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
    }

    def contact(route, request):
        if request.method == "OPTIONS":
            return route.fulfill(status=204, headers=cors)
        payload = json.loads(request.post_data or "{}")
        leads.append(payload)
        body = {"error": "Временная ошибка тестового API"} if mode["fail"] else {
            "ok": True,
            "accepted": True,
            "id": "synthetic-lead",
            "notification": "queued",
        }
        return route.fulfill(
            status=503 if mode["fail"] else 201,
            headers={**cors, "content-type": "application/json"},
            body=json.dumps(body),
        )

    def event(route, request):
        if request.method == "OPTIONS":
            return route.fulfill(status=204, headers=cors)
        events.append(json.loads(request.post_data or "{}"))
        return route.fulfill(status=204, headers=cors)

    def static_file(route, request):
        relative = unquote(urlparse(request.url).path).lstrip("/") or "index.html"
        file_path = (Path("dist") / relative).resolve()
        dist_root = Path("dist").resolve()
        if file_path != dist_root and dist_root not in file_path.parents:
            return route.fulfill(status=403)
        if not file_path.is_file():
            return route.fulfill(status=404)
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        return route.fulfill(status=200, content_type=content_type, body=file_path.read_bytes())

    if server is None:
        context.route("http://127.0.0.1:8765/**", static_file)

    context.route("https://app.samaiconsulting.ru/api/webhooks/leads/samai-public/contact", contact)
    context.route("https://app.samaiconsulting.ru/api/webhooks/leads/samai-public/events", event)
    context.route("https://app.samaiconsulting.ru/api/public/**", lambda route: route.abort())


def story_progress(page, progress):
    page.evaluate(
        """p => {
          const story = document.querySelector('.story');
          const distance = Math.max(1, story.offsetHeight - innerHeight);
          window.scrollTo(0, story.offsetTop + distance * p);
        }""",
        progress,
    )
    if progress >= 0.999:
        page.keyboard.press("End")
        page.mouse.wheel(0, 100000)
    page.wait_for_timeout(1100)


def text_glyphs_fit(locator, vertical=True):
    """Measure rendered text fragments, not a block box that can hide clipping."""
    return locator.evaluate(
        """(root, vertical) => {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          const fragments = [];
          let node;
          while ((node = walker.nextNode())) {
            if (!node.textContent.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            fragments.push(...range.getClientRects());
          }
          if (!fragments.length) return false;
          return fragments.every(rect =>
            rect.left >= -1 && rect.right <= innerWidth + 1 &&
            (!vertical || (rect.top >= -1 && rect.bottom <= innerHeight + 1))
          );
        }""",
        vertical,
    )


def visible_text_min_size(locator, minimum):
    return locator.evaluate_all(
        """(els, minimum) => els.length > 0 && els.every(el => {
          const style = getComputedStyle(el);
          return style.display === 'none' || style.visibility === 'hidden' ||
            parseFloat(style.fontSize) >= minimum;
        })""",
        minimum,
    )


def click_sticky_cta(page, locator):
    """Click the rendered CTA without Playwright re-scrolling the sticky stage."""
    box = locator.bounding_box()
    check("sticky CTA has rendered bounds", box and box["width"] > 0 and box["height"] > 0)
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def wait_sticky_cta(page):
    page.wait_for_function(
        """() => {
          const el = document.querySelector('.copy--pilot [data-open-dialog]');
          if (!el) return false;
          const style = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          return style.visibility === 'visible' && Number(style.opacity) > .9 &&
            box.width > 0 && box.height >= 48 && box.top >= 0 && box.bottom <= innerHeight;
        }""",
        timeout=20000,
    )


def submit_form(page):
    """Exercise the current form without retaining a locator across UI updates."""
    page.evaluate(
        """() => {
          const form = document.querySelector('#contact-form');
          form.requestSubmit(form.querySelector('.form-submit'));
        }"""
    )


try:
    check("release target", manifest.get("target") == "/lead-gen-agency/")
    with sync_playwright() as playwright:
        for engine in [item for item in os.environ.get("SAMAI_BROWSERS", "chromium,firefox,webkit").split(",") if item]:
            print(engine + ": launch", flush=True)
            browser = getattr(playwright, engine).launch(timeout=30000)
            context = browser.new_context(viewport={"width": 1440, "height": 900})
            context.add_init_script("window.__SAMAI_TEST_TRANSPORT=true")
            leads, events, mode = [], [], {"fail": False}
            install_api_routes(context, leads, events, mode)
            context.tracing.start(screenshots=True, snapshots=True, sources=True)
            page = context.new_page()
            page.set_default_timeout(30000)
            runtime_errors = []
            console_errors = []
            page.on("pageerror", lambda error: runtime_errors.append(str(error)))
            page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
            response = page.goto(
                "http://127.0.0.1:8765/?motion=full&utm_source=ci&utm_medium=test&utm_campaign=v12&private=discard",
                wait_until="domcontentloaded",
                timeout=30000,
            )
            page.wait_for_function("window.SAMAI_TRACK && document.documentElement.classList.contains('is-ready')")
            page.wait_for_timeout(100)
            print(engine + ": loaded", flush=True)
            check(engine + " HTTP", response.status == 200)
            check(engine + " noindex", "noindex" in (page.locator('meta[name="robots"]').get_attribute("content") or ""))
            check(engine + " v12 marker", page.locator('meta[name="samai-build"]').get_attribute("content").startswith("12-ci-"))
            check(engine + " canonical route", page.locator('link[rel="canonical"]').get_attribute("href") == "https://samaiconsulting.ru/lead-gen-agency/")
            check(engine + " social route", page.locator('meta[property="og:url"]').get_attribute("content") == "https://samaiconsulting.ru/lead-gen-agency/")
            check(engine + " hero", "по вашим критериям" in page.locator("h1").inner_text().lower())
            check(engine + " early test anchor", "35 000 ₽" in page.locator(".hero-offer").inner_text())
            check(engine + " hero CTA", page.locator(".hero-cta").is_visible())
            check(engine + " header CTA copy", "согласовать критерии теста" in (page.locator(".topbar-cta").text_content() or "").lower())
            check(engine + " hero CTA copy", "согласовать критерии теста" in (page.locator(".hero-cta span").text_content() or "").lower())
            check(engine + " pilot CTA copy", "согласовать критерии теста" in (page.locator(".primary-cta span").text_content() or "").lower())
            check(engine + " form CTA copy", "согласовать критерии теста" in (page.locator(".form-submit span").text_content() or "").lower())
            check(engine + " logo", page.locator(".wordmark img").evaluate("image => image.complete && image.naturalWidth > 0"))
            check(
                engine + " logo is not cropped",
                page.locator(".wordmark-mark").evaluate(
                    """mark => {
                      const frame = mark.getBoundingClientRect();
                      const image = mark.querySelector('img').getBoundingClientRect();
                      return image.left >= frame.left - 1 && image.top >= frame.top - 1 &&
                        image.right <= frame.right + 1 && image.bottom <= frame.bottom + 1 &&
                        getComputedStyle(mark.querySelector('img')).objectFit === 'contain';
                    }"""
                ),
            )
            check(engine + " base criteria", page.locator('[data-hud="criteria"]').count() == 4)
            check(engine + " client criteria", page.locator('[data-hud="custom"]').count() == 4)
            check(engine + " replacement reasons", page.locator('[data-hud="replace"]').count() == 4)
            body_text = page.locator("body").text_content()
            body_copy = " ".join(body_text.lower().split())
            check(engine + " qualified offer", "квалифицированных лидов" in body_copy and "10" in body_text)
            check(engine + " client criteria promise", "финальные критерии — ваши" in body_copy)
            check(engine + " proof caveat", "бронь ≠ закрытая сделка" in body_copy)
            check(engine + " forbidden agency copy absent", "агентский договор" not in body_text.lower())
            check(engine + " forbidden supplier copy absent", "напрямую поставщику" not in body_text.lower())
            check(engine + " page view event", any(item.get("event") == "page_view" for item in events))

            for progress, label in [(0.0, "hero"), (0.4, "criteria"), (0.66, "handoff"), (0.82, "rules"), (0.91, "proof"), (1.0, "pilot")]:
                print(engine + ": " + label, flush=True)
                story_progress(page, progress)
                visible_copy = page.locator(".copy").evaluate_all(
                    "els => els.filter(el => Number(getComputedStyle(el).opacity) > .42 && getComputedStyle(el).visibility !== 'hidden').length"
                )
                check(engine + " single message " + label, visible_copy <= 1)
                capture(page, f"{engine}-{label}.png")

            pilot_cta = page.locator(".copy--pilot [data-open-dialog]")
            check(
                engine + " reached story end",
                page.evaluate("scrollY >= document.documentElement.scrollHeight - innerHeight - 2"),
            )
            wait_sticky_cta(page)
            check(engine + " pilot CTA visible", pilot_cta.evaluate("el => getComputedStyle(el).visibility === 'visible'"))
            click_sticky_cta(page, pilot_cta)
            page.wait_for_timeout(100)
            check(engine + " dialog opens", page.locator(".lead-dialog").evaluate("dialog => dialog.open"))
            check(engine + " form open event", any(item.get("event") == "form_open" and item.get("properties", {}).get("source") == "pilot" for item in events))
            check(engine + " semantic CTA event", any(item.get("event") == "cta_click" and item.get("properties", {}).get("source") == "pilot" and item.get("properties", {}).get("target") == "form" for item in events))
            form = page.locator("#contact-form")
            check(engine + " transport enables submit", not form.locator(".form-submit").is_disabled())
            form.locator("#name").fill("Тест сборки")
            form.locator("#contact-value").fill("+7 999 123-45-67")
            form.locator("#city").fill("Москва")
            check(engine + " optional details collapsed", form.locator(".form-details").get_attribute("open") is None)
            form.locator(".form-details summary").click()
            form.locator("#segment").fill("Новостройки")
            form.locator("#volume").fill("20")
            submit_form(page)
            check(engine + " consent blocks network", len(leads) == 0 and form.locator("#consent-error").is_visible())
            consent = form.locator("#privacy-consent")
            consent.click(force=True)
            check(engine + " consent toggles", consent.is_checked())
            submit_form(page)
            page.wait_for_function("document.querySelector('#form-status')?.dataset.state === 'success'")
            check(engine + " accepted UI", "Заявка отправлена" in form.locator("#form-status").inner_text())
            check(engine + " one lead", len(leads) == 1)
            payload = leads[0]
            check(engine + " lead service", payload.get("service") == "Квалифицированные заявки")
            check(engine + " lead context", "Город / регион: Москва" in payload.get("task", "") and "Объём на старте: 20 лидов" in payload.get("task", ""))
            check(engine + " UTM", payload.get("utm", {}).get("source") == "ci" and payload.get("utm", {}).get("campaign") == "v12")
            check(engine + " consent version", payload.get("consent") is True and payload.get("consentVersion") == "2026-09-16")
            check(engine + " idempotency", len(payload.get("idempotencyKey", "")) >= 20)
            submit_form(page)
            page.wait_for_timeout(100)
            check(engine + " repeated click deduplicated", len(leads) == 1)
            check(engine + " no console error before simulated outage", not console_errors)

            mode["fail"] = True
            form.locator("#name").fill("Тест ошибки")
            form.locator("#contact-value").fill("+7 999 765-43-21")
            submit_form(page)
            page.wait_for_function("document.querySelector('#form-status')?.dataset.state === 'error'")
            check(engine + " failure visible", "Заявка не отправлена" in form.locator("#form-status").inner_text())
            check(engine + " failed data preserved", form.locator("#contact-value").input_value() == "+7 999 765-43-21")
            failed_key = leads[-1]["idempotencyKey"]
            submit_form(page)
            page.wait_for_timeout(200)
            check(engine + " retry idempotent", leads[-1]["idempotencyKey"] == failed_key)
            form.locator("#city").fill("Казань")
            submit_form(page)
            page.wait_for_timeout(200)
            check(engine + " changed inquiry new key", leads[-1]["idempotencyKey"] != failed_key)
            serialized_events = json.dumps(events, ensure_ascii=False)
            check(engine + " analytics excludes PII", "Тест сборки" not in serialized_events and "+7 999" not in serialized_events)
            check(engine + " conversion event", any(item.get("event") == "form_submit_success" for item in events))
            check(engine + " requested volume event", any(item.get("event") == "form_submit_success" and item.get("properties", {}).get("requestedVolume") == 20 for item in events))
            check(engine + " story stage event", any(item.get("event") == "story_stage_view" and item.get("properties", {}).get("stage") == 8 for item in events))

            form.locator(".dialog-close").click()
            page.wait_for_timeout(100)
            check(engine + " form close event", any(item.get("event") == "form_close" and item.get("properties", {}).get("source") == "pilot" for item in events))
            for width in [320, 360, 390, 423, 768, 1024, 1440, 1920]:
                page.set_viewport_size({"width": width, "height": 844 if width < 800 else 900})
                page.wait_for_timeout(120)
                check(engine + " no overflow " + str(width), page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
            mobile_chapters = [
                (0.0, "hero", ".copy--hero", None),
                (0.21, "order", ".copy--order", None),
                (0.4, "criteria", ".copy--criteria", '[data-hud="criteria"] strong'),
                (0.54, "custom", ".copy--custom", '[data-hud="custom"] strong'),
                (0.66, "handoff", ".copy--handoff", ".hud-lead dd"),
                (0.74, "protocol", ".copy--replace", ".hud-protocol li strong"),
                (0.82, "replacement", ".copy--replace-reasons", '[data-hud="replace"] strong'),
                (0.91, "proof", ".copy--proof", ".hud-case__main > span, .hud-case__room strong"),
                (0.98, "pilot", ".copy--pilot", None),
            ]
            mobile_viewports = [(320, 568), (375, 667), (390, 844), (430, 932)]
            supporting_text_selector = ", ".join([
                ".hud-card small", ".hud-card em", ".hud-score--criteria span",
                ".hud-score--custom span", ".hud-lead header", ".hud-lead footer",
                ".hud-lead__title em", ".hud-lead dt", ".hud-protocol__head",
                ".hud-protocol li small", ".hud-case header", ".hud-case footer",
                ".hud-case__metric small", ".hud-case__room small",
            ])
            for width, height in mobile_viewports:
                page.set_viewport_size({"width": width, "height": height})
                for progress, label, selector, supporting_selector in mobile_chapters:
                    story_progress(page, progress)
                    expected = page.locator(selector)
                    check(engine + f" mobile {width} {label} copy", expected.is_visible())
                    check(
                        engine + f" mobile {width} {label} single message",
                        page.locator(".copy").evaluate_all(
                            "els => els.filter(el => Number(getComputedStyle(el).opacity) > .9 && getComputedStyle(el).visibility !== 'hidden').length === 1"
                        ),
                    )
                    check(
                        engine + f" mobile {width} {label} copy bounds",
                        expected.evaluate(
                            "el => { const r=el.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1; }"
                        ),
                    )
                    check(
                        engine + f" mobile {width} {label} glyph bounds",
                        text_glyphs_fit(expected),
                    )
                    if label != "hero":
                        check(
                            engine + f" mobile {width} {label} header clearance",
                            expected.evaluate(
                                "el => el.getBoundingClientRect().top >= document.querySelector('.topbar').getBoundingClientRect().bottom + 8"
                            ),
                        )
                    readable = expected.locator("h1, h2, p:not(.eyebrow)").evaluate_all(
                        "els => els.filter(el => getComputedStyle(el).display !== 'none').every(el => parseFloat(getComputedStyle(el).fontSize) >= 16)"
                    )
                    check(engine + f" mobile {width} {label} readable type", readable)
                    check(
                        engine + f" mobile {width} {label} eyebrow readable",
                        visible_text_min_size(expected.locator(".eyebrow"), 10),
                    )
                    if supporting_selector:
                        check(
                            engine + f" mobile {width} {label} supporting data",
                            page.locator(supporting_selector).evaluate_all(
                                "els => els.length > 0 && els.every(el => parseFloat(getComputedStyle(el).fontSize) >= 11)"
                            ),
                        )
                    check(
                        engine + f" mobile {width} {label} supporting labels readable",
                        visible_text_min_size(page.locator(supporting_text_selector), 10),
                    )
                    check(
                        engine + f" mobile {width} {label} narrative clears evidence",
                        expected.evaluate(
                            """copy => {
                              const a = copy.getBoundingClientRect();
                              const evidence = [...document.querySelectorAll('[data-hud], [data-hud-score], [data-hud-lead], [data-hud-protocol], [data-hud-case]')]
                                .filter(el => {
                                  const style = getComputedStyle(el);
                                  const box = el.getBoundingClientRect();
                                  return Number(style.opacity) > .5 && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
                                });
                              return evidence.every(el => {
                                const b = el.getBoundingClientRect();
                                return a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1;
                              });
                            }"""
                        ),
                    )
                    check(
                        engine + f" mobile {width} {label} evidence bounds",
                        page.locator("[data-hud], [data-hud-score], [data-hud-lead], [data-hud-protocol], [data-hud-case]").evaluate_all(
                            """els => els.filter(el => {
                              const style = getComputedStyle(el);
                              const box = el.getBoundingClientRect();
                              return Number(style.opacity) > .5 && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
                            }).every(el => {
                              const r = el.getBoundingClientRect();
                              return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1;
                            })"""
                        ),
                    )
                    if label in ("hero", "pilot"):
                        cta_selector = ".hero-cta" if label == "hero" else ".primary-cta"
                        check(
                            engine + f" mobile {width} {label} CTA touch target",
                            page.locator(cta_selector).evaluate("el => el.getBoundingClientRect().height >= 48"),
                        )
                    # Assertions cover every viewport/chapter. Preserve visual
                    # evidence on a representative short iPhone without making
                    # WebGL screenshot encoding dominate the release timeout.
                    if width == 375 and label in ("hero", "pilot"):
                        capture(page, f"{engine}-mobile-{width}-{label}.png")
                print(engine + f": mobile {width} complete", flush=True)
            page.set_viewport_size({"width": 390, "height": 844})
            story_progress(page, 1.0)
            wait_sticky_cta(page)
            check(engine + " mobile pilot visible", pilot_cta.evaluate("el => getComputedStyle(el).visibility === 'visible'"))
            click_sticky_cta(page, pilot_cta)
            check(engine + " mobile dialog fits", page.locator(".lead-dialog").evaluate("dialog => dialog.getBoundingClientRect().width <= innerWidth"))
            capture(page, f"{engine}-mobile-form.png")
            form.locator(".dialog-close").click()
            check(engine + " no runtime exception", not runtime_errors)
            print(engine + ": desktop complete", flush=True)
            context.tracing.stop(path=artifacts / f"{engine}-trace.zip")
            context.close()

            reduced = browser.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce")
            reduced.add_init_script("window.__SAMAI_TEST_TRANSPORT=true")
            install_api_routes(reduced, [], [], {"fail": False})
            reduced_page = reduced.new_page()
            reduced_page.goto("http://127.0.0.1:8765/", wait_until="load")
            reduced_page.wait_for_function("document.documentElement.classList.contains('is-ready')")
            check(
                engine + " campaign motion remains full under OS reduced preference",
                reduced_page.locator("html").get_attribute("data-motion") == "full",
            )
            reduced_page.goto("http://127.0.0.1:8765/?motion=reduced", wait_until="load")
            reduced_page.wait_for_function("document.documentElement.classList.contains('is-ready')")
            check(engine + " explicit reduced mode", reduced_page.locator("html").get_attribute("data-motion") == "reduced")
            check(engine + " reduced hero visible", reduced_page.locator("h1").is_visible())
            check(engine + " reduced no overflow", reduced_page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
            check(engine + " reduced story scrollable", reduced_page.evaluate("document.documentElement.scrollHeight > innerHeight * 5"))
            reduced_page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
            reduced_page.wait_for_timeout(250)
            reduced_cta = reduced_page.locator(".copy--pilot [data-open-dialog]")
            check(engine + " reduced final chapter", reduced_page.locator(".stage-index__current").inner_text() == "08")
            wait_sticky_cta(reduced_page)
            check(engine + " reduced pilot CTA visible", reduced_cta.evaluate("el => getComputedStyle(el).visibility === 'visible'"))
            click_sticky_cta(reduced_page, reduced_cta)
            check(engine + " reduced form opens", reduced_page.locator(".lead-dialog").get_attribute("open") is not None)
            reduced_page.locator(".dialog-close").click()
            reduced_page.wait_for_timeout(650)
            capture(reduced_page, f"{engine}-mobile-reduced.png")
            print(engine + ": reduced complete", flush=True)
            reduced.close()

            if engine == "chromium":
                fallback_context = browser.new_context(viewport={"width": 1440, "height": 900})
                fallback_context.add_init_script("window.__SAMAI_TEST_TRANSPORT=true")
                install_api_routes(fallback_context, [], [], {"fail": False})
                fallback_page = fallback_context.new_page()
                fallback_page.goto("http://127.0.0.1:8765/?motion=full&fallback=1", wait_until="load")
                fallback_page.wait_for_function("document.documentElement.classList.contains('webgl-fallback-active')")
                story_progress(fallback_page, 1.0)
                fallback_cta = fallback_page.locator(".copy--pilot [data-open-dialog]")
                wait_sticky_cta(fallback_page)
                check("dynamic fallback CTA visible", fallback_cta.evaluate("el => getComputedStyle(el).visibility === 'visible'"))
                check("dynamic fallback final chapter", fallback_page.locator(".stage-index__current").inner_text() == "08")
                capture(fallback_page, "chromium-dynamic-fallback.png")
                print("chromium: fallback complete", flush=True)
                fallback_context.close()

            browser.close()
except Exception:
    errors.append(traceback.format_exc())
finally:
    with contextlib.suppress(Exception):
        server.shutdown()
    report = {"passed": sum(item["passed"] for item in checks), "checks": checks, "errors": errors}
    (artifacts / "checks.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "failed": len(errors)}, ensure_ascii=False))
    if errors:
        print(errors[-1])
        raise SystemExit(1)
