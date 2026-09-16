(() => {
  'use strict';
  const $=(s,p=document)=>p.querySelector(s), $$=(s,p=document)=>Array.from(p.querySelectorAll(s));
  const root=document.documentElement, reduce=matchMedia('(prefers-reduced-motion: reduce)'), mobile=matchMedia('(max-width: 800px)');
  const removers=[]; let frame=0, disposed=false, threshold=null, prefooter=null;
  const listen=(el,event,fn,opt)=>{if(!el)return;el.addEventListener(event,fn,opt);removers.push(()=>el.removeEventListener(event,fn,opt));};
  const motion=()=>!reduce.matches&&root.dataset.motion!=='off'&&!document.hidden;
  function hero(){
    const el=$('.hero-a'); if(!el||$('.hero-v08-field',el))return;
    el.insertAdjacentHTML('afterbegin','<div class="hero-v08-field" aria-hidden="true"><span class="hero-v08-cross"></span></div>');
    const stage=$('.brand-stage',el); if(stage){stage.insertAdjacentHTML('beforeend','<span class="v08-orbit-label a" aria-hidden="true">strategy / control / action</span><span class="v08-orbit-label b" aria-hidden="true">SAMAI / 08</span>');}
    threshold=document.createElement('div');threshold.className='v08-threshold';threshold.setAttribute('aria-hidden','true');threshold.innerHTML='<div class="v08-threshold-grid">'+Array.from({length:8},()=>'<i></i>').join('')+'</div><span class="v08-threshold-label">strategy → coordination → decision</span>';
    el.insertAdjacentElement('afterend',threshold);
  }
  function system(){
    const sys=$('.assembly-system'); if(!sys)return;
    if(!$('.v08-system-labels',sys)) sys.insertAdjacentHTML('beforeend','<div class="v08-system-labels" aria-hidden="true"><span>Входящие сигналы</span><span>Контур управления</span><span>Рабочие решения</span></div>');
    const sync=()=>{const selected=$$('[data-assembly]',sys).findIndex(b=>b.getAttribute('aria-pressed')==='true');sys.dataset.v08State=String(selected<0?2:selected);};
    sync(); const observer=new MutationObserver(sync);$$('[data-assembly]',sys).forEach(b=>observer.observe(b,{attributes:true,attributeFilter:['aria-pressed']}));removers.push(()=>observer.disconnect());
  }
  function formats(){
    const list=$('.formats-list'); if(!list||$('.v08-format-selector',list))return;
    const services=$$('.service',list); if(services.length!==3)return;
    const labels=[['01','Консалтинг'],['02','Управление маркетингом'],['03','Внешний директор']];
    const selector=document.createElement('div');selector.className='v08-format-selector';selector.setAttribute('role','tablist');selector.setAttribute('aria-label','Уровень ответственности SAMAI');
    selector.innerHTML=labels.map(([n,t],i)=>`<button type="button" role="tab" data-v08-format="${i}" aria-selected="${i===1}"><span>${n} / 03</span><strong>${t}</strong></button>`).join('');
    list.prepend(selector);list.classList.add('v08-selector-ready');
    const activate=(index,focus=false)=>{
      services.forEach((service,i)=>{const active=i===index;service.dataset.v08Active=String(active);if(!mobile.matches)service.open=active;});
      $$('[data-v08-format]',selector).forEach((button,i)=>{button.setAttribute('aria-selected',String(i===index));button.tabIndex=i===index?0:-1;});
      if(focus)$$('[data-v08-format]',selector)[index]?.focus({preventScroll:true});
      document.dispatchEvent(new CustomEvent('samai:layout'));
    };
    activate(1);
    $$('[data-v08-format]',selector).forEach((button,i)=>{
      listen(button,'click',()=>activate(i));
      listen(button,'keydown',e=>{let next=i;if(e.key==='ArrowRight')next=(i+1)%3;else if(e.key==='ArrowLeft')next=(i+2)%3;else if(e.key==='Home')next=0;else if(e.key==='End')next=2;else return;e.preventDefault();activate(next,true);});
    });
    const mq=()=>{if(mobile.matches){services.forEach(s=>s.dataset.v08Active='true');}else{const selected=$$('[data-v08-format]',selector).findIndex(b=>b.getAttribute('aria-selected')==='true');activate(selected<0?1:selected);}};
    listen(mobile,'change',mq);mq();
  }
  function process(){
    const section=$('.process'),stage=$('.process-stage');if(!section||!stage)return;
    $$('.process-copy',section).forEach((copy,i)=>copy.dataset.v08Watermark=String(i+1).padStart(2,'0'));
    stage.insertAdjacentHTML('afterbegin','<span class="v08-process-index" aria-hidden="true">01 / 04</span><div class="v08-process-meter" aria-hidden="true"><i class="active"></i><i></i><i></i><i></i></div>');
    const set=index=>{section.dataset.v08Step=String(index);const label=$('.v08-process-index',stage);if(label)label.textContent=`${String(index+1).padStart(2,'0')} / 04`;$$('.v08-process-meter i',stage).forEach((x,i)=>x.classList.toggle('active',i===index));};
    const selected=$$('.process-controls [data-step]').findIndex(b=>b.getAttribute('aria-selected')==='true');set(selected<0?0:selected);
    listen(document,'samai:step',e=>set(Math.max(0,Math.min(3,Number(e.detail?.index)||0))));
  }
  function footerTransition(){
    const contact=$('#contact');if(!contact||$('.v08-prefooter'))return;
    prefooter=document.createElement('section');prefooter.className='v08-prefooter';prefooter.setAttribute('aria-label','Переход к обсуждению проекта');
    prefooter.innerHTML='<div class="wrap v08-prefooter-inner"><span class="v08-prefooter-kicker">SAMAI / рабочий контур</span><h2><span>Стратегия становится</span><span>управлением.</span></h2><p class="v08-prefooter-meta">Определяем приоритеты, связываем исполнителей и фиксируем следующий шаг. Если задача требует другой зоны ответственности — скажем об этом до старта.</p><i class="v08-prefooter-rule" aria-hidden="true"></i></div>';
    contact.parentNode.insertBefore(prefooter,contact);
  }
  function tick(){
    frame=0;if(disposed)return;
    const hero=$('.hero-a');
    if(hero&&motion()&&!mobile.matches){const r=hero.getBoundingClientRect(),p=Math.max(0,Math.min(1,-r.top/Math.max(1,r.height)));hero.style.setProperty('--hero-shift',`${p*62}px`);}else hero?.style.setProperty('--hero-shift','0px');
    if(threshold){const r=threshold.getBoundingClientRect(),p=Math.max(0,Math.min(1,1-r.top/innerHeight));threshold.style.setProperty('--threshold-progress',p.toFixed(3));}
    if(prefooter){const r=prefooter.getBoundingClientRect(),p=Math.max(.08,Math.min(1,1-r.top/innerHeight));prefooter.style.setProperty('--prefooter-progress',p.toFixed(3));}
  }
  function schedule(){if(!frame&&!disposed)frame=requestAnimationFrame(tick);}
  hero();system();formats();process();footerTransition();schedule();
  listen(window,'scroll',schedule,{passive:true});listen(window,'resize',schedule,{passive:true});listen(reduce,'change',schedule);listen(document,'samai:motionchange',schedule);listen(document,'visibilitychange',schedule);
  window.SamaiV08={version:'8.0.0',destroy(){disposed=true;removers.forEach(fn=>fn());if(frame)cancelAnimationFrame(frame);}};
})();
