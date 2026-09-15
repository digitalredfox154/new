
/* SAMAI prototype 03. No form submission, analytics, cookies or persistent storage. */
(() => {
  'use strict';
  const $ = (s, parent = document) => parent.querySelector(s);
  const $$ = (s, parent = document) => Array.from(parent.querySelectorAll(s));
  const root = document.documentElement;
  const eventLog=[];
  const emit=(event,properties={})=>{
    const entry={event,...properties};eventLog.push(entry);if(eventLog.length>100)eventLog.shift();
    document.dispatchEvent(new CustomEvent('samai:event',{detail:entry}));
  };
  window.SAMAI_EVENTS=eventLog;


  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const removers = [];
  const listen = (target, event, handler, options) => {
    if (!target) return;
    target.addEventListener(event, handler, options);
    removers.push(() => target.removeEventListener(event, handler, options));
  };
  $$('a[href="#contact"]').forEach((a,i)=>listen(a,'click',()=>emit('cta_click',{placement:i})));
  const clamp = x => Math.max(0, Math.min(1, x));
  let processEnabled = false, stepIndex = -1, frame = 0;
  const header = $('.site-header');
  const track = $('.process-track');
  const stage = $('.process-stage');
  const stepControls = $('.process-controls');
  const stepTabs = $$('.process-controls [data-step]');
  const panels = $$('[data-process-panel]');
  const rail = $('.process-rail span');
  const menu = $('.mobile-menu');
  const form = $('#contact-form');
  let sceneStart = 0, sceneDistance = 1;

  function updateTheme() {
    const y = header.getBoundingClientRect().bottom + 8;
    const el = document.elementFromPoint(8, y);
    const dark = Boolean(el && el.closest('.dark, .hero-a'));
    header.classList.toggle('is-paper', !dark);
  }
  function measureScene() {
    const stickyTop = parseFloat(getComputedStyle(stage).top) || 136;
    sceneStart = track.getBoundingClientRect().top + scrollY - stickyTop;
    sceneDistance = Math.max(1, track.offsetHeight - stage.offsetHeight);
  }
  function setStep(index, animate = false) {
    index = Math.max(0, Math.min(panels.length - 1, index));
    if (index === stepIndex && processEnabled) return;
    stepIndex = index;
    stepTabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    panels.forEach((panel, i) => { panel.hidden = processEnabled && i !== index; });
    document.dispatchEvent(new CustomEvent('samai:step', {detail:{index, animate, enabled:processEnabled}}));
  }
  function updateScene() {
    if (!processEnabled) return;
    const progress = clamp((scrollY - sceneStart) / sceneDistance);
    const index = Math.min(3, Math.floor(progress * 4));
    if (index !== stepIndex) setStep(index, true);
    rail.style.width = `${progress * 100}%`;
  }
  function tick() {
    frame = 0;
    updateTheme();
    updateScene();
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(tick);
  }
  function configureScene() {
    processEnabled = innerWidth >= 1000 && innerHeight >= 800 && !reduced.matches && window.SamaiMotion?.mode === 'cinematic';
    root.classList.toggle('process-enhanced', processEnabled);
    stepControls.setAttribute('role', processEnabled ? 'tablist' : 'group');
    stepTabs.forEach((tab, i) => {
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', panels[i].id);
      panels[i].setAttribute('aria-labelledby', tab.id);
      if (processEnabled) panels[i].setAttribute('role', 'tabpanel');
      else { panels[i].removeAttribute('role'); panels[i].removeAttribute('aria-labelledby'); }
      panels[i].hidden = false;
    });
    stepIndex = -1;
    if (processEnabled) { setStep(0); measureScene(); updateScene(); }
    updateTheme();
  }
  function chooseStep(index) {
    if (!processEnabled) return;
    measureScene();
    const progress = (index + .35) / panels.length;
    window.scrollTo({top: sceneStart + sceneDistance * progress, behavior:'instant'});
    setStep(index, true);
    rail.style.width = `${progress * 100}%`;
    updateTheme();
  }
  stepTabs.forEach((tab, i) => {
    listen(tab, 'click', () => chooseStep(i));
    listen(tab, 'keydown', e => {
      let next = i;
      if (e.key === 'ArrowRight') next = (i + 1) % stepTabs.length;
      else if (e.key === 'ArrowLeft') next = (i + stepTabs.length - 1) % stepTabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = stepTabs.length - 1;
      else return;
      e.preventDefault(); chooseStep(next); stepTabs[next].focus({preventScroll:true});
    });
  });
  if (menu) {
    const summary = $('summary', menu);
    listen(menu, 'toggle', () => summary.setAttribute('aria-label', menu.open ? 'Закрыть меню' : 'Открыть меню'));
    listen(document, 'keydown', e => { if (e.key === 'Escape' && menu.open) { menu.open=false; summary.focus(); } });
    listen(document, 'click', e => { if (menu.open && !menu.contains(e.target)) menu.open=false; });
    $$('a', menu).forEach(a => listen(a, 'click', () => { menu.open=false; }));
  }
  // Native details keep all services and FAQs usable without JavaScript.
  $$('.service').forEach(detail => listen(detail, 'toggle', () => { measureScene(); schedule(); }));
  const selected = $('.selected-service');
  $$('a[data-service]').forEach(a => listen(a, 'click', () => {
    $('#service-value').value = a.dataset.service;
    $('span', selected).textContent = a.dataset.service;
    selected.hidden = false;
  }));
  listen($('button', selected), 'click', () => {
    selected.hidden=true; $('#service-value').value='';
  });
  if (form) {
    const name = $('#name'), contact = $('#contact-value'), status = $('#form-status'), submit = $('.form-submit');
    const memory = {telegram:'', email:'', phone:''};
    let method = 'telegram';
    const variants = {
      telegram:{label:'Ваш Telegram',placeholder:'@username',type:'text',mode:'text',autocomplete:'off'},
      email:{label:'Ваша электронная почта',placeholder:'name@company.ru',type:'email',mode:'email',autocomplete:'email'},
      phone:{label:'Ваш телефон',placeholder:'+7 999 123-45-67',type:'tel',mode:'tel',autocomplete:'tel'}
    };
    const setError = (input, node, message) => {
      node.textContent = message;
      node.hidden = !message;
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
    };
    $$('input[name="method"]').forEach(radio => listen(radio, 'change', () => {
      memory[method] = contact.value;
      method = radio.value;
      const preset = variants[method];
      $('#contact-label').textContent = preset.label;
      contact.type=preset.type; contact.placeholder=preset.placeholder;
      contact.inputMode=preset.mode; contact.autocomplete=preset.autocomplete;
      contact.value=memory[method]; status.hidden=true;
      setError(contact, $('#contact-error'), '');
    }));
    [name,contact].forEach(input => listen(input, 'input', () => { status.hidden=true; }));
    let formStarted=false;
    listen(form,'focusin',()=>{if(!formStarted){emit('form_start');formStarted=true;}});
    submit.disabled=false;
    listen(form, 'submit', event => {
      event.preventDefault();
      const value = contact.value.trim();
      const nameError = name.value.trim() ? '' : 'Укажите, как к вам обращаться.';
      let contactError='';
      if (!value) contactError='Укажите контакт для ответа.';
      else if (method==='telegram' && !/^(?:@|https?:\/\/t\.me\/)?[a-zA-Z][a-zA-Z0-9_]{4,31}\/?$/.test(value)) contactError='Укажите имя пользователя Telegram или ссылку на профиль.';
      else if (method==='email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) contactError='Проверьте адрес электронной почты.';
      else if (method==='phone' && (!/^\+?[\d\s().-]+$/.test(value) || value.replace(/\D/g,'').length<7 || value.replace(/\D/g,'').length>15)) contactError='Проверьте номер телефона и код страны.';
      setError(name,$('#name-error'),nameError); setError(contact,$('#contact-error'),contactError);
      status.hidden=true;
      if (nameError || contactError) { (nameError ? name : contact).focus(); return; }
      const title=document.createElement('strong'); title.textContent='Поля заполнены. Заявка не отправлена.';
      const message=document.createElement('span'); message.textContent='Это демонстрация. Подключение получателя заявок — следующий этап. Введённые данные остались только в этой вкладке.';
      status.replaceChildren(title,message); status.hidden=false;
      emit('demo_form_validated',{method});
    });
  }
  // The primary conversion action jumps directly to the form: no long animated scroll.
  listen(document,'click',event=>{
    const anchor=event.target.closest('a[href="#contact"]');
    if(!anchor||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    const target=$('#contact');
    if(menu)menu.open=false;
    target.scrollIntoView({behavior:'instant',block:'start'});
    const heading=$('h2',target);heading.tabIndex=-1;heading.focus({preventScroll:true});
    schedule();
  });
  listen(window,'scroll',schedule,{passive:true});
  listen(window,'resize',()=>{ configureScene(); schedule(); });
  listen(reduced,'change',configureScene);
  listen(document,'samai:motionchange',configureScene);
  listen(document,'samai:layout',()=>{measureScene();schedule();});
  // Header and one narrative scene; no scroll interception or continuous rendering.
  configureScene();
  if (document.fonts) document.fonts.ready.then(()=>{ measureScene(); schedule(); });
  // Load the chosen Cyrillic-capable family non-blockingly. It remains optional.
  const fontLink=document.createElement('link');
  fontLink.rel='stylesheet';
  fontLink.href='https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600&display=swap';
  fontLink.addEventListener('load',()=>{ if(document.fonts)document.fonts.ready.then(()=>{measureScene();schedule();}); },{once:true});
  document.head.append(fontLink);
  window.__SAMAI_PROTOTYPE__ = {
    version:'03',
    getVariant:()=>'a',
    getScene:()=>({enabled:processEnabled,index:stepIndex,start:sceneStart,distance:sceneDistance}),
    dispose(){removers.forEach(fn=>fn());if(frame)cancelAnimationFrame(frame);}
  };
})();

