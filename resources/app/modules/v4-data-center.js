(() => {
  const view=document.querySelector('#viewContainer'),modal=document.querySelector('#modal');if(!view||!modal)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
  const defaults=['已联系，客户有明确意向，明日继续跟进','已发送资料，等待客户确认','客户已报名，需在24小时内完成回访','暂未接通，计划稍后重试'];let cache=null;
  const download=(name,data,type='application/json;charset=utf-8')=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  async function state(force=false){if(cache&&!force)return cache;const r=await fetch('/api/state',{cache:'no-store'});if(!r.ok)throw new Error('无法读取本机数据');return cache=await r.json();}
  async function save(data){const version=String(data.version??'');delete data.version;delete data.initialized;data.schemaVersion=4;const r=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json','X-State-Version':version},body:JSON.stringify(data)});if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||'保存失败');cache=null;try{await window.__zhikeRegistryHost?.refreshState?.();}catch(error){console.warn('[知客] 数据中心写入成功，但主界面刷新失败：',error?.message||error);}}
  async function archiveSummary(){if(!view.querySelector('#recentSnapshot')||view.querySelector('#v4ArchiveBridge'))return;const s=document.createElement('section');s.id='v4ArchiveBridge';s.className='panel v4-panel v4-archive-bridge';s.innerHTML='<div class="panel-heading"><h2 class="panel-title">数据档案库连接</h2><span class="panel-note" data-v4-archive-source>本机 SQLite 连接中…</span></div><div class="v4-health-grid v4-archive-grid"><div><span>客户主档</span><strong data-v4-archive="customers">—</strong></div><div><span>WS 联系人</span><strong data-v4-archive="contacts">—</strong></div><div><span>完整历史</span><strong data-v4-archive="history">—</strong></div><div><span>双方消息</span><strong data-v4-archive="messages">—</strong></div><div><span>AI 待处理</span><strong data-v4-archive="pending">—</strong></div><div><span>待跟进提醒</span><strong data-v4-archive="followups">—</strong></div><div><span>群组事件</span><strong data-v4-archive="groups">—</strong></div><div><span>未关联会话</span><strong data-v4-archive="unlinked">—</strong></div></div><div class="v4-archive-footer"><span data-v4-archive-status>正在读取 WS 与客户主档连接状态…</span><button class="btn small" data-v4-refresh-archive>刷新档案链路</button></div>';view.appendChild(s);const load=async()=>{const response=await fetch('/api/data-archive/summary?allAccounts=1',{cache:'no-store'});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'数据档案库读取失败');const set=(key,value)=>{const node=s.querySelector(`[data-v4-archive="${key}"]`);if(node)node.textContent=Number(value||0).toLocaleString();};set('customers',payload.crm?.activeCustomers);set('contacts',payload.ws?.directContacts);set('history',payload.ws?.completeHistoryConversations);set('messages',payload.ws?.messages);set('pending',payload.ws?.aiJobsPending||payload.ws?.analysesPending||payload.ws?.collectionPending);set('followups',payload.ws?.followupAlertsOpen);set('groups',payload.ws?.groupMembershipEvents);set('unlinked',payload.links?.unlinkedDirectConversations);const accountCount=Array.isArray(payload.accounts)?payload.accounts.length:0;s.querySelector('[data-v4-archive-source]').textContent=`本机 SQLite · ${accountCount} 个 WS 账号`;s.querySelector('[data-v4-archive-status]').textContent=`已连接：${payload.ws?.conversations||0} 个会话、${payload.crm?.linkedCustomers||0} 个客户已建立关联`;};s.querySelector('[data-v4-refresh-archive]').onclick=()=>load().catch(error=>{s.querySelector('[data-v4-archive-status]').textContent=error.message||'档案读取失败';});load().catch(error=>{s.querySelector('[data-v4-archive-source]').textContent='连接异常';s.querySelector('[data-v4-archive-status]').textContent=error.message||'数据档案库读取失败';});}
  async function dataCenter(){if(!view.querySelector('#recentSnapshot')||view.querySelector('#v4Diagnostics'))return;const s=document.createElement('section');s.id='v4Diagnostics';s.className='panel v4-panel';s.innerHTML='<div class="panel-heading"><h2 class="panel-title">6.0 数据库健康与诊断</h2><span class="panel-note">结构、完整性、关联与异常数据检查</span></div><div class="v4-health-grid"><div><span>数据库结构</span><strong id="v4Schema">检查中…</strong></div><div><span>完整性</span><strong id="v4Integrity">检查中…</strong></div><div><span>关联异常</span><strong id="v4Orphans">检查中…</strong></div><div><span>数据库大小</span><strong id="v4Size">检查中…</strong></div></div><div class="v4-actions"><button class="btn" id="v4RunDiagnostic">重新检查</button><button class="btn" id="v4DownloadDiagnostic" disabled title="取得有效诊断报告后可导出">导出诊断报告</button><button class="btn" id="v4DownloadMigration">导出迁移报告</button><button class="btn" id="v4DownloadImport">导出导入报告</button></div><pre class="v4-report" id="v4Report"></pre>';view.appendChild(s);
    const fields=['#v4Schema','#v4Integrity','#v4Orphans','#v4Size'].map(selector=>s.querySelector(selector));
    const [schema,integrity,orphans,size]=fields;
    const reportOutput=s.querySelector('#v4Report');
    const exportButton=s.querySelector('#v4DownloadDiagnostic');
    let report=null,activeRequest=0;
    const run=async()=>{
      const request=++activeRequest;
      const ownsResult=()=>request===activeRequest&&view.querySelector('#v4Diagnostics')===s;
      report=null;
      exportButton.disabled=true;
      fields.forEach(field=>field.textContent='检查中…');
      reportOutput.textContent='';
      try{
        const response=await fetch('/api/diagnostics',{cache:'no-store'});
        if(!response.ok)throw new Error('诊断服务不可用');
        const value=await response.json();
        if(!ownsResult())return;
        const orphaned=value?.anomalies?.orphaned;
        const counts=orphaned&&typeof orphaned==='object'&&!Array.isArray(orphaned)?Object.values(orphaned):[];
        if(typeof value?.ok!=='boolean'||!Number.isInteger(value.schemaVersion)||value.schemaVersion<0
          ||!Number.isFinite(value.databaseBytes)||value.databaseBytes<0
          ||!counts.length||['tickets','deposits','followups','registrations'].some(key=>!Object.hasOwn(orphaned,key))
          ||counts.some(count=>!Number.isInteger(count)||count<0))throw new Error('诊断结果不完整');
        report=value;
        schema.textContent='v'+report.schemaVersion;
        integrity.textContent=report.ok?'正常':'需要处理';
        orphans.textContent=counts.reduce((total,count)=>total+count,0);
        size.textContent=(report.databaseBytes/1048576).toFixed(2)+' MB';
        reportOutput.textContent=JSON.stringify(report,null,2);
        exportButton.disabled=false;
      }catch{
        if(!ownsResult())return;
        fields.forEach(field=>field.textContent='—');
        reportOutput.textContent='数据库诊断读取失败，请重新检查。';
      }
    };
    s.querySelector('#v4RunDiagnostic').onclick=run;
    exportButton.onclick=()=>report&&download(`知客6.0诊断报告_${today()}.json`,JSON.stringify(report,null,2));s.querySelector('#v4DownloadMigration').onclick=async()=>{const x=await state(true);download(`知客6.0迁移报告_${today()}.json`,JSON.stringify({schemaVersion:4,generatedAt:new Date().toISOString(),sourceVersion:x.schemaVersion||3,counts:{customers:x.customers?.length||0,registrations:x.registrations?.length||0,followups:x.followups?.length||0,tickets:x.tickets?.length||0,deposits:x.deposits?.length||0},result:'兼容升级完成，原始记录保留'},null,2));};s.querySelector('#v4DownloadImport').onclick=async()=>{const x=await state(true),issues=x.importIssues||[];download(`知客6.0导入报告_${today()}.json`,JSON.stringify({generatedAt:new Date().toISOString(),issues,summary:{total:issues.length,pending:issues.filter(i=>!i.resolved&&!i.ignored).length,resolved:issues.filter(i=>i.resolved).length,ignored:issues.filter(i=>i.ignored).length}},null,2));};
    void run();
  }
  async function automation(){if(![...view.querySelectorAll('h1')].some(n=>n.textContent.includes('自动化'))||view.querySelector('#v4Templates'))return;const x=await state(true),customers=x.customers||[],regs=x.registrations||[],follows=x.followups||[],date=today(),last=new Map();follows.forEach(f=>last.set(String(f.customerId),String(f.date||'').slice(0,10)));const high=customers.filter(c=>!c.deleted&&/^[SA]级/.test(c.qualification||'')&&(!last.get(String(c.id))||last.get(String(c.id))<date)).length,due=regs.filter(r=>r.status==='已报名'&&(!last.get(String(r.customerId))||last.get(String(r.customerId))<String(r.date).slice(0,10))).length,templates=x.settings?.followTemplates||defaults;view.insertAdjacentHTML('beforeend',`<section id="v4Templates" class="panel v4-panel"><div class="panel-heading"><h2 class="panel-title">跟进模板与智能提醒</h2><span class="panel-note">模板会出现在登记跟进窗口</span></div><div class="v4-health-grid"><div><span>高评级未跟进</span><strong>${high}</strong></div><div><span>报名未跟进</span><strong>${due}</strong></div><div><span>跟进结果模板</span><strong>${templates.length}</strong></div><div><span>快捷排期</span><strong>今日/明日/3天/7天</strong></div></div><div class="v4-template-list">${templates.map((t,i)=>`<button class="btn" data-v4-edit-template="${i}" title="点击修改">${esc(t.slice(0,12))}</button>`).join('')}<button class="btn primary" data-v4-add-template>新增模板</button></div></section>`);}
  async function analytics(){if(![...view.querySelectorAll('h1')].some(n=>n.textContent.includes('统计分析'))||view.querySelector('#v4Conversion'))return;const x=await state(true);view.insertAdjacentHTML('beforeend','<section id="v4Conversion" class="panel v4-panel"><div class="panel-heading"><h2 class="panel-title">6.0 多维转化中心</h2><span class="panel-note">日期、渠道、页面、助理与评级联动 · 各业务项独立按客户去重</span></div><div class="v4-filter-grid"><label>开始日期<input type="date" data-v4-filter="from"></label><label>结束日期<input type="date" data-v4-filter="to"></label><label>渠道<select data-v4-filter="source"></select></label><label>页面<select data-v4-filter="page"></select></label><label>助理<select data-v4-filter="assistant"></select></label><label>评级<select data-v4-filter="grade"><option value="">全部</option><option>S</option><option>A</option><option>B</option><option>C</option><option>D</option><option>E</option></select></label></div><div class="v4-funnel" data-v4-funnel></div><div class="v4-grade-row" data-v4-grades></div><div class="v4-dimension-table" data-v4-dimensions></div></section>');const box=view.querySelector('#v4Conversion'),customers=(x.customers||[]).filter(c=>!c.deleted),countDimension=(rows,key)=>{const counts=new Map();for(const row of rows){const value=row?.[key];if(value)counts.set(value,(counts.get(value)||0)+1);}return counts;},dimensionOptions=Object.fromEntries(['source','page','assistant'].map(key=>[key,[...countDimension(customers,key).keys()].sort()]));for(const k of ['source','page','assistant'])box.querySelector(`[data-v4-filter="${k}"]`).innerHTML='<option value="">全部</option>'+dimensionOptions[k].map(v=>`<option>${esc(v)}</option>`).join('');const render=()=>{const f=Object.fromEntries([...box.querySelectorAll('[data-v4-filter]')].map(i=>[i.dataset.v4Filter,i.value])),list=customers.filter(c=>(!f.from||c.registered>=f.from)&&(!f.to||c.registered<=f.to)&&(!f.source||c.source===f.source)&&(!f.page||c.page===f.page)&&(!f.assistant||c.assistant===f.assistant)&&(!f.grade||(c.qualification||'').startsWith(f.grade))),ids=new Set(list.map(c=>String(c.id))),regs=(x.registrations||[]).filter(r=>r.status==='已报名'&&ids.has(String(r.customerId))&&(!f.from||String(r.date)>=f.from)&&(!f.to||String(r.date)<=`${f.to}T23:59`)),ticketDate=r=>window.ZhikeTicketRecords?.effectiveTicketDate?.(r)||String(r.date||''),tickets=(x.tickets||[]).filter(r=>ids.has(String(r.customerId))&&(!f.from||ticketDate(r)>=f.from)&&(!f.to||ticketDate(r)<=f.to)),deposits=(x.deposits||[]).filter(r=>ids.has(String(r.customerId))&&(!f.from||r.date>=f.from)&&(!f.to||r.date<=f.to)),steps=[['新增',list.length],['报名',new Set(regs.map(r=>String(r.customerId))).size],['跟票',new Set(tickets.map(r=>String(r.customerId))).size],['入金',new Set(deposits.map(r=>String(r.customerId))).size]];box.querySelector('[data-v4-funnel]').innerHTML=steps.map(([label,count],index)=>{
      const previous=steps[index-1]?.[1];
      const detail=index===0?'筛选客户':previous?`${Math.round(count/Math.max(1,previous)*100)}% 相对上一项`:'无可比基数';
      const width=count?Math.max(4,count/Math.max(1,list.length)*100):0;
      return `<div><span>${label}</span><strong>${count}</strong><small>${detail}</small><i style="width:${width}%"></i></div>`;
    }).join('');const gradeCounts=new Map(['S','A','B','C','D','E'].map(grade=>[grade,0]));for(const customer of list){const grade=String(customer.qualification||'').slice(0,1);if(gradeCounts.has(grade))gradeCounts.set(grade,gradeCounts.get(grade)+1);}box.querySelector('[data-v4-grades]').innerHTML=[...gradeCounts].map(([grade,count])=>`<span><b>${grade}</b>${count}</span>`).join('');const group=key=>[...countDimension(list,key)].sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0])));box.querySelector('[data-v4-dimensions]').innerHTML=`<table class="data-table"><thead><tr><th>维度</th><th>分类</th><th>客户数</th></tr></thead><tbody>${[['渠道',group('source')],['页面',group('page')],['助理',group('assistant')]].flatMap(([label,rows])=>rows.map(([name,count])=>`<tr><td>${label}</td><td>${esc(name)}</td><td>${count}</td></tr>`)).join('')||'<tr><td colspan="3">暂无数据</td></tr>'}</tbody></table>`;};box.onchange=render;render();}
  let batchLogPending=null;
  async function batchLog(){
    if(document.documentElement.dataset.view!=='activity'||view.querySelector('#v4BatchLog'))return;
    const search=view.querySelector('[data-activity-search]');
    if(!search||batchLogPending===search)return;
    batchLogPending=search;
    try{
      const x=await state(true);
      // The operation-history search input belongs to one render of the route.
      if(document.documentElement.dataset.view!=='activity'||view.querySelector('[data-activity-search]')!==search||view.querySelector('#v4BatchLog'))return;
      const rows=x.batchOperations||[];
      view.insertAdjacentHTML('beforeend',`<section id="v4BatchLog" class="panel table-panel v4-panel"><div class="panel-heading"><h2 class="panel-title">批量运营操作记录</h2><span class="panel-note">持久化保留最近 500 次</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>时间</th><th>类型</th><th>目标值</th><th>数量</th><th>状态</th></tr></thead><tbody>${rows.map(op=>`<tr><td>${esc(new Date(op.createdAt).toLocaleString())}</td><td>${esc(op.type)}</td><td>${esc(op.value||'清空')}</td><td>${op.count||0}</td><td>${esc(op.status||'已执行')}</td></tr>`).join('')||'<tr><td colspan="5">暂无批量操作</td></tr>'}</tbody></table></div></section>`);
    }finally{if(batchLogPending===search)batchLogPending=null;}
  }
  let registrationHistoryPending=null;
  async function registrationHistory(){
    const drawer=document.querySelector('#customerDrawer.open'),customerId=String(drawer?.dataset.customerId??'');
    if(!drawer||!customerId.trim()||drawer.querySelector('#v4RegistrationHistory'))return;
    const actions=drawer.querySelector('.drawer-actions');if(!actions)return;
    if(registrationHistoryPending?.drawer===drawer&&registrationHistoryPending.customerId===customerId&&registrationHistoryPending.actions===actions)return;
    const pending={drawer,customerId,actions};registrationHistoryPending=pending;
    // The drawer is reused by the host.  Both identity and content generation
    // must still belong to this read before a success or failure is mounted.
    const current=()=>registrationHistoryPending===pending&&document.querySelector('#customerDrawer.open')===drawer&&String(drawer.dataset.customerId??'')===customerId&&drawer.querySelector('.drawer-actions')===actions&&!drawer.querySelector('#v4RegistrationHistory');
    const append=(html,status)=>{
      if(!current())return;
      const section=document.createElement('section');section.id='v4RegistrationHistory';section.className='customer-360-section';
      section.dataset.customerId=customerId;section.dataset.state=status;section.innerHTML=html;actions.before(section);
    };
    try{
      const x=await state(true);if(!current())return;
      const matches=(Array.isArray(x?.customers)?x.customers:[]).filter(customer=>customer&&String(customer.id??'')===customerId);
      if(matches.length!==1||matches[0].deleted)return;
      const rows=(Array.isArray(x.registrations)?x.registrations:[]).filter(row=>row&&String(row.customerId??'')===customerId).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
      append(`<div class="customer-360-section-title"><strong>报名历史</strong><span>${rows.length} 条</span></div><div class="timeline">${rows.map(r=>`<div class="timeline-item"><i></i><div><strong>${esc(r.status)}</strong><span>${esc(String(r.date).replace('T',' ').slice(0,16))} · ${esc(r.source||'未记录来源')} · ${esc(r.owner||'未分配')}</span><p>${esc(r.note||'无备注')}</p></div></div>`).join('')||'<div class="muted-cell">暂无报名历史</div>'}</div>`,'loaded');
    }catch{
      append('<div class="customer-360-section-title"><strong>报名历史</strong><span>读取失败</span></div><p role="alert">报名历史读取失败；未将未知数据视为空记录。</p><button type="button" class="btn" data-v4-retry-registration-history>重新读取</button>','error');
    }finally{if(registrationHistoryPending===pending)registrationHistoryPending=null;}
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-v4-retry-registration-history]');if(!button)return;
    const drawer=document.querySelector('#customerDrawer.open'),section=drawer?.querySelector('#v4RegistrationHistory');
    if(!drawer||button.closest('#customerDrawer')!==drawer||section?.dataset.state!=='error'||section.dataset.customerId!==String(drawer.dataset.customerId??''))return;
    section.remove();void registrationHistory();
  });
  function followTools(){if(!modal.querySelector('#followNote')||modal.querySelector('#v4FollowTools'))return;state(true).then(x=>{if(!modal.querySelector('#followNote')||modal.querySelector('#v4FollowTools'))return;const templates=x.settings?.followTemplates||defaults,d=document.createElement('div');d.id='v4FollowTools';d.className='v4-follow-tools';d.innerHTML=`<strong>结果模板</strong><div>${templates.map(t=>`<button type="button" class="btn small" data-v4-use-template="${esc(t)}">${esc(t.slice(0,10))}</button>`).join('')}</div><strong>快捷排期</strong><div>${[['今天',0],['明天',1],['3天后',3],['7天后',7]].map(([l,n])=>`<button type="button" class="btn small" data-v4-schedule="${n}">${l}</button>`).join('')}</div>`;modal.querySelector('.modal-body')?.appendChild(d);});}
  document.addEventListener('click',async e=>{const t=e.target.closest('[data-v4-use-template]');if(t){const note=document.querySelector('#followNote');if(note)note.value=t.dataset.v4UseTemplate;return;}const q=e.target.closest('[data-v4-schedule]');if(q){const d=new Date();d.setDate(d.getDate()+Number(q.dataset.v4Schedule));const input=document.querySelector('#nextFollow');if(input)input.value=new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,10);return;}const edit=e.target.closest('[data-v4-edit-template]'),add=e.target.closest('[data-v4-add-template]');if(edit||add){const x=await state(true),templates=[...(x.settings?.followTemplates||defaults)],i=edit?Number(edit.dataset.v4EditTemplate):-1,value=await window.__zhikeRegistryHost?.requestText?.(i>=0?'修改跟进模板':'新增跟进模板','模板最多 200 个字符。',i>=0?templates[i]:'',{label:'跟进模板',maxLength:200,multiline:true});if(value===null||!value?.trim())return;if(i>=0)templates[i]=value.trim().slice(0,200);else templates.push(value.trim().slice(0,200));x.settings={...(x.settings||{}),followTemplates:templates.slice(0,20)};await save(x);document.querySelector('#v4Templates')?.remove();automation();}});
  let queued=false,refreshTimer=null;const refresh=()=>{if(queued)return;clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{queued=true;queueMicrotask(()=>{queued=false;cache=null;dataCenter();archiveSummary().catch(()=>{});automation().catch(()=>{});analytics().catch(()=>{});batchLog().catch(()=>{});registrationHistory().catch(()=>{});followTools();});},80);};
  document.addEventListener('zhike:customer-drawer-opened',refresh);
  async function archiveDrilldown(){
    const bridge=view.querySelector('#v4ArchiveBridge');
    if(!bridge||bridge.querySelector('.v4-archive-drilldown'))return;
    const section=document.createElement('section');
    section.className='v4-archive-drilldown';
    section.innerHTML='<div class="v4-archive-drilldown-head"><div><strong>客户档案快速钻取</strong><span>只读取客户主档与 WS 关联摘要，不加载完整聊天</span></div><label class="v4-archive-search"><span>筛选客户</span><input data-v4-archive-search type="search" placeholder="姓名、号码或客户编号" autocomplete="off"></label></div><div class="v4-archive-customer-list" data-v4-archive-customers><div class="muted-cell">正在读取客户主档…</div></div><div class="v4-archive-drilldown-footer"><span data-v4-archive-customer-count>—</span><span>点击客户打开客户中心档案</span></div>';
    bridge.appendChild(section);
    const list=section.querySelector('[data-v4-archive-customers]'),search=section.querySelector('[data-v4-archive-search]'),count=section.querySelector('[data-v4-archive-customer-count]');
    let customers=[];
    const render=()=>{
      const query=String(search?.value||'').trim().toLocaleLowerCase();
      const rows=customers.filter(customer=>{
        if(!query)return true;
        return [customer.name,customer.phone,customer.rawPhone,customer.id,customer.source,customer.channel].some(value=>String(value||'').toLocaleLowerCase().includes(query));
      }).slice(0,20);
      count.textContent=query?`匹配 ${rows.length} / ${customers.length} 位客户`:`共 ${customers.length} 位有效客户 · 展示前 ${rows.length} 位`;
      list.innerHTML=rows.map(customer=>`<button type="button" class="v4-archive-customer-row" data-customer="${esc(customer.id)}" data-v4-archive-customer-id="${esc(customer.id)}"><span class="v4-archive-customer-main"><strong>${esc(customer.name||'未命名客户')}</strong><small>${esc(customer.rawPhone||customer.phone||'未登记号码')}</small></span><span class="v4-archive-customer-meta"><em>${esc(customer.source||customer.channel||'未标记渠道')}</em><small>${esc(customer.phase||customer.status||'待跟进')}</small></span></button>`).join('')||'<div class="muted-cell">当前筛选没有匹配的客户主档</div>';
    };
    const load=async()=>{
      try{
        const payload=await state(true);
        customers=(Array.isArray(payload.customers)?payload.customers:[]).filter(customer=>customer&&!customer.deleted&&String(customer.id||'').trim()).slice().sort((a,b)=>String(b.registered||b.updatedAt||'').localeCompare(String(a.registered||a.updatedAt||'')));
        render();
      }catch(error){
        customers=[];
        count.textContent='客户主档读取失败';
        list.innerHTML=`<div class="muted-cell">${esc(error.message||'暂时无法读取客户主档')}</div>`;
      }
    };
    search?.addEventListener('input',render);
    bridge.addEventListener('click',event=>{if(event.target.closest('[data-v4-refresh-archive]'))void load();});
    await load();
  }

  // A separate observer lets the summary panel mount first without coupling
  // its API request to the lightweight customer list.  It also remounts the
  // drilldown after the data page is refreshed by the host application.
  const archiveDrilldownObserver=new MutationObserver(()=>{void archiveDrilldown().catch(()=>{});});
  archiveDrilldownObserver.observe(view,{childList:true});

  // Page replacements, drawer content and modal content are the only surfaces
  // this enhancer owns. Watching document.body/subtree caused every WS message
  // mutation to rescan unrelated business pages and made background collection
  // compete with scrolling.
  new MutationObserver(refresh).observe(view,{childList:true});
  const drawer=document.querySelector('#customerDrawer');if(drawer)new MutationObserver(refresh).observe(drawer,{childList:true});
  const modalBody=modal.querySelector('.modal-body');if(modalBody)new MutationObserver(refresh).observe(modalBody,{childList:true});
  refresh();
})();
