"""Release gate for the qualified-leads landing. Production writes stay intercepted."""
import contextlib
import functools
import http.server
import json
import os
import threading
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright


artifacts = Path("artifacts")
artifacts.mkdir(exist_ok=True)
checks = []
errors = []


def check(name, value):
    checks.append({"name": name, "passed": bool(value)})
    assert value, name


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


server = http.server.ThreadingHTTPServer(
    ("127.0.0.1", 8765),
    functools.partial(Handler, directory="dist"),
)
threading.Thread(target=server.serve_forever, daemon=True).start()


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


try:
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
            page.set_default_timeout(15000)
            runtime_errors = []
            console_errors = []
            page.on("pageerror", lambda error: runtime_errors.append(str(error)))
            page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
            response = page.goto(
                "http://127.0.0.1:8765/?motion=full&utm_source=ci&utm_medium=test&utm_campaign=v12&private=discard",
                wait_until="load",
            )
            page.wait_for_function("window.SAMAI_TRACK && document.documentElement.classList.contains('is-ready')")
            print(engine + ": loaded", flush=True)
            check(engine + " HTTP", response.status == 200)
            check(engine + " noindex", "noindex" in (page.locator('meta[name="robots"]').get_attribute("content") or ""))
            check(engine + " v12 marker", page.locator('meta[name="samai-build"]').get_attribute("content").startswith("12-ci-"))
            check(engine + " hero", "по вашим критериям" in page.locator("h1").inner_text().lower())
            check(engine + " logo", page.locator(".wordmark img").evaluate("image => image.complete && image.naturalWidth > 0"))
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

            for progress, label in [(0.0, "hero"), (0.4, "criteria"), (0.66, "handoff"), (0.82, "rules"), (0.91, "proof"), (1.0, "pilot")]:
                print(engine + ": " + label, flush=True)
                story_progress(page, progress)
                visible_copy = page.locator(".copy").evaluate_all(
                    "els => els.filter(el => Number(getComputedStyle(el).opacity) > .42 && getComputedStyle(el).visibility !== 'hidden').length"
                )
                check(engine + " single message " + label, visible_copy <= 1)
                page.screenshot(path=artifacts / f"{engine}-{label}.png")

            pilot_cta = page.locator("[data-open-dialog]")
            check(
                engine + " reached story end",
                page.evaluate("scrollY >= document.documentElement.scrollHeight - innerHeight - 2"),
            )
            pilot_cta.wait_for(state="visible")
            check(engine + " pilot CTA visible", pilot_cta.is_visible())
            page.locator("[data-open-dialog]").click()
            check(engine + " dialog opens", page.locator(".lead-dialog").evaluate("dialog => dialog.open"))
            form = page.locator("#contact-form")
            check(engine + " transport enables submit", not form.locator(".form-submit").is_disabled())
            form.locator("#name").fill("Тест сборки")
            form.locator("#contact-value").fill("+7 999 123-45-67")
            form.locator("#city").fill("Москва")
            form.locator("#segment").fill("Новостройки")
            form.locator("#volume").fill("20")
            form.locator(".form-submit").click()
            check(engine + " consent blocks network", len(leads) == 0 and form.locator("#consent-error").is_visible())
            consent = form.locator("#privacy-consent")
            consent.click(force=True)
            check(engine + " consent toggles", consent.is_checked())
            form.locator(".form-submit").click()
            page.wait_for_function("document.querySelector('#form-status')?.dataset.state === 'success'")
            check(engine + " accepted UI", "Заявка отправлена" in form.locator("#form-status").inner_text())
            check(engine + " one lead", len(leads) == 1)
            payload = leads[0]
            check(engine + " lead service", payload.get("service") == "Квалифицированные заявки")
            check(engine + " lead context", "Город / регион: Москва" in payload.get("task", "") and "Объём на старте: 20 лидов" in payload.get("task", ""))
            check(engine + " UTM", payload.get("utm", {}).get("source") == "ci" and payload.get("utm", {}).get("campaign") == "v12")
            check(engine + " consent version", payload.get("consent") is True and payload.get("consentVersion") == "2026-09-16")
            check(engine + " idempotency", len(payload.get("idempotencyKey", "")) >= 20)
            form.locator(".form-submit").click()
            page.wait_for_timeout(100)
            check(engine + " repeated click deduplicated", len(leads) == 1)
            check(engine + " no console error before simulated outage", not console_errors)

            mode["fail"] = True
            form.locator("#name").fill("Тест ошибки")
            form.locator("#contact-value").fill("+7 999 765-43-21")
            form.locator(".form-submit").click()
            page.wait_for_function("document.querySelector('#form-status')?.dataset.state === 'error'")
            check(engine + " failure visible", "Заявка не отправлена" in form.locator("#form-status").inner_text())
            check(engine + " failed data preserved", form.locator("#contact-value").input_value() == "+7 999 765-43-21")
            failed_key = leads[-1]["idempotencyKey"]
            form.locator(".form-submit").click()
            page.wait_for_timeout(200)
            check(engine + " retry idempotent", leads[-1]["idempotencyKey"] == failed_key)
            form.locator("#city").fill("Казань")
            form.locator(".form-submit").click()
            page.wait_for_timeout(200)
            check(engine + " changed inquiry new key", leads[-1]["idempotencyKey"] != failed_key)
            serialized_events = json.dumps(events, ensure_ascii=False)
            check(engine + " analytics excludes PII", "Тест сборки" not in serialized_events and "+7 999" not in serialized_events)
            check(engine + " conversion event", any(item.get("event") == "form_submit_success" for item in events))

            form.locator(".dialog-close").click()
            for width in [360, 390, 423, 768, 1024, 1440, 1920]:
                page.set_viewport_size({"width": width, "height": 844 if width < 800 else 900})
                page.wait_for_timeout(120)
                check(engine + " no overflow " + str(width), page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
            page.set_viewport_size({"width": 390, "height": 844})
            story_progress(page, 1.0)
            pilot_cta.wait_for(state="visible")
            check(engine + " mobile pilot visible", pilot_cta.is_visible())
            page.screenshot(path=artifacts / f"{engine}-mobile-pilot.png")
            page.locator("[data-open-dialog]").click()
            check(engine + " mobile dialog fits", page.locator(".lead-dialog").evaluate("dialog => dialog.getBoundingClientRect().width <= innerWidth"))
            page.screenshot(path=artifacts / f"{engine}-mobile-form.png")
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
            check(engine + " reduced mode", reduced_page.locator("html").get_attribute("data-motion") == "reduced")
            check(engine + " reduced hero visible", reduced_page.locator("h1").is_visible())
            check(engine + " reduced no overflow", reduced_page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
            reduced_page.wait_for_timeout(650)
            reduced_page.screenshot(path=artifacts / f"{engine}-mobile-reduced.png")
            print(engine + ": reduced complete", flush=True)
            reduced.close()
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
