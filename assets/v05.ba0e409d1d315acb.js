(() => {
  'use strict';
  const API='https://app.samaiconsulting.ru/api/webhooks/leads/samai-public';
  const CONSENT_VERSION='2026-09-16';
  const $=(s,p=document)=>p.querySelector(s);
  const liveTransport=()=>location.hostname==='samaiconsulting.ru'||window.__SAMAI_TEST_TRANSPORT===true;
  const params=new URLSearchParams(location.search), cut=(v,n)=>String(v||'').trim().slice(0,n);
  const utm={source:cut(params.get('utm_source'),120),medium:cut(params.get('utm_medium'),120),campaign:cut(params.get('utm_campaign'),180),content:cut(params.get('utm_content'),180),term:cut(params.get('utm_term'),180)};
  const pageUrl=location.origin+location.pathname;
  let referrer='';try{referrer=new URL(document.referrer).origin}catch{/* No referrer. */}
  const randomKey=()=>crypto.randomUUID().replaceAll('-','');
  let sessionId='';try{sessionId=sessionStorage.getItem('samai_session')||randomKey();sessionStorage.setItem('samai_session',sessionId)}catch{sessionId=randomKey()}
  let submitKey=randomKey(), signature='', acceptedSignature='', busy=false;
  function jsonFetch(path,payload,keepalive=false){return fetch(API+path,{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',keepalive,headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:keepalive?undefined:AbortSignal.timeout(15000)})}
  const track=(event,properties={})=>liveTransport()?jsonFetch('/events',{event,sessionId,properties,pageUrl,referrer,utm},true).catch(()=>undefined):Promise.resolve();
  window.SAMAI_TRACK=track;
  track('page_view',{path:location.pathname});
  document.addEventListener('samai:event',e=>{
    if(e.detail?.event==='cta_click')track('cta_click',{placement:Number(e.detail.placement)||0});
    if(e.detail?.event==='form_start')track('form_start');
  });
  document.addEventListener('click',e=>{
    const service=e.target.closest?.('[data-service]');
    if(service)track('service_select',{service:cut(service.dataset.service,120)});
    if(e.target.closest?.('.motion-toggle'))track('motion_toggle',{mode:document.documentElement.dataset.motion||''});
  },{passive:true});
  const form=$('#contact-form');if(!form)return;
  const submit=$('.form-submit',form),status=$('#form-status',form),name=$('#name',form),contact=$('#contact-value',form),consent=$('#privacy-consent',form),website=$('#website',form),submitLabel=$('span',submit);
  submit.disabled=false;
  const setStatus=(kind,title,message)=>{
    const strong=document.createElement('strong');strong.textContent=title;
    const span=document.createElement('span');span.textContent=message;
    status.replaceChildren(strong,span);status.hidden=false;status.dataset.state=kind;
  };
  const setError=(input,node,message)=>{if(!input||!node)return;node.textContent=message;node.hidden=!message;input.setAttribute('aria-invalid',message?'true':'false')};
  const contactValid=(method,value)=>{
    if(!value)return 'Укажите контакт для ответа.';
    if(method==='telegram'&&!/^(?:@|https?:\/\/t\.me\/)?[a-zA-Z][a-zA-Z0-9_]{4,31}\/?$/.test(value))return 'Проверьте имя пользователя Telegram или ссылку на профиль.';
    if(method==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))return 'Проверьте адрес электронной почты.';
    if(method==='phone'){const digits=value.replace(/\D/g,'');if(!/^\+?[\d\s().-]+$/.test(value)||digits.length<7||digits.length>15)return 'Проверьте номер телефона и код страны.'}
    return ['telegram','email','phone'].includes(method)?'':'Выберите способ связи.';
  };
  function validate(){
    const method=$('input[name="method"]:checked',form)?.value||'';
    const nameError=name.value.trim()?'':'Укажите, как к вам обращаться.',contactError=contactValid(method,contact.value.trim());
    const consentError=consent?.checked?'':'Подтвердите согласие на обработку персональных данных.';
    setError(name,$('#name-error',form),nameError);setError(contact,$('#contact-error',form),contactError);
    setError(consent,$('#consent-error',form),consentError);
    return {ok:!nameError&&!contactError&&!consentError,method,first:nameError?name:contactError?contact:consent};
  }
  function pending(value){busy=value;submit.disabled=value;form.setAttribute('aria-busy',String(value));if(submitLabel)submitLabel.textContent=value?'Отправляем…':'Обсудить задачу'}
  form.addEventListener('submit',async event=>{
    event.preventDefault();event.stopImmediatePropagation();
    if(busy)return;
    status.hidden=true;const checked=validate();
    if(!checked.ok){checked.first?.focus();track('form_submit_error',{stage:'validation'});return}
    const content={name:name.value.trim(),method:checked.method,contact:contact.value.trim(),company:$('#company',form)?.value.trim()||'',task:$('#task',form)?.value.trim()||'',service:$('#service-value',form)?.value||'',website:website?.value||'',pageUrl,referrer,utm,consent:true,consentVersion:CONSENT_VERSION};
    const nextSignature=JSON.stringify(content);
    if(acceptedSignature===nextSignature){setStatus('success','Заявка уже отправлена.','Мы не создали повторную заявку.');return}
    if(signature&&signature!==nextSignature)submitKey=randomKey();
    signature=nextSignature;
    const payload={...content,idempotencyKey:submitKey};
    pending(true);track('form_submit_attempt',{method:checked.method,service:content.service});
    try{
      if(!liveTransport())throw new Error('Форма доступна только на сайте SAMAI.');
      const response=await jsonFetch('/contact',payload);
      const body=await response.json().catch(()=>({}));
      if(!response.ok||body.ok!==true||body.accepted!==true)throw new Error(typeof body.error==='string'?body.error:'Не удалось отправить заявку.');
      acceptedSignature=nextSignature;
      track('form_submit_success',{method:checked.method,service:content.service,notification:body.notification||'accepted'});
      setStatus('success','Заявка отправлена.','Руководитель проекта свяжется с вами выбранным способом.');
      // Keep the chosen contact method and data visible; do not reset another
      // script's method state or create a new lead on a repeated click.
    }catch(error){
      const uncertain=error?.name==='TimeoutError'||error?.name==='TypeError';
      setStatus('error',uncertain?'Не удалось подтвердить отправку.':'Заявка не отправлена.',uncertain?'Проверьте интернет и попробуйте ещё раз. Повторная отправка не создаст вторую заявку.':(error instanceof Error?error.message:'Повторите попытку.'));
      track('form_submit_error',{stage:'transport'});
    }finally{pending(false)}
  },true);
})();
