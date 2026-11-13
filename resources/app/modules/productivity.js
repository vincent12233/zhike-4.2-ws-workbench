(() => {
  'use strict';
  const view=document.querySelector('#viewContainer'),desktop=window.zhikeDesktop;
  const host=()=>window.__zhikeRegistryHost;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const day=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
  const customer=id=>host()?.state.customers.find(c=>String(c.id)===String(id)&&!c.deleted);
  const phone=value=>{const n=String(value||'').replace(/\D/g,'');return n.length===12&&n.startsWith('91')?n.slice(2):n;};
  function readLocal(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
  function writeLocal(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
  async function modify(id,label,apply){
    const h=host(),c=customer(id);if(!c)return;
    if(!await h.snapshotBeforeWrite(label))return;
    const before=JSON.parse(JSON.stringify(c)),activitiesBefore=JSON.parse(JSON.stringify(h.state.activities||[]));
    try{apply(c);c.touched=true;h.persist();h.activity(label+'：'+c.name);await h.flushStateWrites();h.render();h.toast('已保存');}
    catch(error){for(const key of Object.keys(c))if(!Object.hasOwn(before,key))delete c[key];Object.assign(c,before);h.state.activities=activitiesBefore;h.persist();h.render();h.toast('保存失败，已恢复客户资料','x');}
  }
  function open(id){const c=customer(id);if(c){host().closeModal();host().showCustomer(c);}}
  document.addEventListener('click',e=>{const b=e.target.closest('[data-product-customer]');if(b)open(b.dataset.productCustomer);});
  function batches(){
    const h=host();if(!h||h.state.view!=='intake'||view.querySelector('#intakeBatchHistory'))return;
    const section=document.createElement('section');section.id='intakeBatchHistory';section.className='panel productivity-panel';
    const rows=h.state.settings.intakeBatches||[];
    section.innerHTML='<div class="panel-heading"><h2 class="panel-title">最近录入批次</h2><span class="panel-note">最多保留 200 批</span></div><div class="productivity-body">'+(rows.slice(0,10).map((r,i)=>'<button class="batch-history-item" data-product-batch="'+i+'"><strong>'+esc(new Date(r.createdAt).toLocaleString())+'</strong><span>新增 '+Number(r.added||0)+' · 保留待处理 '+Number(r.remaining||0)+' · 查看客户 →</span></button>').join('')||'<p>完成一次快速录入后，将在这里显示批次结果。</p>')+'</div>';
    view.append(section);
    section.addEventListener('click',e=>{const b=e.target.closest('[data-product-batch]');if(!b)return;const batch=rows[Number(b.dataset.productBatch)],customers=(batch.customerIds||[]).map(customer).filter(Boolean);h.openModal('批次客户','本批新增 '+batch.added+' 位，当前可查看 '+customers.length+' 位','<div class="ops-stage-list">'+customers.map(c=>'<button class="btn" data-product-customer="'+esc(c.id)+'">'+esc(c.name)+' · '+esc(c.rawPhone||c.phone)+' →</button>').join('')+'</div>','<button class="btn" data-action="close-modal">关闭</button>');});
  }
  function duplicates(){
    const h=host();if(h?.state.view!=='intake')return;
    const panel=view.querySelector('.intake-preview-panel');if(!panel)return;
    const known=new Map();for(const c of h.state.customers){if(c.deleted)continue;for(const number of [c.phone,c.rawPhone,...(c.legacyPhones||[])])if(phone(number))known.set(phone(number),c);}
    const matches=[...new Set((h.state.parsed||[]).map(r=>known.get(phone(r.phone||r.rawPhone))?.id).filter(Boolean))].map(customer).filter(Boolean);
    const signature=matches.map(c=>c.id+':'+c.name).join('|');let box=panel.querySelector('#duplicateCustomers');
    if(box?.dataset.signature===signature)return;if(box)box.remove();if(!matches.length)return;
    box=document.createElement('div');box.id='duplicateCustomers';box.dataset.signature=signature;box.className='duplicate-customers';
    box.innerHTML='<strong>重复号码已属于以下客户，点击查看档案：</strong>'+matches.slice(0,30).map(c=>'<button class="btn small" data-product-customer="'+esc(c.id)+'">'+esc(c.name)+' · '+esc(c.rawPhone||c.phone)+'</button>').join('');panel.prepend(box);
  }
  let dragged=null;
  function homeLayout(){
    if(host()?.state.view!=='home')return;
    const groups=[['home-main','.home-main-grid'],['home-bottom','.home-bottom-grid']];
    [...view.querySelectorAll('.metric-grid>.metric-card')].forEach((card,index)=>card.dataset.layoutKey='home-metric-'+index);
    for(const [key,selector] of groups){const parent=view.querySelector(selector);if(!parent||parent.dataset.reorderReady)return;parent.dataset.reorderReady='1';const cards=[...parent.children];cards.forEach((card,index)=>card.dataset.layoutKey=key+'-'+index);const order=readLocal('zhike-layout-'+key,[]);for(const id of order){const card=cards.find(c=>c.dataset.layoutKey===id);if(card)parent.append(card);}
      for(const card of cards){const heading=card.querySelector('.panel-heading');if(!heading)continue;heading.draggable=true;heading.title='拖动调整模块顺序';heading.classList.add('home-drag-handle');heading.addEventListener('dragstart',e=>{dragged={kind:'home',card,parent};e.dataTransfer.setData('text/plain',card.dataset.layoutKey);});card.addEventListener('dragover',e=>{if(dragged?.kind==='home'&&dragged.parent===parent)e.preventDefault();});card.addEventListener('drop',e=>{if(dragged?.kind!=='home'||dragged.parent!==parent)return;e.preventDefault();parent.insertBefore(dragged.card,card);writeLocal('zhike-layout-'+key,[...parent.children].map(c=>c.dataset.layoutKey));dragged=null;});}
    }
    if(!view.querySelector('#homeLayoutButton')){const b=document.createElement('button');b.id='homeLayoutButton';b.className='btn';b.textContent='自定义首页';view.querySelector('.heading-actions')?.prepend(b);b.onclick=()=>{
      const panels=[...view.querySelectorAll('.metric-grid>.metric-card,.home-main-grid>.panel,.home-bottom-grid>.panel')],hidden=readLocal('zhike-home-hidden',[]);
      host().openModal('自定义首页','拖动模块标题调整顺序；隐藏偏好仅保存在当前电脑。','<div class="productivity-body">'+panels.map(p=>'<label class="home-module-choice"><input type="checkbox" data-home-module="'+esc(p.dataset.layoutKey)+'" '+(!hidden.includes(p.dataset.layoutKey)?'checked':'')+'> '+esc(p.querySelector('.panel-title,.metric-label')?.textContent)+'</label>').join('')+'</div>','<button class="btn" id="resetHomeLayout">恢复默认</button><button class="btn primary" id="saveHomeLayout">保存</button>');
      document.querySelector('#saveHomeLayout').onclick=()=>{writeLocal('zhike-home-hidden',[...document.querySelectorAll('[data-home-module]')].filter(x=>!x.checked).map(x=>x.dataset.homeModule));host().closeModal();host().render();};
      document.querySelector('#resetHomeLayout').onclick=()=>{for(const key of ['home-main','home-bottom'])writeLocal('zhike-layout-'+key,[]);writeLocal('zhike-home-hidden',[]);host().closeModal();host().render();};
    };}
    const hidden=readLocal('zhike-home-hidden',[]);for(const panel of view.querySelectorAll('[data-layout-key]'))panel.hidden=hidden.includes(panel.dataset.layoutKey);
  }
  function stageDrag(){
    if(host()?.state.view!=='stage-board')return;
    for(const card of view.querySelectorAll('[data-ops-customer]')){if(card.dataset.dragReady)continue;card.dataset.dragReady='1';card.draggable=true;card.addEventListener('dragstart',e=>{dragged={kind:'customer',id:card.dataset.opsCustomer};e.dataTransfer.setData('text/plain',card.dataset.opsCustomer);});}
    for(const column of view.querySelectorAll('.ops-column')){if(column.dataset.dropReady)continue;column.dataset.dropReady='1';column.addEventListener('dragover',e=>{if(dragged?.kind==='customer'){e.preventDefault();column.classList.add('drag-target');}});column.addEventListener('dragleave',()=>column.classList.remove('drag-target'));column.addEventListener('drop',async e=>{column.classList.remove('drag-target');if(dragged?.kind!=='customer')return;e.preventDefault();const id=dragged.id;dragged=null;const phase=column.querySelector('.ops-stage-open strong')?.textContent,c=customer(id);if(!phase||!c||c.phase===phase)return;await modify(id,'拖动调整客户阶段',c=>{const from=c.phase||'未设置';c.phase=phase;c.phaseHistory=[...(c.phaseHistory||[]),{from,to:phase,at:new Date().toISOString()}].slice(-100);});});}
  }
  document.addEventListener('dragend',()=>{dragged=null;document.querySelectorAll('.drag-target').forEach(x=>x.classList.remove('drag-target'));});
  let menu;
  function closeMenu(){menu?.remove();menu=null;}
  document.addEventListener('contextmenu',e=>{
    const row=e.target.closest('[data-customer],[data-ops-customer]');if(!row)return;
    const id=row.dataset.customer||row.dataset.opsCustomer,c=customer(id);if(!c)return;e.preventDefault();closeMenu();menu=document.createElement('div');menu.className='customer-context-menu';menu.setAttribute('role','menu');
    menu.innerHTML=[['open','查看档案'],['copy','复制号码'],['follow','登记跟进'],['owner','分配助理'],['date','安排跟进日期']].map(([key,label])=>'<button role="menuitem" data-context="'+key+'">'+label+'</button>').join('');document.body.append(menu);menu.style.left=Math.min(e.clientX,window.innerWidth-190)+'px';menu.style.top=Math.min(e.clientY,window.innerHeight-230)+'px';menu.querySelector('button').focus();
    menu.onclick=async event=>{const action=event.target.closest('[data-context]')?.dataset.context;if(!action)return;closeMenu();
      if(action==='open')open(id);
      if(action==='copy'){try{await desktop.tools({action:'copy',text:c.rawPhone||c.phone});host().toast('号码已复制');}catch{host().toast('复制失败','x');}}
      if(action==='follow'){const b=document.createElement('button');b.dataset.action='follow';b.dataset.id=id;b.hidden=true;document.body.append(b);b.click();b.remove();}
      if(action==='owner'){const owner=await host().requestText('分配跟进助理','请输入助理名称。',c.assistant||'未分配',{label:'助理名称',maxLength:80});if(owner?.trim())await modify(id,'分配助理',c=>c.assistant=owner.trim().slice(0,80));}
      if(action==='date'){const due=await host().requestText('安排跟进日期','格式为 YYYY-MM-DD。',c.due&&c.due!=='—'?c.due:day(),{label:'跟进日期',type:'date'});if(due===null)return;if(!window.ZhikeOperationsCore.validDate(due)){host().toast('日期无效','x');return;}await modify(id,'安排跟进日期',c=>c.due=due);}
    };
  });
  document.addEventListener('click',e=>{if(menu&&!menu.contains(e.target))closeMenu();});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();});window.addEventListener('blur',closeMenu);
  function columnSizes(){
    for(const table of view.querySelectorAll('.data-table')){if(table.dataset.resizeReady)continue;table.dataset.resizeReady='1';const key='zhike-columns-'+host()?.state.view,sizes=readLocal(key,{});for(const [index,th] of [...table.querySelectorAll('thead th')].entries()){if(sizes[index])th.style.width=th.style.minWidth=sizes[index]+'px';const handle=document.createElement('span');handle.className='column-resizer';handle.title='拖动调整列宽';th.append(handle);handle.onpointerdown=e=>{e.preventDefault();e.stopPropagation();const start=e.clientX,width=th.getBoundingClientRect().width;handle.setPointerCapture(e.pointerId);handle.onpointermove=event=>{const size=Math.max(48,Math.min(800,width+event.clientX-start));th.style.width=th.style.minWidth=size+'px';sizes[index]=size;};handle.onpointerup=()=>{handle.onpointermove=null;writeLocal(key,sizes);};};}}
  }
  function businessEditButtons(){
    const h=host();if(!h||!['tickets','deposits'].includes(h.state.view))return;
    view.querySelectorAll('[data-action="delete-business-record"]').forEach(button=>{if(button.previousElementSibling?.dataset?.action==='edit-business-record')return;const edit=document.createElement('button');edit.className='table-action';edit.textContent='编辑';edit.dataset.action='edit-business-record';edit.dataset.kind=button.dataset.kind;edit.dataset.id=button.dataset.id;button.before(edit);});
  }
  function intakeGuard(){const h=host();if(!h||h.state.view!=='intake')return;const button=view.querySelector('.intake-submit'),textarea=view.querySelector('#intakeText'),good=(h.state.parsed||[]).filter(row=>!row.issues?.length&&String(row.phone||'').length===10).length;if(textarea)textarea.setAttribute('aria-label','粘贴或输入客户资料');if(button){button.disabled=good===0;button.title=good===0?'请先粘贴或导入有效客户资料':`将写入 ${good} 位新客户`;}}
  async function settings(){
    const h=host();if(h?.state.view!=='settings'||view.querySelector('#desktopToolsSettings'))return;
    const panel=document.createElement('section');panel.id='desktopToolsSettings';panel.className='panel productivity-panel';
    panel.innerHTML='<div class="panel-heading"><h2 class="panel-title">跟进提醒与自动备份</h2></div><div class="productivity-body"><label class="home-module-choice"><input type="checkbox" id="desktopReminder">启用到期桌面提醒</label><button class="btn" id="snoozeReminder">全部稍后提醒 15 分钟</button><hr><p>自动备份仅在应用运行期间执行，备份包含业务与设置，不含 API Key。</p><div class="productivity-settings"><button class="btn" id="backupDirectory">选择备份目录</button><label>间隔（分钟）<input id="backupMinutes" type="number" min="15" max="1440" value="60"></label><label>保留份数<input id="backupKeep" type="number" min="3" max="100" value="10"></label><label><input id="backupEnabled" type="checkbox">启用定时备份</label><button class="btn primary" id="saveDesktopTools">保存</button><button class="btn" id="backupNow">立即备份</button></div><p id="desktopBackupStatus" role="status">正在读取备份设置…</p></div>';
    view.append(panel);panel.querySelector('#desktopReminder').checked=Boolean(h.state.settings.desktopReminders);
    const saveSetting=async(key,value,label)=>{const previous=h.state.settings[key];h.state.settings[key]=value;h.persist();try{await h.flushStateWrites();h.toast(label);}catch(error){if(previous===undefined)delete h.state.settings[key];else h.state.settings[key]=previous;h.persist();h.toast(error.message||'设置保存失败，已恢复原值','x');}};
    panel.querySelector('#desktopReminder').onchange=()=>{void saveSetting('desktopReminders',panel.querySelector('#desktopReminder').checked,panel.querySelector('#desktopReminder').checked?'桌面提醒已开启':'桌面提醒已关闭');};
    panel.querySelector('#snoozeReminder').onclick=()=>{void saveSetting('reminderSnoozeUntil',Date.now()+15*60000,'15 分钟后继续提醒');};
    const status=panel.querySelector('#desktopBackupStatus');
    const load=async()=>{try{const c=await desktop.tools({action:'status'});if(!panel.isConnected)return;panel.querySelector('#backupMinutes').value=c.minutes||60;panel.querySelector('#backupKeep').value=c.keep||10;panel.querySelector('#backupEnabled').checked=Boolean(c.enabled);status.textContent=(c.directory||'尚未选择目录')+' · 最近备份：'+(c.lastAt?new Date(c.lastAt).toLocaleString():'无')+(c.lastError?' · '+c.lastError:'');}catch(e){status.textContent=e.message;}};
    panel.querySelector('#backupDirectory').onclick=async()=>{await desktop.tools({action:'directory'});load();};
    panel.querySelector('#saveDesktopTools').onclick=async()=>{try{await desktop.tools({action:'configure',minutes:panel.querySelector('#backupMinutes').value,keep:panel.querySelector('#backupKeep').value,enabled:panel.querySelector('#backupEnabled').checked});h.toast('备份设置已保存');load();}catch(e){status.textContent=e.message;}};
    panel.querySelector('#backupNow').onclick=async()=>{try{await h.flushStateWrites();const result=await desktop.tools({action:'backup'});if(result.skipped)throw Error('请先选择备份目录');h.toast('完整备份已生成');load();}catch(e){status.textContent=e.message;}};load();
  }
  const notified=new Map();
  async function reminders(){
    const h=host();if(!h||!desktop||!h.state.settings.desktopReminders||Date.now()<(h.state.settings.reminderSnoozeUntil||0))return;
    const due=h.state.customers.filter(c=>!c.deleted&&/^\d{4}-\d{2}-\d{2}$/.test(c.due||'')&&c.due<=day());
    let count=0;for(const c of due){const key=c.id+':'+c.due;if(Date.now()-(notified.get(key)||0)<60*60000)continue;try{const result=await desktop.tools({action:'notify',id:c.id,body:c.name+' · '+(c.due<day()?'已逾期':'今日到期')+' · 点击查看客户'});notified.set(key,Date.now());if(!result.supported)h.toast('当前系统不支持桌面通知，可在首页查看待跟进');}catch{}if(++count>=3)break;}
  }
  desktop?.onCustomer(open);desktop?.onError(message=>host()?.toast(message,'x'));
  let queued=false;function refresh(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;if(!host())return;batches();duplicates();homeLayout();stageDrag();columnSizes();settings();businessEditButtons();intakeGuard();});}
  new MutationObserver(refresh).observe(view,{childList:true,subtree:true});
  // The production WinUI host polls due reminders on its native timer, so
  // minimizing the window or switching routes cannot pause notifications.
  // The browser fallback retains the old timer for development only.
  let reminderTimer;const startReminderTimer=()=>{clearInterval(reminderTimer);if(desktop)return;reminderTimer=setInterval(()=>reminders().catch(()=>{}),30000);};startReminderTimer();document.addEventListener('visibilitychange',startReminderTimer);refresh();
})();
