const API = "https://app.samaiconsulting.ru/api/webhooks/leads/samai-public";
const CONSENT_VERSION = "2026-09-16";

const cut = (value, length) => String(value || "").trim().slice(0, length);
const liveTransport = () => location.hostname === "samaiconsulting.ru" || window.__SAMAI_TEST_TRANSPORT === true;
const randomKey = () => crypto.randomUUID().replaceAll("-", "");

const setError = (input, node, message) => {
  if (!input || !node) return;
  node.textContent = message;
  node.hidden = !message;
  input.setAttribute("aria-invalid", message ? "true" : "false");
};

const contactError = (method, value) => {
  if (!value) return "Укажите контакт для ответа.";
  if (method === "telegram" && !/^(?:@|https?:\/\/t\.me\/)?[a-zA-Z][a-zA-Z0-9_]{4,31}\/?$/.test(value)) {
    return "Проверьте имя пользователя Telegram или ссылку на профиль.";
  }
  if (method === "phone") {
    const digits = value.replace(/\D/g, "");
    if (!/^\+?[\d\s().-]+$/.test(value) || digits.length < 7 || digits.length > 15) return "Проверьте номер телефона и код страны.";
  }
  return "";
};

export const initLeadCapture = ({ form, emitEvent }) => {
  const submit = form.querySelector(".form-submit");
  const submitLabel = submit.querySelector("span");
  const status = form.querySelector("#form-status");
  const name = form.querySelector("#name");
  const contact = form.querySelector("#contact-value");
  const city = form.querySelector("#city");
  const segment = form.querySelector("#segment");
  const volume = form.querySelector("#volume");
  const consent = form.querySelector("#privacy-consent");
  const website = form.querySelector("#website");
  const params = new URLSearchParams(location.search);
  const utm = {
    source: cut(params.get("utm_source"), 120),
    medium: cut(params.get("utm_medium"), 120),
    campaign: cut(params.get("utm_campaign"), 180),
    content: cut(params.get("utm_content"), 180),
    term: cut(params.get("utm_term"), 180),
  };
  const pageUrl = location.origin + location.pathname;
  let referrer = "";
  try { referrer = new URL(document.referrer).origin; } catch { /* No referrer. */ }
  let sessionId = "";
  try {
    sessionId = sessionStorage.getItem("samai_session") || randomKey();
    sessionStorage.setItem("samai_session", sessionId);
  } catch {
    sessionId = randomKey();
  }

  const jsonFetch = (path, payload, keepalive = false) => fetch(API + path, {
    method: "POST",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    keepalive,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: keepalive ? undefined : AbortSignal.timeout(15000),
  });
  const track = (event, properties = {}) => liveTransport()
    ? jsonFetch("/events", { event, sessionId, properties, pageUrl, referrer, utm }, true).catch(() => undefined)
    : Promise.resolve();
  window.SAMAI_TRACK = track;
  track("page_view", { path: location.pathname });

  window.addEventListener("samai:event", (event) => {
    const detail = event.detail || {};
    if (detail.name === "cta_click") track("cta_click", { placement: detail.source === "header" ? 0 : 1 });
    if (detail.name === "motion_pause") track("motion_toggle", { mode: "off" });
    if (detail.name === "motion_resume") track("motion_toggle", { mode: "cinematic" });
  });

  const setStatus = (kind, title, message) => {
    const strong = document.createElement("strong");
    const span = document.createElement("span");
    strong.textContent = title;
    span.textContent = message;
    status.replaceChildren(strong, span);
    status.dataset.state = kind;
    status.hidden = false;
  };
  const method = () => form.querySelector('input[name="method"]:checked')?.value || "";
  const setContactVariant = () => {
    const telegram = method() === "telegram";
    form.querySelector("#contact-label").textContent = telegram ? "Ваш Telegram *" : "Ваш телефон *";
    contact.placeholder = telegram ? "@username" : "+7 999 123-45-67";
    contact.inputMode = telegram ? "text" : "tel";
    contact.autocomplete = telegram ? "off" : "tel";
    setError(contact, form.querySelector("#contact-error"), "");
  };
  form.querySelectorAll('input[name="method"]').forEach((radio) => radio.addEventListener("change", setContactVariant));
  setContactVariant();

  const validate = () => {
    const chosenMethod = method();
    const nameMessage = name.value.trim() ? "" : "Укажите, как к вам обращаться.";
    const contactMessage = contactError(chosenMethod, contact.value.trim());
    const cityMessage = city.value.trim() ? "" : "Укажите город или регион.";
    const consentMessage = consent.checked ? "" : "Подтвердите согласие на обработку персональных данных.";
    setError(name, form.querySelector("#name-error"), nameMessage);
    setError(contact, form.querySelector("#contact-error"), contactMessage);
    setError(city, form.querySelector("#city-error"), cityMessage);
    setError(consent, form.querySelector("#consent-error"), consentMessage);
    return {
      ok: !nameMessage && !contactMessage && !cityMessage && !consentMessage,
      method: chosenMethod,
      first: nameMessage ? name : contactMessage ? contact : cityMessage ? city : consent,
    };
  };

  let submitKey = randomKey();
  let signature = "";
  let acceptedSignature = "";
  let busy = false;
  let formStarted = false;
  const pending = (value) => {
    busy = value;
    submit.disabled = value || !liveTransport();
    form.setAttribute("aria-busy", String(value));
    submitLabel.textContent = value ? "Отправляем…" : "Обсудить критерии";
  };
  submit.disabled = !liveTransport();
  form.addEventListener("focusin", () => {
    if (formStarted) return;
    formStarted = true;
    emitEvent("form_start", { source: "pilot" });
    track("form_start");
  });
  [name, contact, city, segment, volume].forEach((input) => input.addEventListener("input", () => { status.hidden = true; }));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (busy) return;
    status.hidden = true;
    const checked = validate();
    if (!checked.ok) {
      checked.first?.focus();
      track("form_submit_error", { stage: "validation" });
      return;
    }
    const requestedVolume = Math.max(10, Math.min(1000, Number(volume.value) || 10));
    const task = [
      `Город / регион: ${city.value.trim()}`,
      segment.value.trim() ? `Недвижимость: ${segment.value.trim()}` : "",
      `Объём на старте: ${requestedVolume} лидов`,
    ].filter(Boolean).join("\n");
    const content = {
      name: name.value.trim(),
      method: checked.method,
      contact: contact.value.trim(),
      company: "",
      task,
      service: "Квалифицированные заявки",
      website: website.value,
      pageUrl,
      referrer,
      utm,
      consent: true,
      consentVersion: CONSENT_VERSION,
    };
    const nextSignature = JSON.stringify(content);
    if (acceptedSignature === nextSignature) {
      setStatus("success", "Заявка уже отправлена.", "Повторную заявку мы не создавали.");
      return;
    }
    if (signature && signature !== nextSignature) submitKey = randomKey();
    signature = nextSignature;
    const payload = { ...content, idempotencyKey: submitKey };
    pending(true);
    emitEvent("form_submit_attempt", { source: "pilot", requestedVolume });
    track("form_submit_attempt", { method: checked.method, service: content.service });
    try {
      if (!liveTransport()) throw new Error("Форма доступна только на сайте SAMAI.");
      const response = await jsonFetch("/contact", payload);
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok !== true || body.accepted !== true) {
        throw new Error(typeof body.error === "string" ? body.error : "Не удалось отправить заявку.");
      }
      acceptedSignature = nextSignature;
      track("form_submit_success", { method: checked.method, service: content.service, notification: body.notification || "accepted" });
      setStatus("success", "Заявка отправлена.", "Свяжемся с вами и согласуем критерии теста.");
    } catch (error) {
      const uncertain = error?.name === "TimeoutError" || error?.name === "TypeError";
      setStatus(
        "error",
        uncertain ? "Не удалось подтвердить отправку." : "Заявка не отправлена.",
        uncertain ? "Проверьте интернет и повторите попытку. Дубликат не появится." : (error instanceof Error ? error.message : "Повторите попытку."),
      );
      track("form_submit_error", { stage: "transport" });
    } finally {
      pending(false);
    }
  }, true);
};
