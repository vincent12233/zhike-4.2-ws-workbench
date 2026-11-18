(() => {
  const nav=document.querySelector('#gptAssistantNav'),view=document.querySelector('#viewContainer'),crumb=document.querySelector('#crumbCurrent');
  if(!nav||!view)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const friendlyError=e=>String(e?.message||e||'操作失败').replace(/^Error invoking remote method '[^']+': Error:\s*/i,'').replace(/^Error:\s*/i,'');
  const notify=(message,icon='x')=>{const host=window.__zhikeRegistryHost;if(host?.toast){host.toast(String(message),icon);return;}console.warn(String(message));};
  let messages=[],selectedCustomerId='',busy=false,pendingPlan=null,attachments=[],assistantMode='general',currentRequestId='',requestGeneration=0,renderGeneration=0;
  let privacyPreviewTimer=null,privacyPreviewFlight=null,privacyPreviewCache=null,privacyPreviewGeneration=0;
  let activeSettingsModal=null,settingsReturnFocus=null;
  let settingsGeneration=0,settingsProviderGeneration=0,settingsOperationGeneration=0,settingsProviderReady=false;
  let settingsMutationPending=false,settingsMutationProvider='';
  const settingsActions=new Set(['close','save-key','test','models','remove-key']);
  function isOwnedSettingsTarget(target){
    const modal=document.querySelector('#modal'),backdrop=document.querySelector('#modalBackdrop');
    return activeSettingsModal===modal&&!backdrop?.classList.contains('hidden')
      &&Boolean(modal?.querySelector('#gptSettingsStatus'))&&target?.closest('#modal')===modal;
  }
  function isOwnedSettingsAction(target,action){return settingsActions.has(action)&&isOwnedSettingsTarget(target);}
  function refreshAfterSettings(){if(isGptActive())return render();}
  function settingsContext(){return {modal:activeSettingsModal,generation:settingsGeneration,providerGeneration:settingsProviderGeneration,provider:document.querySelector('#gptProvider')?.value};}
  function settingsContextCurrent(context){return context.modal===activeSettingsModal&&context.generation===settingsGeneration&&context.providerGeneration===settingsProviderGeneration&&context.provider===document.querySelector('#gptProvider')?.value&&isOwnedSettingsTarget({closest:()=>context.modal});}
  function syncSettingsControls(){
    const modal=activeSettingsModal;if(!modal)return;
    const provider=modal.querySelector('#gptProvider');if(provider)provider.disabled=settingsMutationPending;
    for(const selector of ['#gptApiKey','#gptModel','#gptDefaultPhone']){const control=modal.querySelector(selector);if(control)control.disabled=settingsMutationPending||!settingsProviderReady;}
    for(const control of modal.querySelectorAll?.('[data-gpt-action]')||[])if(settingsActions.has(control.dataset?.gptAction)&&control.dataset.gptAction!=='close')control.disabled=settingsMutationPending||!settingsProviderReady;
  }
  async function settingsAction(action){
    if(action==='close'){close();return;}
    if(settingsMutationPending||!settingsProviderReady)return;
    const context=settingsContext();if(!settingsContextCurrent(context))return;
    const provider=context.provider,box=context.modal.querySelector('#gptSettingsStatus');
    if(action==='save-key'||action==='remove-key'){
      if(action==='remove-key'&&!confirm('删除当前服务商在本机保存的 API Key？另一个服务商的密钥不会受影响。'))return;
      const input=context.modal.querySelector('#gptApiKey'),apiKey=input?.value.trim(),model=context.modal.querySelector('#gptModel')?.value.trim()||'gpt-5.6-sol',defaultIncludePhone=Boolean(context.modal.querySelector('#gptDefaultPhone')?.checked);
      settingsMutationPending=true;settingsMutationProvider=provider;if(input)input.value='';syncSettingsControls();
      if(box)box.textContent='正在提交 API Key 设置；关闭窗口不会撤销已经提交的修改。';
      try{
        if(action==='save-key')await window.zhikeAI.saveKey({provider,apiKey,model,defaultIncludePhone});
        else await window.zhikeAI.removeKey({provider});
        if(settingsContextCurrent(context)){close();refreshAfterSettings();}
      }catch(error){if(settingsContextCurrent(context)){if(box)box.textContent=friendlyError(error);notify(friendlyError(error));}}
      finally{settingsMutationPending=false;settingsMutationProvider='';if(settingsContextCurrent(context))syncSettingsControls();}
      return;
    }
    if(action==='test'||action==='models'){
      const operation=++settingsOperationGeneration,request={provider,apiKey:context.modal.querySelector('#gptApiKey')?.value.trim(),model:context.modal.querySelector('#gptModel')?.value.trim()};
      if(box)box.textContent=action==='test'?'正在测试连接…':'正在获取模型…';
      try{
        const result=action==='test'?await window.zhikeAI.testConnection(request):await window.zhikeAI.listModels(request);
        if(!settingsContextCurrent(context)||operation!==settingsOperationGeneration)return;
        if(action==='test')box.textContent=result.modelFallback?`连接成功：${result.providerName} · ${result.model}（原模型 ${result.requestedModel} 暂不可用，已自动切换）`:`连接成功：${result.providerName} · ${result.model}`;
        else{context.modal.querySelector('#gptModelList').innerHTML=result.models.map(id=>`<option value="${esc(id)}">`).join('');box.textContent=`已获取 ${result.models.length} 个兼容模型；也可以手动输入模型名称。`;}
      }catch(error){if(settingsContextCurrent(context)&&operation===settingsOperationGeneration&&box)box.textContent=friendlyError(error);}
    }
  }
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&activeSettingsModal===document.querySelector('#modal')&&activeSettingsModal?.querySelector('#gptSettingsStatus'))close();
  });

  try{const saved=JSON.parse(localStorage.getItem('zhike-gpt-last-session')||'{}');if(Array.isArray(saved.messages))messages=saved.messages.slice(-20);if(['general','code','operations','manage'].includes(saved.mode))assistantMode=saved.mode;}catch{}
  async function loadState(){const r=await fetch('/api/state',{cache:'no-store'});if(!r.ok)throw new Error('无法读取本机客户数据');return r.json();}
  async function importExcelLocally(file){
    if(!file)return;
    let parsed;
    try{parsed=await window.zhikeAI.parseExcel({bytes:await file.arrayBuffer()});}
    catch(error){notify(friendlyError(error));return;}
    try{
    const state=await loadState(),smart=window.ZhikeSmartImport;
    const normalizePhone=value=>String(value??'').replace(/\D/g,'').replace(/^91(?=\d{10}$)/,'');
    const normalizeDate=value=>smart?.date?.(value)||'';
    const existing=new Set((state.customers||[]).map(c=>normalizePhone(c.phone||c.rawPhone)).filter(phone=>phone.length===10)),seen=new Set(),valid=[],issues=[];
    const aliases={phone:['客户号码','手机号码','手机号','电话','号码','手机','phone','mobile'],name:['客户姓名','姓名','名字','name'],source:['渠道','来源','客户来源','source'],page:['页面','来源页面','page'],assistant:['助理','负责人','归属人','assistant'],status:['客户状态','状态','status'],phase:['客户阶段','阶段','phase'],qualification:['评级','资质评级','客户评级','qualification'],tags:['标签','客户标签','tags'],note:['备注','说明','note'],registration:['报名状态','是否报名','registration'],registered:['登记日期','登记时间','注册日期','入群日期','创建时间','日期','date','registered'],due:['下次跟进','下次跟进日期','计划跟进','跟进日期','due','next_followup']};
    const keyOf=value=>String(value||'').trim().toLowerCase().replace(/[\s_\-\\/（）()]/g,'');
    const findIndex=(headers,names,used=new Set())=>{const normalized=headers.map(keyOf),wanted=names.map(keyOf);let index=normalized.findIndex((header,i)=>!used.has(i)&&wanted.includes(header));if(index>=0)return index;return normalized.findIndex((header,i)=>!used.has(i)&&wanted.some(name=>name.length>=2&&header.includes(name)));};
    const today=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
    for(const table of parsed.tables||[]){
      const rawRows=table.rows||[],detected=smart?.detectHeaderRow?.(rawRows),headerIndex=Number.isInteger(detected?.index)?detected.index:0,rows=rawRows.slice(headerIndex);
      if(rows.length<2)continue;
      const headers=rows[0].map(value=>String(value??'')),used=new Set(),map={};
      for(const [field,names] of Object.entries(aliases)){const index=findIndex(headers,names,used);if(index>=0){map[field]=index;used.add(index);}}
      if(map.phone==null){issues.push(`${table.name}：未找到客户号码列`);continue;}
      for(let i=1;i<rows.length;i++){
        const row=rows[i],get=key=>map[key]==null?'':String(row[map[key]]??'').trim(),raw=get('phone'),phone=normalizePhone(raw);
        if(!phone){if(row.some(Boolean))issues.push(`${table.name} 第 ${i+1+headerIndex} 行：号码为空`);continue;}
        if(phone.length!==10){issues.push(`${table.name} 第 ${i+1+headerIndex} 行：号码格式异常`);continue;}
        if(existing.has(phone)||seen.has(phone)){issues.push(`${table.name} 第 ${i+1+headerIndex} 行：号码重复，已跳过`);continue;}
        const rawRegistered=get('registered'),registered=normalizeDate(rawRegistered),rawDue=get('due'),due=normalizeDate(rawDue);
        if(rawRegistered&&!registered){issues.push(`${table.name} 第 ${i+1+headerIndex} 行：登记日期无法识别`);continue;}
        if(rawDue&&!due){issues.push(`${table.name} 第 ${i+1+headerIndex} 行：下次跟进日期无法识别`);continue;}
        seen.add(phone);
        valid.push({id:`CXL-${Date.now()}-${valid.length}`,name:get('name')||'未命名客户',rawPhone:raw,phone,source:get('source')||'Excel导入',page:get('page'),assistant:get('assistant')||'未分配',status:get('status')||'未进群',phase:get('phase')||'新客户',qualification:get('qualification')||'待评估',tags:get('tags').split(/[,，、]/).map(x=>x.trim()).filter(Boolean),note:get('note'),registration:get('registration')==='已报名'?'已报名':'',registered:registered||today,lastFollow:'',due:due||'—',deleted:false,touched:false,importSource:`Excel:${file.name}:${table.name}`});
      }
    }
    if(!valid.length){notify(`没有可导入的有效客户。\n${issues.slice(0,8).join('\n')}`);return;}
    if(!confirm(`本机 Excel 导入预览\n\n有效新客户：${valid.length} 位\n异常或重复：${issues.length} 行\n工作表：${(parsed.tables||[]).length} 个\n\n本次不会调用任何 GPT API。确认后先创建快照，再写入本机数据库。`))return;
    const snapshot=await fetch('/api/snapshot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'本机 Excel 导入前自动快照'})});
    if(!snapshot.ok){notify('创建导入前快照失败，未写入数据。');return;}
    const version=String(state.version||''),now=new Date().toISOString();
    state.customers=[...(state.customers||[]),...valid];
    state.registrations=[...(state.registrations||[]),...valid.filter(c=>c.registration==='已报名').map(c=>({id:`RXL-${Date.now()}-${c.id}`,customerId:c.id,date:now,source:'本机Excel导入',owner:c.assistant,status:'已报名',note:`来自 ${file.name}`,createdAt:now}))];
    state.activities=[{id:`AXL-${Date.now()}`,text:`本机 Excel 导入 ${valid.length} 位客户，跳过 ${issues.length} 行`,time:new Date().toLocaleString('zh-CN'),createdAt:now,color:'green'},...(state.activities||[])];
    delete state.version;delete state.initialized;
    const response=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json','X-State-Version':version},body:JSON.stringify(state)});
    if(!response.ok){const failure=await response.json().catch(()=>({}));notify(failure.error||'导入失败，未覆盖其他窗口的新数据。');return;}
    notify(`本机导入完成：${valid.length} 位客户。\n登记日期和下次跟进日期已按表格字段分别保存。`,'check');
    window.location.reload();
    }catch(error){notify(friendlyError(error));}
  }
  function activeNav(){document.querySelectorAll('.nav-item').forEach(item=>item.classList.toggle('active',item===nav));if(crumb)crumb.textContent='GPT 运营助手';document.documentElement.dataset.view='gpt';}
  function normalizeCustomer(c,includePhone){return {id:c.id,name:c.name,phone:includePhone?(c.rawPhone||c.phone):undefined,source:c.source,page:c.page,assistant:c.assistant,status:c.status,phase:c.phase,qualification:c.qualification,hot:Boolean(c.hot),registered:c.registered,lastFollow:c.lastFollow,due:c.due,note:String(c.note||'').slice(0,500),tags:c.tags||[]};}
  function contextFor(state,scope,includePhone){const all=state.customers||[],customers=all.filter(c=>!c.deleted),today=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10),summary={generatedAt:new Date().toISOString(),scope,totalCustomers:customers.length,recycledCustomers:all.length-customers.length,counts:{registrations:(state.registrations||[]).filter(r=>r.status==='已报名').length,tickets:(state.tickets||[]).length,deposits:(state.deposits||[]).length,followups:(state.followups||[]).length}};let list=[];if(scope==='all')list=customers.slice(0,200);if(scope==='selected')list=all.filter(c=>String(c.id)===String(selectedCustomerId));if(scope==='priority')list=customers.filter(c=>c.favorite||c.hot||/^[SA]级/.test(c.qualification||'')).slice(0,100);if(scope==='overdue')list=customers.filter(c=>c.due&&c.due!=='—'&&c.due<today).slice(0,100);if(scope==='registered'){const ids=new Set((state.registrations||[]).filter(r=>r.status==='已报名').map(r=>String(r.customerId)));list=customers.filter(c=>ids.has(String(c.id))).slice(0,100);}if(scope==='recycle')list=all.filter(c=>c.deleted).slice(0,50);return {...summary,customers:list.map(c=>normalizeCustomer(c,includePhone)),scopeTruncated:scope==='all'&&customers.length>200,related:scope==='selected'?{registrations:(state.registrations||[]).filter(r=>String(r.customerId)===String(selectedCustomerId)).slice(0,30),followups:(state.followups||[]).filter(r=>String(r.customerId)===String(selectedCustomerId)).slice(0,30),tickets:(state.tickets||[]).filter(r=>String(r.customerId)===String(selectedCustomerId)).slice(0,30),deposits:(state.deposits||[]).filter(r=>String(r.customerId)===String(selectedCustomerId)).slice(0,30)}:undefined};}
  function businessAnalytics(state,context){
    const ids=new Set((context.customers||[]).map(c=>String(c.id))),selected=ids.size?context.customers:[],today=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
    const regs=(state.registrations||[]).filter(r=>r.status==='已报名'&&(!ids.size||ids.has(String(r.customerId)))),tickets=(state.tickets||[]).filter(r=>!ids.size||ids.has(String(r.customerId))),deposits=(state.deposits||[]).filter(r=>!ids.size||ids.has(String(r.customerId))),follows=(state.followups||[]).filter(r=>!ids.size||ids.has(String(r.customerId)));
    const unique=rows=>new Set(rows.map(row=>String(row.customerId)).filter(Boolean)).size,base=ids.size||Number(context.totalCustomers)||0,registrationCustomers=unique(regs),ticketCustomers=unique(tickets),depositCustomers=unique(deposits),amounts={};
    deposits.forEach(row=>{const currency=String(row.currency||'未标注');amounts[currency]=(amounts[currency]||0)+(Number(row.amount)||0);});
    const grades=Object.fromEntries(['S','A','B','C','D','E'].map(g=>[g,selected.filter(c=>String(c.qualification||'').startsWith(g)).length]));
    return {scopeCustomerCount:base,funnel:{customers:base,registered:registrationCustomers,ticketed:ticketCustomers,deposited:depositCustomers,customerToRegistrationRate:base?Math.round(registrationCustomers/base*1000)/10:0,registrationToTicketRate:registrationCustomers?Math.round(ticketCustomers/registrationCustomers*1000)/10:0,ticketToDepositRate:ticketCustomers?Math.round(depositCustomers/ticketCustomers*1000)/10:0},depositTotalsByCurrency:amounts,grades,overdueCustomers:selected.filter(c=>c.due&&c.due!=='—'&&c.due<today).length,highValueCustomers:selected.filter(c=>/^[SA]级/.test(c.qualification||'')).length,missingOwner:selected.filter(c=>!c.assistant||c.assistant==='未分配').length,records:{registrations:regs.length,tickets:tickets.length,deposits:deposits.length,followups:follows.length}};
  }
   async function readAiStatus(bridge){
     const fallback={configured:false,provider:'teamorouter',providerName:'TeamoRouter',model:'gpt-5-mini',error:'AI 服务状态读取超时，请重试或检查桌面安全桥接。'};
     if(!bridge?.status)return fallback;
     let timer;
     try{return await Promise.race([bridge.status().catch(error=>({...fallback,error:error?.message||fallback.error})),new Promise(resolve=>{timer=setTimeout(()=>resolve(fallback),2500);})]);}
     finally{if(timer)clearTimeout(timer);}
   }
   async function render(){
     const generation=++renderGeneration;
     activeNav();
     const bridge=window.zhikeAI;
     if(!bridge){view.innerHTML='<div class="gpt-page"><section class="gpt-error-state"><span>!</span><h2>GPT 安全桥接未启动</h2><p>请通过当前知客桌面应用重新打开本页；客户数据和历史对话没有被修改。</p><button class="btn" data-gpt-action="retry-render">重新检测</button></section></div>';return;}
     const status=await readAiStatus(bridge);
     const host=window.__zhikeRegistryHost;
     if(generation!==renderGeneration||(host?.state&&host.state.view!=='gpt'))return;
     view.innerHTML=`<div class="gpt-page"><div class="page-heading gpt-page-heading"><div><h1 class="page-title">GPT 运营助手</h1><p class="page-subtitle">智能分析、客户运营建议与受控数据管理 · 所有写入均需预览确认</p></div><div class="heading-actions"><span class="gpt-heading-status" data-ready="${status.configured?'true':'false'}"><i></i>${status.configured?'AI 服务就绪':'等待配置'}</span><button class="btn" data-gpt-action="settings">${status.configured?'GPT 设置':'设置 API Key'}</button></div></div>${!status.configured?setupCard(status):chatLayout(status)}</div>`;
     if(status.configured){const section=document.querySelector('.gpt-context-section');section?.insertAdjacentHTML('afterbegin',`<label><span>助手模式</span><select id="gptAssistantMode"><option value="general" ${assistantMode==='general'?'selected':''}>通用助手</option><option value="code" ${assistantMode==='code'?'selected':''}>Codex 代码助手</option><option value="operations" ${assistantMode==='operations'?'selected':''}>客户运营分析</option><option value="manage" ${assistantMode==='manage'?'selected':''}>智能自动化管理</option></select></label><button class="gpt-local-import" data-gpt-action="local-excel">本机导入 Excel</button><input id="gptLocalExcel" type="file" hidden accept=".xlsx,.xls,.xlsm"><button class="gpt-workspace-btn" data-gpt-action="workspace">选择代码文件夹</button>`);renderMessages();renderAttachments();}
   }
  function modeLabel(){return ({general:'通用助手',code:'代码助手',operations:'运营分析',manage:'自动化管理'})[assistantMode]||'通用助手';}
  function setupCard(status){return `<section class="panel gpt-setup"><div class="gpt-setup-orbit"><div class="gpt-logo">AI</div><i></i></div><div class="gpt-setup-copy"><span class="gpt-eyebrow">SECURE LOCAL AI GATEWAY</span><h2>连接你的 AI 服务</h2><p>支持 OpenAI 官方 API 与 TeamoRouter。密钥分别使用 Windows 安全存储加密，不进入 SQLite、备份或日志；连接测试不会发送客户资料。</p><div class="gpt-setup-points"><span><b>01</b>选择服务商</span><span><b>02</b>保存本机密钥</span><span><b>03</b>测试后开始分析</span></div>${status.error?`<div class="gpt-setup-error"><strong>当前状态</strong><span>${esc(status.error)}</span></div>`:''}<button class="btn primary" data-gpt-action="settings">配置并测试服务</button></div></section>`;}
  function historyPanel(){const rows=messages.filter(item=>item.role==='user'&&String(item.text||'').trim()).slice(-5).reverse();return `<div class="gpt-history"><div class="gpt-history-head"><small>当前会话历史</small><span>${rows.length} 条提问</span></div>${rows.length?rows.map((item,index)=>`<button type="button" data-gpt-prompt="${esc(item.text)}"><b>${String(rows.length-index).padStart(2,'0')}</b><span>${esc(String(item.text).replace(/\s+/g,' ').slice(0,46))}</span></button>`).join(''):'<p>发送第一条消息后，最近提问会显示在这里。</p>'}</div>`;}
  function statusStrip(status){return `<div class="gpt-status-strip" aria-label="GPT 工作区状态"><span class="is-online"><i></i><small>服务</small><b>${esc(status.providerName||'AI')}</b></span><span><small>模式</small><b data-gpt-metric="mode">${esc(modeLabel())}</b></span><span><small>对话</small><b data-gpt-metric="messages">${messages.length}</b></span><span><small>附件</small><b data-gpt-metric="attachments">${attachments.length}</b></span><span><small>待确认写入</small><b data-gpt-metric="actions">${pendingPlan?.actions?.length||0}</b></span></div>`;}
  function chatLayout(status){return `<div class="gpt-layout gpt-modern"><aside class="panel gpt-context"><div class="gpt-context-brand"><div class="gpt-mini-logo">AI</div><div><strong>知客 GPT</strong><span>运营智能工作区</span></div></div><button class="gpt-new-chat" data-gpt-action="clear-chat"><b>＋</b> 新对话</button><div class="gpt-context-section"><small>数据上下文</small><label><span>客户范围</span><select id="gptScope"><option value="overview">仅汇总数字</option><option value="all">全部客户（最多 200 位）</option><option value="priority">重点 / 热聊 / S-A 客户</option><option value="overdue">逾期客户</option><option value="registered">已报名客户</option>${selectedCustomerId?'<option value="selected" selected>当前客户档案</option>':''}</select></label><label class="gpt-check"><input type="checkbox" id="gptIncludePhone" ${status.defaultIncludePhone?'checked':''}>包含客户号码</label><label class="gpt-check gpt-manage-toggle"><input type="checkbox" id="gptManageMode">管理模式</label></div><div id="gptPrivacyPreview" class="gpt-privacy" role="status" aria-live="polite"></div><div class="gpt-context-section gpt-capabilities"><small>可调用查看</small><span>客户资料与优先级</span><span>报名 / 跟进 / 跟票 / 入金</span><span>Excel / 文件内容</span><span>统计汇总与运营建议</span></div>${historyPanel()}<div class="gpt-provider-card"><i></i><div><strong>${esc(status.providerName)}</strong><span>${esc(status.model)}</span></div><button data-gpt-action="settings">设置</button></div>${status.provider==='teamorouter'?'<div class="notice-line gpt-gateway">第三方 API 网关</div>':''}</aside><section class="panel gpt-chat"><div class="gpt-chat-head"><div><strong>知客 GPT <em>6.0</em></strong><span>分析、建议、文件理解与受控写入</span></div><div class="gpt-head-actions"><span class="gpt-live-dot"></span><span>已连接</span><button class="gpt-icon-btn" data-gpt-action="clear-chat" title="清空对话">↻</button></div></div>${statusStrip(status)}<div class="gpt-messages" id="gptMessages" role="log" aria-live="polite" aria-relevant="additions text"></div><div class="gpt-composer-shell"><div class="gpt-dropzone" id="gptDropzone" tabindex="0" role="button" aria-label="拖入文件或按 Enter 选择文件"><input id="gptFiles" type="file" multiple hidden accept=".xlsx,.xls,.xlsm,.txt,.md,.csv,.json,.log,.xml,.html,.htm,text/*"><strong>把文件拖到这里</strong><span>支持 Excel、CSV、JSON 和文本文件</span></div><div class="gpt-attachments" id="gptAttachments"></div><div class="gpt-composer"><textarea id="gptInput" maxlength="12000" placeholder="询问客户数据、运营情况，或分析拖入的文件…"></textarea><div class="gpt-composer-tools"><div><label class="gpt-attach-btn" for="gptFiles" title="添加文件">＋</label><span>可拖入 Excel 和文本资料</span></div><button class="gpt-send-round" data-gpt-action="send" title="发送">↑</button></div></div><p class="gpt-disclaimer">AI 结果用于辅助判断，请核对重要业务信息；管理操作始终需要预览和人工确认。</p></div></section></div>`;}
  function isGptActive(){const host=window.__zhikeRegistryHost;return document.documentElement.dataset.view==='gpt'||host?.state?.view==='gpt';}
  function invalidatePrivacyPreview(){privacyPreviewGeneration++;privacyPreviewCache=null;privacyPreviewFlight=null;clearTimeout(privacyPreviewTimer);privacyPreviewTimer=null;}
  function privacyPreviewKey(){const included=Boolean(document.querySelector('#gptIncludePhone')?.checked),scope=document.querySelector('#gptScope')?.value||'overview',files=attachments.map(item=>`${item.name}:${item.size}`).join('|');return `${scope}|${included?'phone':'no-phone'}|${files}`;}
  function privacyPreview({immediate=false}={}){
    clearTimeout(privacyPreviewTimer);
    if(!immediate){privacyPreviewTimer=setTimeout(()=>{privacyPreviewTimer=null;privacyPreview({immediate:true});},120);return privacyPreviewFlight||Promise.resolve({scheduled:true});}
    const target=document.querySelector('#gptPrivacyPreview');if(!target||!isGptActive())return Promise.resolve({skipped:true});
    const key=privacyPreviewKey(),now=Date.now();
    if(privacyPreviewCache?.key===key&&now-privacyPreviewCache.at<1500){const cached=privacyPreviewCache;target.innerHTML=cached.html;const send=document.querySelector('[data-gpt-action="send"]');if(send&&!busy)send.textContent=cached.sendLabel;return Promise.resolve(cached);}
    if(privacyPreviewFlight?.key===key)return privacyPreviewFlight.promise;
    const generation=privacyPreviewGeneration;
    const promise=Promise.all([loadState(),window.zhikeAI.status()]).then(([state,status])=>{
      if(generation!==privacyPreviewGeneration||!isGptActive())return {stale:true};
      const included=Boolean(document.querySelector('#gptIncludePhone')?.checked),data=contextFor(state,document.querySelector('#gptScope')?.value||'overview',included),sendLabel=`发送 · ${included?'含号码':'不含号码'}`,html=`<strong>本次将发送</strong><span>${data.customers.length} 位客户 · ${attachments.length} 个附件 · ${data.related?'含关联业务记录':'不含客户明细'} · ${included?'包含号码':'不包含号码'} · ${esc(status.providerName)} / ${esc(status.model)}</span>`;
      privacyPreviewCache={key,at:Date.now(),html,sendLabel};target.innerHTML=html;const send=document.querySelector('[data-gpt-action="send"]');if(send&&!busy)send.textContent=sendLabel;return privacyPreviewCache;
    }).catch(error=>{if(generation!==privacyPreviewGeneration||!isGptActive())return {stale:true};target.textContent=friendlyError(error);return {error:true};}).finally(()=>{if(privacyPreviewFlight?.promise===promise)privacyPreviewFlight=null;});
    privacyPreviewFlight={key,promise};return promise;
  }
  function actionLabel(action){if(action.type==='update_workspace_config')return `修改工作台${action.customer_id?` [${action.customer_id}]`:''}：${action.field} → ${String(action.value)}`;if(action.type==='update_customer')return `修改客户 ${action.customer_id}：${action.field} → ${String(action.value)}`;if(action.type==='add_followup')return `新增跟进 ${action.customer_id}：${action.date||'当前时间'} · ${action.note||''}`;if(action.type==='add_registration')return `新增报名 ${action.customer_id}：${action.date||'当前时间'} · ${action.note||''}`;if(action.type==='add_ticket')return `新增跟票 ${action.customer_id}：${String(action.value||'未指定')}`;if(action.type==='add_deposit')return `新增入金 ${action.customer_id}：${Number(action.value)||0}`;if(action.type==='archive_customer')return `移入回收站：${action.customer_id}`;if(action.type==='restore_customer')return `从回收站恢复：${action.customer_id}`;return '未知操作';}
  function updateWorkspaceMetrics(){const values={mode:modeLabel(),messages:messages.length,attachments:attachments.length,actions:pendingPlan?.actions?.length||0};for(const [key,value] of Object.entries(values)){const target=document.querySelector(`[data-gpt-metric="${key}"]`);if(target)target.textContent=String(value);}const history=document.querySelector('.gpt-history');if(history)history.outerHTML=historyPanel();}
  function renderMessages(){
    const box=document.querySelector('#gptMessages');if(!box)return;
    if(messages.length){
      box.innerHTML=`<div class="gpt-message-column">${messages.map(m=>`<article class="gpt-message ${m.role} ${m.role==='assistant'&&/^(请求失败|写入失败)/.test(String(m.text||''))?'is-error':''}"><div class="gpt-avatar">${m.role==='user'?'你':'AI'}</div><div class="gpt-message-body"><strong>${m.role==='user'?'你':'知客 GPT'}</strong><div>${esc(m.text).replace(/\n/g,'<br>')}</div>${m.actions?.length?`<div class="gpt-plan"><b>待确认操作 · ${m.actions.length} 项</b>${m.actions.map((a,i)=>`<span>${i+1}. ${esc(actionLabel(a))}</span>`).join('')}<button class="btn primary" data-gpt-action="apply-plan">确认写入本机数据</button><small>确认后先创建快照，再以版本校验方式写入 SQLite。</small></div>`:''}</div></article>`).join('')}</div>`;
    }else{
      const starters=[['生成今日运营简报','汇总重点客户和下一步行动'],['分析 Excel 文件','识别趋势、异常和机会'],['检查转化漏斗','定位报名、跟票与入金瓶颈'],['制定跟进计划','为高价值客户生成行动建议']];
      box.innerHTML=`<div class="gpt-welcome"><div class="gpt-hero-logo">知</div><h2>有什么可以帮忙的？</h2><p>我可以结合客户数据和你拖入的文件，完成运营分析、总结与受控修改。</p><div class="gpt-starter-grid">${starters.map(([title,desc])=>`<button data-gpt-prompt="${esc(title)}"><strong>${esc(title)}</strong><span>${esc(desc)}</span></button>`).join('')}</div></div>`;
    }
    box.scrollTop=box.scrollHeight;updateWorkspaceMetrics();privacyPreview();try{localStorage.setItem('zhike-gpt-last-session',JSON.stringify({mode:assistantMode,messages:messages.slice(-20).map(({role,text})=>({role,text}))}));}catch{}
  }
  function renderAttachments(){const box=document.querySelector('#gptAttachments');if(!box)return;box.innerHTML=attachments.map((item,index)=>`<span class="gpt-file-chip"><b>${esc(item.name)}</b><small>${(item.size/1024).toFixed(1)} KB</small><button type="button" data-gpt-remove-file="${index}" aria-label="移除 ${esc(item.name)}">×</button></span>`).join('');updateWorkspaceMetrics();}
  async function addFiles(files){const allowed=/\.(txt|md|csv|json|log|xml|html?|yaml|yml)$/i,excel=/\.(xlsx|xlsm|xls)$/i;for(const file of [...files]){if(attachments.length>=10){notify('最多添加 10 个附件。');break;}if(excel.test(file.name)){if(file.size>10*1024*1024){notify(`${file.name} 超过 Excel 文件 10 MB 限制。`);continue;}try{const parsed=await window.zhikeAI.parseExcel({bytes:await file.arrayBuffer()}),sheetLabel=parsed.sheets.map(sheet=>`${sheet.name} ${sheet.rows}行`).join('、');attachments.push({name:file.name,type:'application/vnd.ms-excel',size:new Blob([parsed.text]).size,text:`Excel 工作簿：${file.name}\n工作表摘要：${sheetLabel}${parsed.truncated?'\n注意：内容过大，已安全截断。':''}\n\n${parsed.text}`});}catch(error){notify(friendlyError(error));}continue;}if(file.size>2*1024*1024){notify(`${file.name} 超过单个文本文件 2 MB 限制。`);continue;}if(!allowed.test(file.name)&&!String(file.type).startsWith('text/')){notify(`${file.name} 暂不支持。请使用 Excel、TXT、Markdown、CSV、JSON、日志、XML 或 HTML。`);continue;}if(attachments.reduce((sum,item)=>sum+item.size,0)+file.size>6*1024*1024){notify('附件解析文本总量不能超过 6 MB。');break;}try{attachments.push({name:file.name,type:file.type||'text/plain',size:file.size,text:await file.text()});}catch{notify(`无法读取文件：${file.name}`);}}renderAttachments();privacyPreview();}
  async function cancelActiveRequest(){
    const requestId=currentRequestId;
    requestGeneration++;
    currentRequestId='';
    busy=false;
    const button=document.querySelector('[data-gpt-action="cancel"]');
    if(button){button.dataset.gptAction='send';button.textContent='↑';button.title='发送';}
    if(requestId)await window.zhikeAI.cancel({requestId}).catch(()=>{});
    return Boolean(requestId);
  }
  async function send(inputOverride){
    if(busy)return;const input=String(inputOverride??document.querySelector('#gptInput')?.value??'').trim();if(!input)return;
    busy=true;const generation=++requestGeneration;currentRequestId=`REQ-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;const requestId=currentRequestId;messages.push({role:'user',text:input});renderMessages();const button=document.querySelector('[data-gpt-action="send"]');if(button){button.dataset.gptAction='cancel';button.textContent='■';button.title='停止生成';}
    try{
      const state=await loadState(),scope=document.querySelector('#gptScope')?.value||'overview',includePhone=Boolean(document.querySelector('#gptIncludePhone')?.checked),context=contextFor(state,scope,includePhone),selectedMode=document.querySelector('#gptAssistantMode')?.value||assistantMode,mode=(selectedMode==='manage'||document.querySelector('#gptManageMode')?.checked)?'manage':'analyze',analysisDepth='deep';assistantMode=selectedMode;
      context.analytics=businessAnalytics(state,context);
      context.workspaceConfig=state.settings?.runtimeCustomization||{};
      context.menuRegistry=[...document.querySelectorAll('#mainNav [data-view]')].map(item=>({key:item.dataset.view,label:item.querySelector('span')?.textContent||item.dataset.view})).concat([{key:'gpt',label:'GPT 运营助手'}]);
      const history=messages.slice(0,-1).filter(item=>!item.actions).slice(-12).map(item=>({role:item.role,text:item.text})),files=attachments.map(({name,type,text})=>({name,type,text}));
      const result=await window.zhikeAI.request({input,context,mode,assistantMode:selectedMode,history,attachments:files,analysisDepth,requestId});
      if(generation!==requestGeneration||requestId!==currentRequestId||!isGptActive())return;
      if(result.actions?.length){const allowedIds=new Set((context.customers||[]).map(c=>String(c.id))),menuKeys=new Set(context.menuRegistry.map(item=>item.key)),actions=result.actions.filter(a=>a.type==='update_workspace_config'?(a.field!=='menu_label'&&a.field!=='menu_visible'||menuKeys.has(String(a.customer_id))):allowedIds.has(String(a.customer_id))).slice(0,100);pendingPlan={actions,allowedIds,menuKeys,summary:result.text};messages.push({role:'assistant',text:result.text,actions});}
      else messages.push({role:'assistant',text:result.text});
      attachments=[];
    }catch(e){if(generation===requestGeneration&&isGptActive())messages.push({role:'assistant',text:`请求失败：${e.message}`});}
    finally{if(generation===requestGeneration){busy=false;currentRequestId='';renderMessages();renderAttachments();const next=document.querySelector('[data-gpt-action="cancel"]');if(next){next.dataset.gptAction='send';next.textContent='↑';next.title='发送';}}}
  }
  async function applyPlan(){
    if(!pendingPlan?.actions?.length||busy)return;
    if(pendingPlan.actions.some(action=>action.type==='archive_customer')&&!confirm('计划包含客户归档操作。再次确认将这些客户移入回收站？数据仍可恢复。'))return;
    busy=true;
    try{
      const state=await loadState(),version=String(state.version||''),customers=new Map((state.customers||[]).map(c=>[String(c.id),c]));
      const allowedFields=new Set(['assistant','status','phase','qualification','due','tags','hot','registration','name','source','page','group','note']);
      const now=new Date().toISOString(),applied=[];
      const followupNote=action=>String(action?.note||action?.value||'GPT 跟进计划').trim();
      const sameFollowup=(item,customerId,date,note)=>String(item?.customerId||'')===String(customerId)&&String(item?.date||'')===String(date)&&String(item?.method||'')==='GPT计划'&&String(item?.note||item?.result||'').trim()===String(note).trim();
      const sameTicket=(left,right)=>{const key=window.ZhikeTicketRecords?.ticketRecordKey;if(typeof key==='function')return key(left)===key(right);return [left.customerId,left.date,left.product,left.direction,left.note].map(value=>String(value??'').trim().toLowerCase()).join('|')===[right.customerId,right.date,right.product,right.direction,right.note].map(value=>String(value??'').trim().toLowerCase()).join('|');};
      const sameDeposit=(left,right)=>String(left?.customerId||'')===String(right?.customerId||'')&&String(left?.date||'')===String(right?.date||'')&&Number(left?.amount||0)===Number(right?.amount||0)&&String(left?.currency||'')===String(right?.currency||'')&&String(left?.note||'').trim()===String(right?.note||'').trim();
      for(const action of pendingPlan.actions){
        if(action.type==='update_workspace_config'){
          const allowedConfig=new Set(['home_title','home_subtitle','workspace_name','workspace_subtitle','admin_name','theme','density','menu_label','menu_visible']);
          if(!allowedConfig.has(action.field))continue;
          state.settings=state.settings||{};const config=state.settings.runtimeCustomization||(state.settings.runtimeCustomization={});
          if(action.field==='theme')config.theme=['light','dark'].includes(String(action.value))?String(action.value):'light';
          else if(action.field==='density')config.density=['comfortable','compact'].includes(String(action.value))?String(action.value):'comfortable';
          else if(action.field==='menu_label'||action.field==='menu_visible'){if(!pendingPlan.menuKeys?.has(String(action.customer_id)))continue;config.menu=config.menu||{};const visible=typeof action.value==='boolean'?action.value:!['false','0','否','隐藏','不显示'].includes(String(action.value).trim().toLowerCase());config.menu[action.customer_id]={...(config.menu[action.customer_id]||{}),[action.field==='menu_label'?'label':'visible']:action.field==='menu_visible'?visible:String(action.value||'').slice(0,32)};}
          else config[action.field]=String(action.value||'').slice(0,80);
          applied.push(action);continue;
        }
        const c=customers.get(String(action.customer_id));
        if(!c||!pendingPlan.allowedIds.has(String(c.id)))continue;
        if(action.type==='update_customer'&&allowedFields.has(action.field)){
          if(action.field==='tags')c.tags=[...new Set([...(c.tags||[]),...String(action.value||'').split(/[,，、]/).map(x=>x.trim()).filter(Boolean)])];
          else if(action.field==='hot')c.hot=Boolean(action.value);
          else{const before=c[action.field];c[action.field]=action.value??'';if(action.field==='qualification'&&before!==c.qualification)c.qualificationHistory=[...(c.qualificationHistory||[]),{id:`QAI-${Date.now()}-${c.id}`,from:before||'未评级',to:c.qualification,at:now,date:now.slice(0,10)}].slice(-100);if(action.field==='registration'&&c.registration==='已报名'&&!((state.registrations||[]).some(item=>String(item.customerId||'')===String(c.id)&&item.status==='已报名')))(state.registrations||(state.registrations=[])).unshift({id:`RAI-${Date.now()}-${c.id}`,customerId:c.id,date:now,source:'GPT管理',owner:c.assistant||'未分配',status:'已报名',note:action.note||'GPT 管理计划',createdAt:now});}
          c.touched=true;applied.push(action);
        }
        if(action.type==='add_followup'){const date=action.date||now,note=followupNote(action);if(!((state.followups||[]).some(item=>sameFollowup(item,c.id,date,note)))){(state.followups||(state.followups=[])).unshift({id:`FAI-${Date.now()}-${c.id}`,customerId:c.id,date,method:'GPT计划',registration:'',result:note,note,nextDate:c.due||''});c.lastFollow=String(date).slice(0,10);c.touched=true;applied.push(action);}}
        if(action.type==='add_registration'){const note=followupNote(action),registration={id:`RAI-${Date.now()}-${c.id}`,customerId:c.id,date:action.date||now,source:'GPT管理',owner:c.assistant||'未分配',status:'已报名',note,createdAt:now};if(!((state.registrations||[]).some(item=>String(item.customerId||'')===String(c.id)&&item.status==='已报名'&&String(item.note||'').trim()===note))){(state.registrations||(state.registrations=[])).unshift(registration);c.registration='已报名';c.touched=true;applied.push(action);}}
        if(action.type==='add_ticket'){const ticket=window.ZhikeTicketRecords?.normalizeTicketRecord?.({id:`TAI-${Date.now()}-${c.id}`,customerId:c.id,customer:c.name,phone:c.rawPhone||c.phone,date:String(action.date||now).slice(0,10),assistant:c.assistant,channel:c.source,group:c.group||'—',product:String(action.value||'未指定'),direction:'买入',status:'已确认',note:action.note||'GPT 管理计划'})||{id:`TAI-${Date.now()}-${c.id}`,customerId:c.id,date:String(action.date||now).slice(0,10),product:String(action.value||'未指定'),direction:'买入',note:action.note||'GPT 管理计划'};if(!((state.tickets||[]).some(item=>sameTicket(item,ticket)))){(state.tickets||(state.tickets=[])).unshift(ticket);c.ticket=true;c.touched=true;applied.push(action);}}
        if(action.type==='add_deposit'){const amount=Number(action.value),deposit={id:`DAI-${Date.now()}-${c.id}`,customerId:c.id,customer:c.name,phone:c.rawPhone||c.phone,date:String(action.date||now).slice(0,10),assistant:c.assistant,channel:c.source,group:c.group||'—',amount,currency:'INR',status:'已确认',note:action.note||'GPT 管理计划'};if(Number.isFinite(amount)&&amount>0&&amount<=1000000000000&&!((state.deposits||[]).some(item=>sameDeposit(item,deposit)))){(state.deposits||(state.deposits=[])).unshift(deposit);c.deposit=true;c.amount=(Number(c.amount)||0)+amount;c.touched=true;applied.push(action);}}
        if(action.type==='archive_customer'&&!c.deleted){c.deleted=true;c.touched=true;applied.push(action);}
        if(action.type==='restore_customer'&&c.deleted){c.deleted=false;c.touched=true;applied.push(action);}
      }
      if(!applied.length)throw new Error('计划中没有可应用的有效操作。');
      const snapshot=await fetch('/api/snapshot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'GPT 管理计划写入前自动快照'})});
      if(!snapshot.ok)throw new Error('创建写入前快照失败，未修改数据。');
      state.batchOperations=[{id:`OPAI-${Date.now()}`,type:'GPT管理计划',value:pendingPlan.summary,count:applied.length,createdAt:now,status:'已执行'},...(state.batchOperations||[])].slice(0,500);
      state.activities=[{id:`AAI-${Date.now()}`,text:`GPT 管理计划写入 ${applied.length} 项`,time:new Date().toLocaleString('zh-CN'),createdAt:now,color:'green'},...(state.activities||[])].slice(0,5000);
      delete state.version;delete state.initialized;
      const response=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json','X-State-Version':version},body:JSON.stringify(state)});
      if(!response.ok){const failure=await response.json().catch(()=>({}));throw new Error(failure.error||'写入失败，数据可能已在其他窗口更新。');}
      // The plan is written through the API, so refresh the renderer snapshot
      // before any subsequent local edit can overwrite the GPT changes.
      let refreshWarning='';
      try { await window.__zhikeRegistryHost?.refreshState?.(); }
      catch (refreshError) { refreshWarning=String(refreshError?.message||'界面刷新失败，请手动刷新页面。'); console.warn('[知客] GPT 计划已写入，但界面刷新失败：',refreshWarning); }
      window.dispatchEvent(new CustomEvent('zhike-runtime-config-updated'));
      messages=messages.map(m=>m.actions?{...m,actions:null,text:`${m.text}\n\n已确认写入 ${applied.length} 项，本机快照已创建。${refreshWarning?` ${refreshWarning}`:''}`}:m);pendingPlan=null;
      messages.push({role:'assistant',text:`数据管理完成：成功写入 ${applied.length} 项。${refreshWarning?` ${refreshWarning}`:'你可以在操作记录和数据中心快照中查看或恢复。'}`});
    }catch(e){messages.push({role:'assistant',text:`写入失败：${e.message}`});}
    finally{busy=false;renderMessages();}
  }
  async function settings(){if(settingsMutationPending){notify('API Key 修改仍在完成，请稍后重新打开设置。');return;}const modalAtOpen=document.querySelector('#modal'),contentAtOpen=modalAtOpen?.innerHTML;const generation=++settingsGeneration;++settingsProviderGeneration;settingsProviderReady=false;settingsReturnFocus=document.activeElement;const status=await readAiStatus(window.zhikeAI);if(generation!==settingsGeneration||document.querySelector('#modal')!==modalAtOpen||modalAtOpen?.innerHTML!==contentAtOpen)return;const backdrop=document.querySelector('#modalBackdrop'),modal=document.querySelector('#modal');activeSettingsModal=modal;modal.innerHTML=`<div class="modal-header"><div><h2>GPT 本机设置</h2><p>OpenAI 与 TeamoRouter 密钥分开加密保存；前端只能看到配置状态和尾号。</p></div><button class="modal-close" data-gpt-action="close">×</button></div><div class="modal-body"><div class="filter-grid" style="grid-template-columns:1fr"><label class="filter-field"><span>API 服务商</span><select id="gptProvider"><option value="openai" ${status.provider==='openai'?'selected':''}>OpenAI 官方 API</option><option value="teamorouter" ${status.provider==='teamorouter'?'selected':''}>TeamoRouter（第三方 API 网关）</option></select></label><label class="filter-field"><span>API Key <small id="gptKeyState">${status.configured?`已配置 · 尾号 ${esc(status.keyTail)}`:'未配置'}</small></span><input id="gptApiKey" type="password" autocomplete="new-password" placeholder="${status.configured?'留空保留当前密钥':'sk-…'}"></label><label class="filter-field"><span>模型名称</span><input id="gptModel" list="gptModelList" value="${esc(status.model||'gpt-5.6-sol')}" placeholder="gpt-5.6-sol"><datalist id="gptModelList"></datalist></label><label class="gpt-check"><input type="checkbox" id="gptDefaultPhone" ${status.defaultIncludePhone?'checked':''}>默认允许本次包含客户号码</label></div><div id="gptSettingsStatus" class="notice-line">${status.provider==='teamorouter'?'TeamoRouter 使用 OpenAI 兼容的 /v1/chat/completions；GPT 模型暂时不可用时会自动重试、查询目录并切换可用模型。':'OpenAI 使用正式 Responses API；网页订阅不能代替 API Key。'} 连接测试只发送最小测试文字，不发送任何客户资料或号码。</div></div><div class="modal-footer">${status.configured?'<button class="btn danger" data-gpt-action="remove-key">删除当前服务商密钥</button>':''}<button class="btn" data-gpt-action="models">获取可用模型</button><button class="btn" data-gpt-action="test">测试连接</button><button class="btn" data-gpt-action="close">取消</button><button class="btn primary" data-gpt-action="save-key">保存设置</button></div>`;settingsProviderReady=!status.error;if(status.error){modal.querySelector('#gptSettingsStatus').textContent=friendlyError(status.error);const state=modal.querySelector('#gptKeyState');if(state)state.textContent='状态读取失败，原配置未修改';}backdrop.classList.remove('hidden');syncSettingsControls();modal.querySelector('[data-gpt-action="close"]')?.focus();}
  function close(){++settingsGeneration;++settingsProviderGeneration;++settingsOperationGeneration;settingsProviderReady=false;const key=activeSettingsModal?.querySelector('#gptApiKey');if(key)key.value='';activeSettingsModal=null;document.querySelector('#modalBackdrop')?.classList.add('hidden');const target=settingsReturnFocus;settingsReturnFocus=null;if(target?.isConnected&&typeof target.focus==='function')target.focus();}
  window.ZhikeGPT=Object.freeze({render,invalidatePrivacyPreview,cancel:cancelActiveRequest});
  document.addEventListener('change',async e=>{
    if(!isGptActive()&&!(e.target.id==='gptProvider'&&isOwnedSettingsTarget(e.target)))return;
    if(e.target.matches('#gptScope,#gptIncludePhone,#gptManageMode'))privacyPreview();
    if(e.target.id!=='gptProvider')return;
    if(!isOwnedSettingsTarget(e.target))return;
    const input=document.querySelector('#gptApiKey');if(input)input.value='';
    if(settingsMutationPending){e.target.value=settingsMutationProvider;return;}
    ++settingsProviderGeneration;++settingsOperationGeneration;settingsProviderReady=false;
    const context=settingsContext(),box=context.modal.querySelector('#gptSettingsStatus'),model=context.modal.querySelector('#gptModel'),key=context.modal.querySelector('#gptKeyState'),list=context.modal.querySelector('#gptModelList');
    if(model)model.value='';if(key)key.textContent='正在读取配置…';if(list)list.innerHTML='';if(box)box.textContent='正在读取当前服务商设置…';syncSettingsControls();
    try{
      const status=await window.zhikeAI.status({provider:context.provider});
      if(!settingsContextCurrent(context))return;
      if(status.provider!==context.provider)throw new Error('服务商状态与当前选择不符，请重新选择。');
      if(key)key.textContent=status.configured?`已配置 · 尾号 ${status.keyTail}`:'未配置';
      if(input)input.placeholder=status.configured?'留空保留当前密钥':'sk-…';
      if(model)model.value=status.model;
      if(box)box.textContent=status.provider==='teamorouter'?'TeamoRouter 使用 OpenAI 兼容的 /v1/chat/completions；模型临时不可用时会自动重试并切换目录中的可用 GPT。连接测试不发送客户资料或号码。':'OpenAI 使用正式 Responses API；网页订阅不能代替 API Key。连接测试不发送客户资料或号码。';
      settingsProviderReady=true;
    }catch(error){
      if(!settingsContextCurrent(context))return;
      if(key)key.textContent='状态读取失败，原配置未修改';
      if(box)box.textContent=`读取服务商设置失败：${friendlyError(error)}`;
      notify(friendlyError(error));
    }finally{if(settingsContextCurrent(context))syncSettingsControls();}
  });
  document.addEventListener('keydown',e=>{if(!isGptActive())return;if(e.target.id==='gptInput'&&(e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();send();return;}if(e.target.id==='gptDropzone'&&(e.key==='Enter'||e.key===' ')){e.preventDefault();document.querySelector('#gptFiles')?.click();}});
  document.addEventListener('dragover',e=>{if(!isGptActive()||!e.target.closest?.('.gpt-chat'))return;const zone=document.querySelector('#gptDropzone');if(!zone)return;e.preventDefault();zone.classList.add('dragging');});
  document.addEventListener('dragleave',e=>{if(!isGptActive()||!e.target.closest?.('.gpt-chat'))return;if(e.relatedTarget?.closest?.('.gpt-chat'))return;document.querySelector('#gptDropzone')?.classList.remove('dragging');});
  document.addEventListener('drop',e=>{if(!isGptActive()||!e.target.closest?.('.gpt-chat'))return;const zone=document.querySelector('#gptDropzone');if(!zone)return;e.preventDefault();zone.classList.remove('dragging');addFiles(e.dataTransfer?.files||[]);});
  document.addEventListener('change',e=>{if(!isGptActive()||e.target.id!=='gptFiles')return;addFiles(e.target.files||[]);e.target.value='';});
  document.addEventListener('click',async e=>{const action=e.target.closest('[data-gpt-action]')?.dataset.gptAction;const customerShortcut=e.target.closest('[data-gpt-customer]');if(!isGptActive()&&action!=='settings'&&!customerShortcut&&!isOwnedSettingsAction(e.target,action))return;if(action==='retry-render')render();if(action==='settings'){await settings();return;}if(settingsActions.has(action)){if(isOwnedSettingsAction(e.target,action))await settingsAction(action);return;}if(action==='send')send();if(action==='clear-chat'){messages=[];pendingPlan=null;attachments=[];renderMessages();renderAttachments();}if(action==='apply-plan'&&confirm(`确认将 GPT 计划的 ${pendingPlan?.actions?.length||0} 项操作写入本机数据？写入前会自动创建快照。`))applyPlan();if(e.target.closest('#gptDropzone'))document.querySelector('#gptFiles')?.click();const remove=e.target.closest('[data-gpt-remove-file]');if(remove){attachments.splice(Number(remove.dataset.gptRemoveFile),1);renderAttachments();privacyPreview();}const prompt=e.target.closest('[data-gpt-prompt]');if(prompt){const input=document.querySelector('#gptInput');if(input){input.value=prompt.dataset.gptPrompt;input.focus();}}if(customerShortcut){selectedCustomerId=customerShortcut.dataset.gptCustomer;const host=window.__zhikeRegistryHost;if(host?.state)host.state.view='gpt';render();}});
  document.addEventListener('click',async e=>{if(!isGptActive())return;const action=e.target.closest('[data-gpt-action]')?.dataset.gptAction;if(action==='cancel'){await cancelActiveRequest();return;}if(action==='workspace'){try{const result=await window.zhikeAI.selectWorkspace();if(result.canceled)return;const text=(result.files||[]).map(file=>`--- ${file.name} ---\n${file.text}`).join('\n\n');attachments.push({name:`代码工作区：${result.rootName}${result.truncated?'（部分文件）':''}`,type:'text/plain',size:new Blob([text]).size,text});assistantMode='code';const mode=document.querySelector('#gptAssistantMode');if(mode)mode.value='code';renderAttachments();privacyPreview();}catch(error){notify(friendlyError(error));}}});
  document.addEventListener('change',e=>{if(!isGptActive()||e.target.id!=='gptAssistantMode')return;assistantMode=e.target.value;updateWorkspaceMetrics();try{localStorage.setItem('zhike-gpt-last-session',JSON.stringify({mode:assistantMode,messages:messages.slice(-20).map(({role,text})=>({role,text}))}));}catch{}});
  const mountCustomerAction=()=>{const drawer=document.querySelector('#customerDrawer.open');if(!drawer||drawer.querySelector('[data-gpt-customer]'))return;const edit=drawer.querySelector('[data-action="edit-customer"]'),id=edit?.dataset.id;if(!id)return;const button=document.createElement('button');button.className='btn';button.dataset.gptCustomer=id;button.textContent='GPT 分析';drawer.querySelector('.drawer-actions')?.prepend(button);};
  // Chat messages, WS status and table rows can mutate frequently. The GPT
  // shortcut belongs only to the customer drawer, so observing document.body
  // made unrelated activity repeatedly execute a global query during scroll.
  // The drawer is created lazily. Watch only direct body children until it
  // exists, then disconnect that bootstrap observer permanently.
  let customerDrawerObserver;
  const bindCustomerDrawer=()=>{const drawer=document.querySelector('#customerDrawer');if(!drawer)return false;if(!customerDrawerObserver){customerDrawerObserver=new MutationObserver(mountCustomerAction);customerDrawerObserver.observe(drawer,{childList:true});}mountCustomerAction();return true;};
  if(!bindCustomerDrawer()){
    const drawerBootstrapObserver=new MutationObserver(()=>{if(bindCustomerDrawer())drawerBootstrapObserver.disconnect();});
    drawerBootstrapObserver.observe(document.body,{childList:true});
  }
  document.addEventListener('click',e=>{if(!isGptActive())return;if(e.target.closest('[data-gpt-action="local-excel"]'))document.querySelector('#gptLocalExcel')?.click();});
  document.addEventListener('change',e=>{if(!isGptActive()||e.target.id!=='gptLocalExcel')return;importExcelLocally(e.target.files?.[0]);e.target.value='';});
})();
