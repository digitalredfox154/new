(() => {
  'use strict';
  const API='https://app.samaiconsulting.ru';
  const $=(s,p=document)=>p.querySelector(s), $$=(s,p=document)=>Array.from(p.querySelectorAll(s));
  const liveTransport=()=>location.hostname==='samaiconsulting.ru'||window.__SAMAI_TEST_TRANSPORT===true;
  const params=new URLSearchParams(location.search);
  const utm={source:params.get('utm_source')||'',medium:params.get('utm_medium')||'',campaign:params.get('utm_campaign')||'',content:params.get('utm_content')||'',term:params.get('utm_term')||''};
  const randomKey=()=>crypto.randomUUID().replaceAll('-','');
  let sessionId='';
  try{sessionId=sessionStorage.getItem('samai_session')||randomKey();sessionStorage.setItem('samai_session',sessionId)}catch{sessionId=randomKey()}
  let submitKey=randomKey();
  const jsonFetch=(path,payload,options={})=>fetch(API+path,{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',keepalive:Boolean(options.keepalive),headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:options.keepalive?undefined:AbortSignal.timeout(15000)});
  const track=(event,properties={})=>{
    if(!liveTransport())return Promise.resolve();
    return jsonFetch('/api/public/landing-events',{event,sessionId,properties,pageUrl:location.href,referrer:document.referrer,utm},{keepalive:true}).catch(()=>undefined);
  };
  window.SAMAI_TRACK=track;
  if(liveTransport())track('page_view',{path:location.pathname});

  listenCustomEvents();
  function listenCustomEvents(){
    document.addEventListener('samai:event',e=>{
      const name=e.detail?.event;
      if(name==='cta_click')track('cta_click',{placement:Number(e.detail?.placement)||0});
      if(name==='form_start')track('form_start');
    });
    document.addEventListener('click',e=>{
      const service=e.target.closest?.('[data-service]');
      if(service)track('service_select',{service:String(service.dataset.service||'').slice(0,120)});
      if(e.target.closest?.('.motion-toggle'))track('motion_toggle',{mode:document.documentElement.dataset.motion||''});
    },{passive:true});
  }

  const form=$('#contact-form');
  if(!form)return;
  const submit=$('.form-submit',form), status=$('#form-status',form), name=$('#name',form), contact=$('#contact-value',form), consent=$('#privacy-consent',form), website=$('#website',form);
  const submitLabel=$('span',submit);
  const setStatus=(kind,title,message)=>{
    status.replaceChildren();
    const strong=document.createElement('strong');strong.textContent=title;
    const span=document.createElement('span');span.textContent=message;
    status.append(strong,span);status.hidden=false;status.dataset.state=kind;
  };
  const setError=(input,node,message)=>{if(!input||!node)return;node.textContent=message;node.hidden=!message;input.setAttribute('aria-invalid',message?'true':'false')};
  const contactValid=(method,value)=>{
    if(!value)return 'Укажите контакт для ответа.';
    if(method==='telegram'&&!/^(?:@|https?:\/\/t\.me\/)?[a-zA-Z][a-zA-Z0-9_]{4,31}\/?$/.test(value))return 'Проверьте имя пользователя Telegram или ссылку на профиль.';
    if(method==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))return 'Проверьте адрес электронной почты.';
    if(method==='phone'){const digits=value.replace(/\D/g,'');if(!/^\+?[\d\s().-]+$/.test(value)||digits.length<7||digits.length>15)return 'Проверьте номер телефона и код страны.'}
    return '';
  };
  const validate=()=>{
    const method=$('input[name="method"]:checked',form)?.value||'';
    const nameError=name.value.trim()?'':'Укажите, как к вам обращаться.';
    const contactError=contactValid(method,contact.value.trim());
    const consentError=consent?.checked?'':'Подтвердите согласие на обработку персональных данных.';
    setError(name,$('#name-error',form),nameError);setError(contact,$('#contact-error',form),contactError);
    const consentNode=$('#consent-error',form);if(consentNode){consentNode.textContent=consentError;consentNode.hidden=!consentError}
    return {ok:!nameError&&!contactError&&!consentError,method,first:nameError?name:contactError?contact:consent};
  };
  const pending=value=>{submit.disabled=value;form.setAttribute('aria-busy',String(value));if(submitLabel)submitLabel.textContent=value?'Отправляем…':'Обсудить задачу'};

  form.addEventListener('submit',async event=>{
    event.preventDefault();event.stopImmediatePropagation();status.hidden=true;
    const checked=validate();
    if(!checked.ok){checked.first?.focus();track('form_submit_error',{stage:'validation'});return}
    track('form_submit_attempt',{method:checked.method,service:$('#service-value',form)?.value||''});
    pending(true);
    const payload={
      idempotencyKey:submitKey,name:name.value.trim(),method:checked.method,contact:contact.value.trim(),
      company:$('#company',form)?.value.trim()||'',task:$('#task',form)?.value.trim()||'',service:$('#service-value',form)?.value||'',
      website:website?.value||'',pageUrl:location.href,referrer:document.referrer,utm,
    };
    try{
      if(!liveTransport())throw new Error('Форма доступна только на сайте SAMAI.');
      const response=await jsonFetch('/api/public/landing-leads',payload);
      const body=await response.json().catch(()=>({}));
      if(!response.ok||!body.ok)throw new Error(typeof body.error==='string'?body.error:'Не удалось отправить заявку.');
      setStatus('success','Заявка отправлена.','Мы получили ваш контакт. Ответственный руководитель увидит обращение в SAMAI.');
      track('form_submit_success',{method:checked.method,service:payload.service,notification:body.notification||'accepted'});
      submitKey=randomKey();
      form.reset();
      const selected=$('.selected-service',form);if(selected)selected.hidden=true;
      const service=$('#service-value',form);if(service)service.value='';
    }catch(error){
      const message=error?.name==='TimeoutError'?'Сервер отвечает дольше обычного. Повторите отправку — дубль не создастся.':(error instanceof Error?error.message:'Не удалось отправить заявку. Повторите попытку.');
      setStatus('error','Заявка не отправлена.',message);
      track('form_submit_error',{stage:'transport'});
    }finally{pending(false)}
  },true);
})();
