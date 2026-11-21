(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const icons = (name) => `<svg class="zk-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
  const selectionKey = id => String(id ?? '');
  const sameId = (left, right) => selectionKey(left) === selectionKey(right);
  class SelectionSet extends Set {
    add(id){return super.add(selectionKey(id));}
    has(id){return super.has(selectionKey(id));}
    delete(id){return super.delete(selectionKey(id));}
  }
  const assistants = ['未分配'];
  const phases = ['新客户','潜在客户','意向客户','高意向','成交客户','暂停跟进'];
  const qualifications = ['S级｜核心优质','A级｜优质','B级｜中等','C级｜一般','D级｜较差','E级｜极差'];
  const statuses = ['已进群','未进群','在群','已退群','待确认','临时退群','重粉'];
  const groupIds = [];
  const pages = [];
  // Zhike 6.0 business state is owned exclusively by the isolated SQLite
  // sidecar. WebView/localStorage is never a customer-data source.
  const segmentFilterDefaults=()=>({source:'全部',page:'全部',assistant:'全部',status:'',phase:'',hot:'',ticket:'',deposit:'',follow:'',vip:'',eventFilter:'',missingGroup:false});
  function builtinSavedViews(){const segmentDefaults=segmentFilterDefaults();return [
    {id:'builtin-customer-all',name:'全部客户',scope:'customer',filters:{},search:'',builtin:true},
    {id:'builtin-customer-today',name:'今日新增',scope:'customer',filters:{registered:'@today'},search:'',builtin:true},
    {id:'builtin-customer-joined',name:'已进群',scope:'customer',filters:{status:'已进群'},search:'',builtin:true},
    {id:'builtin-customer-hot',name:'热聊客户',scope:'customer',filters:{hot:'true'},search:'',builtin:true},
    {id:'builtin-customer-vip',name:'VIP 客户',scope:'customer',filters:{vip:'true'},search:'',builtin:true},
    {id:'builtin-segment-all',name:'全部客户',scope:'segment',filters:{},search:'',builtin:true},
    {id:'builtin-segment-today',name:'今日新增',scope:'segment',filters:{registered:'@today'},search:'',builtin:true},
    {id:'builtin-segment-joined',name:'已进群',scope:'segment',filters:{status:'已进群'},search:'',builtin:true},
    {id:'builtin-segment-hot',name:'热聊客户',scope:'segment',filters:{hot:'是'},search:'',builtin:true},
    {id:'builtin-segment-vip',name:'VIP 客户',scope:'segment',filters:{vip:'有'},search:'',builtin:true},
  ].map(view=>({...view,filters:view.scope==='segment'?{...segmentDefaults,...view.filters}:view.filters}));}
  function normalizeSavedViews(items){const defaults=builtinSavedViews();const normalized=(Array.isArray(items)?items:[]).map((item,index)=>{if(typeof item==='string'){const preset=defaults.find(view=>view.scope==='customer'&&view.name===item);return preset?{...preset,filters:{...preset.filters}}:{id:`legacy-customer-${index}-${Date.now().toString(36)}`,name:item.trim().slice(0,32)||'未命名视图',scope:'customer',filters:{},search:'',builtin:false};}if(!item||typeof item!=='object')return null;const scope=item.scope==='segment'?'segment':'customer';return {id:String(item.id||`view-${index}-${Date.now().toString(36)}`),name:String(item.name||'未命名视图').trim().slice(0,32)||'未命名视图',scope,filters:item.filters&&typeof item.filters==='object'&&!Array.isArray(item.filters)?{...item.filters}:{},search:String(item.search||''),builtin:Boolean(item.builtin)};}).filter(Boolean);for(const preset of defaults)if(!normalized.some(view=>view.id===preset.id))normalized.push(preset);const seen=new Set();return normalized.filter(view=>{if(seen.has(view.id))return false;seen.add(view.id);return true;});}
  const stored = null;
  const normalizeObjectRows = value => Array.isArray(value)
    ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row))
    : [];
  function normalizeCustomerRows(value, sourceDefinitions) {
    const definitions = Array.isArray(sourceDefinitions) ? sourceDefinitions : [];
    return normalizeObjectRows(value).map(customer => {
      const history = customer.statusHistory;
      if (!Array.isArray(history) || !history.some(event => event?.origin === 'ws-group-monitor' && !Object.hasOwn(event, 'to'))) return customer;
      return { ...customer, statusHistory: history.map(event => window.ZhikeBusinessRules.normalizeMonitorStatusHistoryEvent(event, definitions)) };
    });
  }
  const state = {
    customers: normalizeCustomerRows(stored?.customers), view: 'home', vipFilter: 'all', collapsed: (()=>{try{return localStorage.getItem('zhike-sidebar-collapsed')==='true';}catch{return false;}})(), followTab: 'open',
    segment: { source: '全部', page: '全部', assistant: '全部', status: '', phase: '', hot: '', ticket: '', deposit: '', follow: '', vip: '', missingGroup: false },
    search: '', customerSearch: '', businessSearch: '', registrationSearch: '', registrationSource: '全部', registrationOwner: '全部', registrationPage: 1, showFilters: false, extraFilters: {}, page: 1, perPage: 10, businessPeriod: 'all', businessAssistant: '全部', businessChannel: '全部', businessProductFilter: '', businessDirectionFilter: '全部',
    selected: new SelectionSet(), intakeText: typeof stored?.settings?.intakeDraft?.text==='string'?stored.settings.intakeDraft.text:'', parsed: [], savedViews: normalizeSavedViews(stored?.savedViews), pendingBatch: null, lastBatchUndo: null,
    activities: Array.isArray(stored?.activities)?stored.activities:[], channelAliases: stored?.channelAliases && typeof stored.channelAliases==='object'&&!Array.isArray(stored.channelAliases)?stored.channelAliases:{},
    tickets: normalizeObjectRows(stored?.tickets).flatMap(record=>window.ZhikeTicketRecords?.expandTicketRecord?.(record)||(window.ZhikeTicketRecords?.normalizeTicketRecord?.(record)||record)), deposits: normalizeObjectRows(stored?.deposits), followups: normalizeObjectRows(stored?.followups), registrations: normalizeObjectRows(stored?.registrations), phoneRegistry: normalizeObjectRows(stored?.phoneRegistry), batchOperations: normalizeObjectRows(stored?.batchOperations), settings: stored?.settings && typeof stored.settings==='object'&&!Array.isArray(stored.settings)?stored.settings:{}, wsGroupMembershipEvents: normalizeObjectRows(stored?.wsGroupMembershipEvents), importIssues: normalizeObjectRows(stored?.importIssues), qualityDecisions: stored?.qualityDecisions && typeof stored.qualityDecisions==='object'&&!Array.isArray(stored.qualityDecisions)?stored.qualityDecisions:{}, qualityView: 'overview', pendingCsv: null,
  };
  function normalizeStateIdentifiers(){
    for(const list of [state.customers,state.tickets,state.deposits,state.followups,state.registrations,state.phoneRegistry,state.batchOperations,state.importIssues])for(const item of list){
      if(item?.id!==undefined&&item.id!==null)item.id=selectionKey(item.id);
      if(item?.customerId!==undefined&&item.customerId!==null)item.customerId=selectionKey(item.customerId);
      if(item?.resolvedCustomerId!==undefined&&item.resolvedCustomerId!==null)item.resolvedCustomerId=selectionKey(item.resolvedCustomerId);
    }
  }
  function effectiveTheme(){return window.ZhikeWorkspaceShell?.currentTheme?.()||state.settings?.theme||'dark';}
  function applyAppearance(palette){document.documentElement.dataset.theme=state.settings?.theme||'dark';document.documentElement.dataset.density=state.settings?.density||'comfortable';if(palette)window.ZhikeWorkspaceShell?.setPalette?.(palette);}
  function applyStorageModeLabels(){document.documentElement.dataset.storageMode='local';const title=$('#storageModeTitle'),subtitle=$('#storageModeSubtitle'),badge=$('#storageModeBadge'),footer=$('#storageModeFooter');if(title)title.textContent='本机存储正常';if(subtitle)subtitle.textContent='SQLite · 本机服务已启动';if(badge)badge.textContent='本机模式';if(footer)footer.innerHTML='<i class="status-dot"></i>本机运行 · 数据仅保存在本机';}
  function normalizeQualificationValues(){const map={'优质':'A级｜优质','合格':'B级｜中等','观察':'C级｜一般','不合格':'D级｜较差','待评估':'C级｜一般'};for(const customer of normalizeObjectRows(state.customers)){const current=String(customer.qualification||'').trim();if(map[current])customer.qualification=map[current];}}
  function normalizeVipFields(){for(const customer of state.customers){if(!customer||typeof customer!=='object')continue;const legacy=customer.vipNumber??customer.vipId??customer.vipCode;const candidate=typeof legacy==='string'||typeof legacy==='number'?String(legacy).trim().slice(0,64):'';if(candidate)customer.vipNumber=candidate;else if(typeof customer.vip==='string'&&customer.vip.trim())customer.vipNumber=customer.vip.trim().slice(0,64);}}
  applyAppearance();
  applyStorageModeLabels();
  state.perPage=[10,20,50].includes(Number(state.settings.defaultPerPage))?Number(state.settings.defaultPerPage):10;
  const sources=['单导','群粉'];
  const groupFanSources=['群粉'];
  const nonBusinessSource=/^(快速录入|快录|文件导入|csv导入|excel导入|批量导入|手工导入)$/i;
  const singleSourceSignal=/(单导|单引|私聊|广告|落地页|自然流量|私域|单客)/i;
  const groupSourceSignal=/(群粉|群导|社群|微信群|whatsapp\s*群|telegram\s*群)/i;
  function importSourceCatalog(){return {...(state.channelAliases||{}),groupFanSources:[...groupFanSources],sources:[...sources],aliases:state.channelAliases||{},optionLists:state.settings?.optionLists||{},sourceDefinitions:state.settings?.sourceDefinitions||[]};}
  function canonicalBusinessSource(value){const raw=String(value||'').trim();if(!raw||nonBusinessSource.test(raw))return '';const catalog=[...groupFanSources,...sources].filter(Boolean).sort((a,b)=>String(b).length-String(a).length);const normalized=raw.replace(/[\s_\-\/\\（）()【】\[\]：:，,。·]/g,'').toLocaleLowerCase();const configured=catalog.find(option=>{const key=String(option).replace(/[\s_\-\/\\（）()【】\[\]：:，,。·]/g,'').toLocaleLowerCase();return key&&(normalized===key||normalized.includes(key));});if(configured)return configured;if(singleSourceSignal.test(raw)||raw==='single')return '单导';if(groupSourceSignal.test(raw)||raw==='group')return '群粉';return raw;}
  function normalizeBusinessSource(value,page='',fallback='单导'){const source=canonicalBusinessSource(value),safeFallback=canonicalBusinessSource(fallback),safePage=canonicalBusinessSource(page);return source||safeFallback||safePage||'单导';}
  const optionCatalog={sources:{label:'渠道',values:sources},groupFanSources:{label:'群粉类型',values:groupFanSources},assistants:{label:'跟进助理',values:assistants},pages:{label:'页面分类',values:pages},groupIds:{label:'群编号',values:groupIds},statuses:{label:'客户状态',values:statuses},phases:{label:'客户阶段',values:phases}};
  const defaultOptionLists=Object.fromEntries(Object.entries(optionCatalog).map(([key,item])=>[key,[...item.values]]));
  let groupLedgerDirty=true;
  function syncBusinessRuleState(){const rules=window.ZhikeBusinessRules;if(!rules)return;state.settings.businessRulesVersion=rules.BUSINESS_RULES.version;state.settings.sourceDefinitions=rules.reconcileSourceDefinitions(state.settings.sourceDefinitions,sources,groupFanSources,state.channelAliases);rules.stampSourceReferences({customers:state.customers,tickets:state.tickets,deposits:state.deposits,registrations:state.registrations},state.settings.sourceDefinitions,state.channelAliases);groupLedgerDirty=true;syncGroupMembershipLedger();if(Array.isArray(state.settings.operatingTasks))rules.dedupeActiveFollowupTasks(state.settings.operatingTasks);}
  function syncGroupMembershipLedger(force=false){const rules=window.ZhikeBusinessRules;if(!rules)return;if(!force&&!groupLedgerDirty&&Array.isArray(state.settings.groupMembershipEvents))return;state.settings.groupMembershipEvents=rules.buildGroupMembershipLedger(state.customers,[],state.settings.sourceDefinitions,state.channelAliases);groupLedgerDirty=false;}
  function renameSourceIdentity(oldValue,newValue){const rules=window.ZhikeBusinessRules;if(!rules||!oldValue||!newValue)return;state.settings.sourceDefinitions=rules.renameSourceDefinition(state.settings.sourceDefinitions,oldValue,newValue,groupFanSources);state.channelAliases??={};state.channelAliases[oldValue]=newValue;}
  function disableSourceIdentity(value,replacement=''){const rules=window.ZhikeBusinessRules;if(!rules||!value)return;state.settings.sourceDefinitions=rules.disableSourceDefinition(state.settings.sourceDefinitions,value,replacement);state.channelAliases??={};if(replacement)state.channelAliases[value]=replacement;}
  function suppressedOption(key,value){return Array.isArray(state.settings.deletedOptionValues?.[key])&&state.settings.deletedOptionValues[key].includes(value);}
  function applyOptionLists(){for(const [key,item] of Object.entries(optionCatalog)){const saved=state.settings.optionLists?.[key];if(Array.isArray(saved)){const values=state.settings.optionListsVersion===2?saved:[...defaultOptionLists[key],...saved];item.values.splice(0,item.values.length,...new Set(values.map(value=>String(value).trim()).filter(value=>value&&!nonBusinessSource.test(value)&&!suppressedOption(key,value))));}}for(const value of groupFanSources)if(!suppressedOption('sources',value)&&!suppressedOption('groupFanSources',value)&&!sources.includes(value))sources.push(value);state.settings.groupFanKnown=[...groupFanSources.filter(value=>!suppressedOption('groupFanSources',value)&&!suppressedOption('sources',value))];for(const customer of normalizeObjectRows(state.customers)){const page=String(customer.page||'').trim(),source=normalizeBusinessSource(customer.source,page,customer.channel);if(source==='群粉'&&page==='群粉登记')customer.page='';delete customer.legacyChannel;customer.source=source;customer.channel=normalizeBusinessSource(customer.channel,page,source);}syncBusinessRuleState();}
  function notifyOptionListsChanged(key,oldValue='',newValue=''){businessIndexCache=null;businessRecordsCache={revision:-1,tickets:null,deposits:null};countsCache=null;intakePhoneIndex=null;window.dispatchEvent(new CustomEvent('zhike:option-lists-changed',{detail:{key,oldValue,newValue,optionLists:structuredClone(state.settings.optionLists||{})}}));}
  function persistOptionLists(key='',oldValue='',newValue=''){for(const value of groupFanSources)if(!suppressedOption('sources',value)&&!suppressedOption('groupFanSources',value)&&!sources.includes(value))sources.push(value);state.settings.groupFanKnown=[...groupFanSources.filter(value=>!suppressedOption('groupFanSources',value)&&!suppressedOption('sources',value))];state.settings.optionListsVersion=2;state.settings.optionLists=Object.fromEntries(Object.entries(optionCatalog).map(([name,item])=>[name,[...item.values]]));syncBusinessRuleState();persist();notifyOptionListsChanged(key,oldValue,newValue);}
  function optionFallback(key,removedValue){const values=optionCatalog[key]?.values||[];if(key==='groupFanSources')return sources.find(value=>value!==removedValue&&!groupFanSources.includes(value))||'单导';return values.find(value=>value!==removedValue)||({sources:'单导',assistants:'未分配',pages:'',groupIds:'—',statuses:'未进群',phases:'新客户'}[key]??'');}
  function replaceOptionReferences(key,oldValue,newValue){const replace=(record,field)=>{if(record&&typeof record==='object'&&!Array.isArray(record)&&record[field]===oldValue)record[field]=newValue;};if(key==='sources'||key==='groupFanSources'){for(const customer of normalizeObjectRows(state.customers)){replace(customer,'source');replace(customer,'channel');for(const event of normalizeObjectRows(customer.statusHistory))replace(event,'source');}for(const record of normalizeObjectRows(state.tickets))replace(record,'channel');for(const record of normalizeObjectRows(state.deposits))replace(record,'channel');for(const record of normalizeObjectRows(state.registrations))replace(record,'source');if(state.settings.intakeDefaults?.source===oldValue)state.settings.intakeDefaults.source=newValue;if(state.extraFilters.source===oldValue)state.extraFilters.source=newValue||'';if(state.segment.source===oldValue)state.segment.source=newValue||'全部';for(const view of state.savedViews||[])if(view.filters?.source===oldValue)view.filters.source=newValue||'';for(const [alias,target] of Object.entries(state.channelAliases||{})){if(target===oldValue)state.channelAliases[alias]=newValue;if(alias===oldValue){delete state.channelAliases[alias];if(newValue)state.channelAliases[newValue]=target===oldValue?newValue:target;}}}else if(key==='assistants'){for(const customer of normalizeObjectRows(state.customers))replace(customer,'assistant');for(const record of normalizeObjectRows(state.tickets))replace(record,'assistant');for(const record of normalizeObjectRows(state.deposits))replace(record,'assistant');for(const record of normalizeObjectRows(state.registrations))replace(record,'owner');if(state.settings.intakeDefaults?.assistant===oldValue)state.settings.intakeDefaults.assistant=newValue;}else if(key==='pages'){for(const customer of normalizeObjectRows(state.customers))replace(customer,'page');if(state.settings.intakeDefaults?.page===oldValue)state.settings.intakeDefaults.page=newValue;}else if(key==='groupIds'){for(const customer of normalizeObjectRows(state.customers))replace(customer,'group');for(const record of normalizeObjectRows(state.tickets))replace(record,'group');for(const record of normalizeObjectRows(state.deposits))replace(record,'group');if(state.settings.intakeDefaults?.group===oldValue)state.settings.intakeDefaults.group=newValue;}else if(key==='statuses'){for(const customer of normalizeObjectRows(state.customers))replace(customer,'status');if(state.settings.intakeDefaults?.status===oldValue)state.settings.intakeDefaults.status=newValue;}else if(key==='phases'){for(const customer of normalizeObjectRows(state.customers))replace(customer,'phase');if(state.settings.intakeDefaults?.phase===oldValue)state.settings.intakeDefaults.phase=newValue;}for(const view of state.savedViews||[])if(view.filters?.[{assistants:'assistant',pages:'page',groupIds:'group',statuses:'status',phases:'phase'}[key]]===oldValue)view.filters[{assistants:'assistant',pages:'page',groupIds:'group',statuses:'status',phases:'phase'}[key]]=newValue||'';}
  function isGroupFanSource(value){return value==='群粉'||groupFanSources.includes(value)||(state.settings.groupFanKnown||[]).includes(value);}
  function effectiveCustomerSource(customer){
    const broad=canonicalBusinessSource(customer?.source||''),channel=canonicalBusinessSource(customer?.channel||'');
    if(broad&&broad!=='群粉'&&broad!=='单导')return broad;
    if(channel&&channel!=='群粉'&&channel!=='单导')return channel;
    return broad||channel||'未分类';
  }
  function effectiveStatusEventSource(customer,event){
    const eventSource=canonicalBusinessSource(event?.source||'');
    if(event?.origin==='ws-group-monitor'&&eventSource)return eventSource;
    if(eventSource&&eventSource!=='群粉'&&eventSource!=='单导')return eventSource;
    return effectiveCustomerSource(customer);
  }
  function exposeImportSourceCatalog(){const aliases=state.channelAliases;if(!aliases||typeof aliases!=='object'||Array.isArray(aliases))return;for(const [name,getter] of [['groupFanSources',()=>[...groupFanSources]],['sources',()=>[...sources]],['optionLists',()=>state.settings?.optionLists||{}],['sourceDefinitions',()=>state.settings?.sourceDefinitions||[]],['aliases',()=>state.channelAliases]]){try{Object.defineProperty(aliases,name,{configurable:true,enumerable:false,get:getter});}catch{}}}
  window.addEventListener('zhike:option-lists-changed',exposeImportSourceCatalog);
  applyOptionLists();
  exposeImportSourceCatalog();
  normalizeQualificationValues();
  normalizeVipFields();
  const navNames = {home:'今日工作台',customers:'客户中心',segments:'分类视图',intake:'快速录入',operations:'任务中心','stage-board':'阶段看板',followups:'客户跟进',hot:'热聊管理',tickets:'跟票管理',registrations:'报名统计',deposits:'入金管理',groups:'群组管理',analytics:'统计分析',automation:'本地自动化',quality:'数据治理',data:'数据中心',activity:'操作记录',recycle:'回收站',settings:'系统设置','phone-registry':'手机号登记',vip:'VIP 管理',gpt:'GPT 运营助手'};
  const customerColumnDefs=[['select','选择',true],['customer','客户',true],['rawPhone','原始号码'],['phone','标准号码'],['source','渠道'],['page','页面'],['assistant','助理'],['status','进群状态'],['phase','客户阶段'],['hot','热聊'],['vip','VIP'],['group','群编号'],['ticket','跟票'],['deposit','入金'],['registered','登记日期'],['actions','操作',true]];
  const defaultCustomerColumnKeys=customerColumnDefs.map(([key])=>key);
  function visibleCustomerColumns(mode){const saved=state.settings.tableColumns?.[mode];const available=new Set(defaultCustomerColumnKeys);const keys=Array.isArray(saved)?saved.filter(key=>available.has(key)):defaultCustomerColumnKeys;return new Set([...keys,'select','customer','actions']);}
  function normalizedViewFilters(scope,filters){const defaults=scope==='segment'?segmentFilterDefaults():{};return Object.fromEntries(Object.entries(filters||{}).filter(([key,value])=>value!==''&&value!==false&&value!=null&&value!==defaults[key]).map(([key,value])=>[key,value==='@today'?today:value]).sort(([a],[b])=>a.localeCompare(b)));}
  function savedViewMatches(view,scope){const currentFilters=scope==='customer'?state.extraFilters:state.segment;const currentSearch=scope==='customer'?state.customerSearch:state.search;return view.scope===scope&&JSON.stringify([normalizedViewFilters(scope,view.filters),view.search||''])===JSON.stringify([normalizedViewFilters(scope,currentFilters),currentSearch||'']);}
  function renderSavedViews(scope){const views=state.savedViews.filter(view=>view.scope===scope);return `<div class="saved-view-strip">${views.map(view=>`<span class="saved-view-entry"><button class="saved-view ${savedViewMatches(view,scope)?'active':''}" data-saved-view="${esc(view.id)}">${esc(view.name)}</button>${view.builtin?'':`<button class="saved-view-icon" data-action="rename-view" data-id="${esc(view.id)}" title="重命名视图" aria-label="重命名${esc(view.name)}">${icons('edit')}</button><button class="saved-view-icon danger" data-action="delete-view" data-id="${esc(view.id)}" title="删除视图" aria-label="删除${esc(view.name)}">${icons('x')}</button>`}</span>`).join('')}<button class="saved-view add" data-action="save-view" data-mode="${scope}">＋ 保存视图</button></div>`;}
  function resolveSavedFilters(view){const filters={...(view.filters||{})};for(const [key,value] of Object.entries(filters))if(value==='@today')filters[key]=today;return filters;}
  function applySavedView(id){const view=state.savedViews.find(item=>item.id===id);if(!view){toast('找不到此保存视图','x');return;}if(view.scope==='customer'){state.extraFilters=resolveSavedFilters(view);state.customerSearch=view.search||'';state.showFilters=Object.keys(state.extraFilters).length>0;setView('customers');}else{state.segment={...segmentFilterDefaults(),...resolveSavedFilters(view)};state.search=view.search||'';setView('segments');}toast(`已应用视图：${view.name}`);}
  const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let dbWriteTimer, dbWriteWarned=false, dbWritePromise=Promise.resolve(), pendingStateData=null, dbWriteFailure=null, syncReadFailure=null, intakeBatchPhones=null, intakeBatchVipNumbers=null, intakePhoneIndex=null, intakeVipIndex=null, syncTimer=null, syncBusy=false, syncPollDelay=5000, syncPollMaxDelay=60000, dataSyncStarted=false, syncVisibilityHandler=null, destructiveWriteBusy=false, stateVersion='', lastCommittedState=null, writeConflict=null;
  let initialBackendReadPending=true;
  // Read provenance belongs to the existing state reader, not to the metrics
  // getter. Empty startup arrays are not evidence of a successful DB read.
  let metricsReadState={status:'loading',hasLastGood:false,lastLoadedAt:null,lastCheckedAt:null,errorCode:null,revision:0,nextRequest:0,settledRequest:0,pending:new Set()};
  function beginMetricsRead(){const request=++metricsReadState.nextRequest;metricsReadState.pending.add(request);metricsReadState.revision++;return request;}
  function completeMetricsRead(request,outcome,errorCode='STATE_READ_FAILED'){
    if(!metricsReadState.pending.delete(request))return;
    const before=metricsReadState.status,at=new Date().toISOString();
    if(request>=metricsReadState.settledRequest&&outcome!=='discarded'){
      if(outcome==='applied'){metricsReadState.hasLastGood=true;metricsReadState.lastLoadedAt=at;}
      metricsReadState.settledRequest=request;
      if(outcome==='applied'||outcome==='checked'){
        metricsReadState.lastCheckedAt=at;
        if(metricsReadState.hasLastGood){metricsReadState.status='loaded';metricsReadState.errorCode=null;}
      }else if(outcome==='error'){metricsReadState.status='error';metricsReadState.errorCode=errorCode;}
    }
    metricsReadState.revision++;
    if(before!==metricsReadState.status&&state.view==='home')scheduleHomeRefresh();
  }
  const cloneStateData=data=>JSON.parse(JSON.stringify(data));
  function statePayload(){syncGroupMembershipLedger();return {schemaVersion:4,customers:state.customers,savedViews:state.savedViews,activities:state.activities,tickets:state.tickets.flatMap(record=>window.ZhikeTicketRecords?.expandTicketRecord?.(record)||(window.ZhikeTicketRecords?.normalizeTicketRecord?.(record)||record)),deposits:state.deposits,followups:state.followups,registrations:state.registrations,phoneRegistry:state.phoneRegistry,batchOperations:state.batchOperations,settings:state.settings,channelAliases:state.channelAliases,importIssues:state.importIssues,qualityDecisions:state.qualityDecisions};}
  function markSyncVersion(version){
    if(version)stateVersion=String(version);
    if(initialBackendReadPending)return;
    const badge=$('#syncStatus');
    if(!badge)return;
    const localAvailable=window.__LOCAL_DB__;
    const status=!localAvailable||writeConflict||dbWriteFailure||syncReadFailure?'error':'online';
    badge.className=`sync-status ${status}`;
    badge.textContent=!localAvailable?'未连接本机服务':writeConflict?'数据冲突':dbWriteFailure?'保存异常':syncReadFailure?'同步异常':'已保存到本机';
    badge.title=!localAvailable?'请在知客桌面应用内连接本机服务':writeConflict?'检测到同一记录在多个窗口被修改，点击查看恢复选项':dbWriteFailure?'本机数据库写入失败，点击重试':syncReadFailure?'共享数据库同步失败，点击重试':'数据已保存到本机；多窗口会自动共享最新状态';
  }
  function mergeListByIdentity(base,local,remote,key){const index=list=>new Map((list||[]).map(item=>[String(item?.[key]??JSON.stringify(item)),item]));const b=index(base),l=index(local),r=index(remote),ids=new Set([...b.keys(),...l.keys(),...r.keys()]),rows=[],conflicts=[];for(const id of ids){const bv=b.get(id),lv=l.get(id),rv=r.get(id),bs=JSON.stringify(bv),ls=JSON.stringify(lv),rs=JSON.stringify(rv);if(ls===bs){if(rv!==undefined)rows.push(rv);}else if(rs===bs||ls===rs){if(lv!==undefined)rows.push(lv);}else conflicts.push(`${key}:${id}`);}return {rows,conflicts};}
  function mergeConcurrentState(base,local,remote){const merged={},conflicts=[];for(const key of new Set([...Object.keys(base||{}),...Object.keys(local||{}),...Object.keys(remote||{})])){const b=base?.[key],l=local?.[key],r=remote?.[key];if(Array.isArray(b)||Array.isArray(l)||Array.isArray(r)){const result=mergeListByIdentity(b,l,r,'id');merged[key]=result.rows;conflicts.push(...result.conflicts.map(id=>`${key}:${id}`));continue;}if(b&&l&&r&&typeof b==='object'&&typeof l==='object'&&typeof r==='object'){const obj={};for(const field of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){const bs=JSON.stringify(b[field]),ls=JSON.stringify(l[field]),rs=JSON.stringify(r[field]);if(ls===bs){if(r[field]!==undefined)obj[field]=r[field];}else if(rs===bs||ls===rs){if(l[field]!==undefined)obj[field]=l[field];}else conflicts.push(`${key}.${field}`);}merged[key]=obj;continue;}const bs=JSON.stringify(b),ls=JSON.stringify(l),rs=JSON.stringify(r);if(ls===bs)merged[key]=r;else if(rs===bs||ls===rs)merged[key]=l;else conflicts.push(key);}return {merged,conflicts};}
  function applySharedData(data){groupLedgerDirty=true;state.dataRevision=(state.dataRevision||0)+1;Object.assign(state,{customers:normalizeCustomerRows(data?.customers,data?.settings?.sourceDefinitions),tickets:normalizeObjectRows(data?.tickets).flatMap(record=>window.ZhikeTicketRecords?.expandTicketRecord?.(record)||(window.ZhikeTicketRecords?.normalizeTicketRecord?.(record)||record)),deposits:normalizeObjectRows(data?.deposits),followups:normalizeObjectRows(data?.followups),registrations:normalizeObjectRows(data?.registrations),phoneRegistry:normalizeObjectRows(data?.phoneRegistry),batchOperations:normalizeObjectRows(data?.batchOperations),settings:data?.settings&&typeof data.settings==='object'&&!Array.isArray(data.settings)?data.settings:{},wsGroupMembershipEvents:normalizeObjectRows(data?.wsGroupMembershipEvents),activities:normalizeObjectRows(data?.activities),savedViews:normalizeSavedViews(data?.savedViews),channelAliases:data?.channelAliases&&typeof data.channelAliases==='object'&&!Array.isArray(data.channelAliases)?data.channelAliases:{},importIssues:normalizeObjectRows(data?.importIssues),qualityDecisions:data?.qualityDecisions&&typeof data.qualityDecisions==='object'&&!Array.isArray(data.qualityDecisions)?data.qualityDecisions:{}});normalizeVipFields();if(!Object.hasOwn(data||{},'registrations')){state.registrations=state.followups.filter(item=>item&&typeof item==='object'&&item.registration==='已报名').map(item=>({id:`R-${item.id}`,customerId:item.customerId||'',date:String(item.date||'').slice(0,10),source:'跟进登记',owner:'',status:'已报名',note:item.note||item.result||'',createdAt:item.date||new Date().toISOString(),legacyFollowupId:item.id}));}state.perPage=[10,20,50].includes(Number(state.settings.defaultPerPage))?Number(state.settings.defaultPerPage):10;businessIndexCache=null;businessRecordsCache={revision:-1,tickets:null,deposits:null};countsCache=null;qualityScanCache={revision:-1,value:null};crmFollowCache.signature='';crmProfileCache=new WeakMap();applyOptionLists();exposeImportSourceCatalog();normalizeQualificationValues();applyAppearance();updateWorkspaceIdentity();state.selected.clear();intakePhoneIndex=null;intakeVipIndex=null;}
  function stateWriteBody(data){if(!lastCommittedState)return {headers:{},body:JSON.stringify(data)};const previous=new Map((lastCommittedState.customers||[]).map(c=>[String(c.id),c])),nextIds=new Set(data.customers.map(c=>String(c.id))),fields={};for(const key of Object.keys(data))if(key!=='customers'&&JSON.stringify(data[key])!==JSON.stringify(lastCommittedState[key]))fields[key]=data[key];const upsert=data.customers.filter(c=>JSON.stringify(c)!==JSON.stringify(previous.get(String(c.id)))),remove=[...previous.keys()].filter(id=>!nextIds.has(id));return {headers:{'X-Zhike-State-Format':'delta-v1'},body:JSON.stringify({upsert,remove,fields})};}
  async function stateWriteError(response,fallback){const failure=await response.json().catch(()=>({}));return new Error(failure.error||failure.message||`${fallback}（HTTP ${response.status}）`);}
async function enqueueStateWrite(data){queuedWriteCount++;dbWritePromise=dbWritePromise.catch(()=>{}).then(async()=>{const expectedVersion=stateVersion;let wire=stateWriteBody(data);let response=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json','X-State-Version':expectedVersion,...wire.headers},body:wire.body});if(response.status===409){const latest=await fetch('/api/state',{cache:'no-store'}).then(result=>result.json());const result=mergeConcurrentState(lastCommittedState||{},data,latest);if(result.conflicts.length){writeConflict={local:data,latest,conflicts:result.conflicts};throw new Error('检测到其他窗口同时修改了相同记录');}applySharedData(result.merged);data=statePayload();stateVersion=String(latest.version||'');wire={headers:{},body:JSON.stringify(data)};response=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json','X-State-Version':stateVersion,...wire.headers},body:wire.body});if(!response.ok)throw new Error('合并写入失败');render();toast('已自动合并其他窗口的独立修改');}if(!response.ok)throw new Error('写入失败');const result=await response.json().catch(()=>({}));lastCommittedState=cloneStateData(data);writeConflict=null;markSyncVersion(result.version);dbWriteWarned=false;dbWriteFailure=null;}).catch(error=>{if(!writeConflict&&data)pendingStateData=pendingStateData||data;dbWriteFailure=error;if(!dbWriteWarned){toast(writeConflict?'同一记录在其他窗口也有修改，请处理冲突':'本机数据库暂不可写，请稍后检查数据目录','x');dbWriteWarned=true;}markSyncVersion();}).finally(()=>{queuedWriteCount--;});return dbWritePromise;}
  async function flushStateWrites(){if(!window.__LOCAL_DB__)return;if(writeConflict)throw new Error('存在未解决的数据冲突，请先导出恢复副本并同步共享数据。');clearTimeout(dbWriteTimer);dbWriteTimer=null;let pendingFlush=null;if(pendingStateData){const data=pendingStateData;pendingStateData=null;pendingFlush=enqueueStateWrite(data);}await (pendingFlush||dbWritePromise);if(dbWriteFailure)throw dbWriteFailure;}
  const persist = () => { businessIndexCache=null;businessRecordsCache={revision:-1,tickets:null,deposits:null};countsCache=null;qualityScanCache={revision:-1,value:null};crmFollowCache.signature='';crmProfileCache=new WeakMap(); intakePhoneIndex=null;intakeVipIndex=null;state.savedViews=normalizeSavedViews(state.savedViews);groupLedgerDirty=true;const data=cloneStateData(statePayload());localDataRevision++;state.dataRevision=(state.dataRevision||0)+1;scheduleHomeRefresh();if(window.__LOCAL_DB__){if(writeConflict){writeConflict.local=data;markSyncVersion();}else{pendingStateData=data;markSyncVersion();clearTimeout(dbWriteTimer);dbWriteTimer=setTimeout(()=>{const queued=pendingStateData;pendingStateData=null;if(queued)enqueueStateWrite(queued);},180);}}updateCounts(); };
  let queuedWriteCount=0,localDataRevision=0,homeRefreshPending=false,registrationFilterTimer;
  function scheduleHomeRefresh(){if(homeRefreshPending)return;homeRefreshPending=true;requestAnimationFrame(()=>{homeRefreshPending=false;if(state.view!=='home')return;const modal=$('#modalBackdrop');if(modal&&!modal.classList.contains('hidden'))return;render();});}
  async function syncFromBackend(force=false){
    if(!window.__LOCAL_DB__||syncBusy||destructiveWriteBusy||pendingStateData||writeConflict||queuedWriteCount)return null;
    const revisionAtStart=localDataRevision;
    syncBusy=true;
    const metricsRead=beginMetricsRead();let metricsOutcome='discarded';
    try{
      if(!force&&stateVersion&&metricsReadState.hasLastGood){
        const versionResponse=await fetch('/api/state/version',{cache:'no-store'});
        if(!versionResponse.ok)throw new Error('同步版本检查失败');
        const status=await versionResponse.json();
        if(status.version===stateVersion){metricsOutcome='checked';syncReadFailure=null;dbWriteFailure=null;markSyncVersion(status.version);return true;}
        const modalOpen=!$('#modalBackdrop')?.classList.contains('hidden');
        if(modalOpen){const badge=$('#syncStatus');if(badge){badge.className='sync-status pending';badge.textContent='有新数据';badge.title='当前编辑结束后自动同步其他窗口的数据';}return null;}
      }
      const response=await fetch('/api/state',{cache:'no-store'});
      if(!response.ok)throw new Error('同步读取失败');
      const incoming=await response.json();
      if(localDataRevision!==revisionAtStart||pendingStateData||queuedWriteCount||writeConflict)return null;
      if(!incoming.initialized){metricsOutcome='checked';syncReadFailure=null;markSyncVersion(incoming.version);return true;}
      if(stateVersion||!metricsReadState.hasLastGood){applySharedData(incoming);metricsOutcome='applied';lastCommittedState=cloneStateData(statePayload());dbWriteFailure=null;syncReadFailure=null;markSyncVersion(incoming.version);render();toast('已同步其他窗口的最新数据');}else{metricsOutcome='checked';syncReadFailure=null;markSyncVersion(incoming.version);}
      return true;
    }catch(error){metricsOutcome='error';syncReadFailure=error;markSyncVersion();return false;}finally{syncBusy=false;completeMetricsRead(metricsRead,metricsOutcome);}
  }
  function clearDataSyncTimer(){if(syncTimer){clearTimeout(syncTimer);syncTimer=null;}}
  function scheduleDataSync(delay=syncPollDelay){
    clearDataSyncTimer();
    if(!dataSyncStarted||!window.__LOCAL_DB__||document.hidden)return;
    syncTimer=setTimeout(async()=>{
      syncTimer=null;
      const result=await syncFromBackend(false);
      if(result===false)syncPollDelay=Math.min(syncPollMaxDelay,Math.max(5000,syncPollDelay*2));
      else if(result===true)syncPollDelay=5000;
      scheduleDataSync(syncPollDelay);
    },Math.max(1000,Number(delay)||5000));
    syncTimer.unref?.();
  }
  function startDataSync(){
    if(!window.__LOCAL_DB__||dataSyncStarted)return;
    dataSyncStarted=true;
    syncPollDelay=5000;
    const scheduleVisibilitySync=()=>{
      clearDataSyncTimer();
      if(document.hidden)return;
      syncPollDelay=5000;
      void syncFromBackend(false).finally(()=>scheduleDataSync(syncPollDelay));
    };
    syncVisibilityHandler=scheduleVisibilitySync;
    document.addEventListener('visibilitychange',syncVisibilityHandler);
    window.addEventListener('focus',scheduleVisibilitySync);
    scheduleDataSync();
    $('#syncStatus')?.addEventListener('click',async()=>{
      if(writeConflict){if(!confirm('检测到双方同时修改了相同记录。先将本窗口当前完整数据导出为恢复副本，再载入共享最新数据？'))return;const localCopy=statePayload();download(`知客同步冲突恢复副本_${today}.json`,JSON.stringify({version:2,createdAt:new Date().toISOString(),...localCopy},null,2),'application/json');applySharedData(writeConflict.latest);lastCommittedState=cloneStateData(statePayload());stateVersion=String(writeConflict.latest.version||'');writeConflict=null;dbWriteFailure=null;syncReadFailure=null;markSyncVersion(stateVersion);render();toast('恢复副本已导出，共享数据已重新同步');return;}
      if(!dbWriteFailure&&!syncReadFailure)return;
      dbWriteFailure=null;syncReadFailure=null;markSyncVersion();
      try{await flushStateWrites();const syncResult=await syncFromBackend(true);if(syncResult!==true)throw new Error('共享数据库同步未完成');syncPollDelay=5000;scheduleDataSync();toast('本机数据同步已恢复');}
      catch{dbWriteFailure=new Error('同步重试失败');markSyncVersion();toast('同步仍未恢复，请确认本机数据服务正常','x');}
    });
  }
  async function snapshotBeforeWrite(reason){if(!window.__LOCAL_DB__)return true;try{await flushStateWrites();const response=await fetch('/api/snapshot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason})});const result=await response.json().catch(()=>({}));if(!response.ok||result.snapshotCreated!==true)throw new Error(result.error||'本机快照未创建');return true;}catch{toast('无法完成保存或创建写入前快照，本次批量写入已取消','x');return false;}}
  async function commitCsvImportWithSnapshot(){const pending=state.pendingCsv;if(!pending)return;const batches=pending.batches||[pending];if(batches.some(batch=>batch.mapping.phone==null)){toast('有文件未识别到“手机号码”列，请检查表头','x');return;}if(!await snapshotBeforeWrite(`CSV 批量导入 ${batches.length} 个文件前自动快照`))return;await commitCsvImport();}
  let intakeSaving=false;
  async function saveIntakeWithSnapshot(){
    if(intakeSaving)return;
    if(!state.parsed.length){toast('请先粘贴客户资料');return;}
    const canAdd=state.parsed.some(row=>row.phone.length===10&&!row.issues.length);
    if(!canAdd){toast('当前没有可新增号码，请检查异常行');return;}
    const addCount=state.parsed.filter(row=>row.phone.length===10&&!row.issues.length).length;
    if(!confirm(`确认写入 ${addCount} 位新客户？已存在和待检查行会保留在当前输入中。`))return;
    intakeSaving=true;
    const before={customers:state.customers,activities:state.activities.slice(),intakeText:state.intakeText,intakeBatches:state.settings.intakeBatches,intakeDefaults:state.settings.intakeDefaults,intakeDraft:state.settings.intakeDraft};
    try{
      if(!await snapshotBeforeWrite('快速录入写入前自动快照'))return;
      clearTimeout(intakeDraftTimer);
      const result=saveIntake();
      if(!result?.added)return;
      await flushStateWrites();
      if(state.view==='intake'){renderIntake();requestAnimationFrame(()=>$('#intakeText')?.focus());}
      toast('已保存 '+result.added+' 位客户'+(result.remaining?'，'+result.remaining+' 行未录入内容已保留':'，可粘贴下一批'));
    }catch(error){
      state.customers=before.customers;state.activities=before.activities;state.intakeText=before.intakeText;state.settings.intakeBatches=before.intakeBatches;state.settings.intakeDefaults=before.intakeDefaults;state.settings.intakeDraft=before.intakeDraft;intakePhoneIndex=null;persist();
      if(state.view==='intake'){parseIntake();renderIntake();}
      toast('保存未完成，粘贴内容已保留，请检查同步状态后重试','x');
    }finally{intakeSaving=false;}
  }
  async function retryImportIssueWithSnapshot(id){const phone=($('#issue-phone')?.value||'').replace(/\D/g,'').replace(/^91(?=\d{10}$)/,'');if(phone.length!==10){await retryImportIssue(id);return;}if(state.customers.some(c=>!c.deleted&&phoneForQuality(c)===phone)){await retryImportIssue(id);return;}if(!await snapshotBeforeWrite('修正导入行写入前自动快照'))return;await retryImportIssue(id);}
  async function ignoreImportIssueWithSnapshot(id){const issue=state.importIssues.find(x=>String(x.id)===String(id));if(!issue||!confirm('确认忽略该行？原始内容仍会保留，可在已处理记录中撤销。'))return;if(!await snapshotBeforeWrite('忽略导入行前自动快照'))return;await ignoreImportIssue(id,true);}
  // State is normally normalized at load time, but a partially written legacy
  // snapshot can still briefly expose a non-array value while the local
  // service is recovering.  Keep every customer-facing view (especially group
  // management) usable during that window instead of throwing on `.filter`.
  let activeCustomerCache={source:null,revision:-1,value:[]};
  const activeCustomers = () => {
    const source=Array.isArray(state.customers)?state.customers:[],revision=Number(state.dataRevision||0);
    if(activeCustomerCache.source===source&&activeCustomerCache.revision===revision)return activeCustomerCache.value;
    const value=source.filter(c=>c&&typeof c==='object'&&!Array.isArray(c)&&!c.deleted);
    activeCustomerCache={source,revision,value};
    return value;
  };
  function isIntakeHeaderLine(line){const raw=String(line||'').trim();if(!raw)return true;if(/^(?:[-_=*\s]+|序号[\s,，\t]+)/.test(raw))return true;const labelled=/(?:手机号|手机号码|电话号码|联系电话|客户姓名|姓名|渠道|来源|登记日期|注册日期|状态|页面|助理|群号)\s*[:：=]/i.test(raw);if(labelled)return false;const cells=raw.split(/[\t,，;；|]/).map(value=>value.trim()).filter(Boolean),headerPattern=/^(?:序号|手机号|手机号码|电话号码|联系电话|客户姓名|客户名称|联系人|姓名|渠道|来源|登记日期|注册日期|日期|状态|进群状态|页面|助理|群号|群编号|VIP编号|VIP号|备注|phone|mobile|name|source|channel|date|status|page|owner|group|note)$/i,headerHits=cells.filter(cell=>headerPattern.test(cell)).length;if(headerHits>=2&&!cells.some(cell=>/(?:\+?\d[\d\s().-]{7,}\d)|\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}/.test(cell)))return true;const keywordHits=(raw.match(/手机号|手机号码|联系电话|客户姓名|渠道|来源|登记日期|注册日期|状态|进群状态|页面|助理|群号/gi)||[]).length;return keywordHits>=3&&!/\d{7,}/.test(raw)&&!/@/.test(raw);}
  function smartIntakeTable(text){
    const content=String(text||'');
    if(!/[\t,;|]/.test(content)||!/\r?\n/.test(content)||!window.ZhikeSmartImport?.detectHeaderRow)return null;
    let rows;try{rows=parseCsv(content,detectCsvDelimiter(content));}catch{return null;}
    if(!Array.isArray(rows)||rows.length<2)return null;
    const detected=window.ZhikeSmartImport.detectHeaderRow(rows)||{};
    const headerIndex=Number.isInteger(detected.index)?detected.index:0;
    const headers=(rows[headerIndex]||[]).map(value=>String(value??'').trim());
    const headerHint=headers.some(value=>/(手机号|手机号码|电话号码|联系电话|客户姓名|姓名|渠道|来源|登记|注册|日期|状态|页面|助理|群号|phone|mobile|name|source|channel|status|date|owner|group)/i.test(value));
    if(!headerHint&&headerIndex===0)return null;
    const mapping=csvHeaderMapping(headers,rows.slice(headerIndex+1,headerIndex+21));
    if(mapping.phone==null)return null;
    const labels=[['name','姓名'],['vipNumber','VIP编号'],['source','渠道'],['page','页面'],['assistant','助理'],['group','群号'],['status','状态'],['phase','阶段'],['registered','登记日期'],['due','下次跟进']];
    const records=[];
    for(const cells of rows.slice(headerIndex+1)){
      if(!Array.isArray(cells)||!cells.some(value=>String(value??'').trim()))continue;
      const read=field=>mapping[field]==null?'':String(cells[mapping[field]]??'').trim();
      const phone=read('phone');
      const parts=[`号码:${phone}`];
      for(const [field,label] of labels){const value=read(field);if(value)parts.push(`${label}:${value}`);}
      const note=read('note');if(note)parts.push(note);
      if(!phone&&parts.length===1)parts.push(cells.map(value=>String(value??'').trim()).filter(Boolean).join(' '));
      records.push({line:parts.join('\t'),raw:cells.map(value=>String(value??'').trim()).join('\t')});
    }
    if(!records.length)return null;
    return {headerIndex,headers,mapping,records,skippedHeaders:headerIndex};
  }
  function parseIntakeLines(text){const content=String(text||'');state.intakeSkippedHeaders=0;state.intakeTableSummary=null;if(content.length>4*1024*1024||content.split(/\r?\n/).length>20000){state.parsed=[];toast('快速录入单次最多支持 20,000 行或 4 MB，请拆分内容或使用 CSV 导入。','x');return false;}state.parsed=[];intakeBatchPhones=new Set();intakeBatchVipNumbers=new Set();try{const table=smartIntakeTable(content),entries=table?table.records:content.split(/\r?\n/).map((line,index)=>({line,raw:line,index}));let skippedHeaders=table?.skippedHeaders||0;entries.forEach((entry,index)=>{const line=entry.line;if(!table&&isIntakeHeaderLine(line)){if(String(line||'').trim())skippedHeaders++;return;}const row=parseLine(line,entry.index??index);if(row){if(entry.raw&&entry.raw!==line)row.raw=entry.raw;state.parsed.push(row);}});state.intakeSkippedHeaders=skippedHeaders;if(table)state.intakeTableSummary={headerIndex:table.headerIndex,headers:table.headers,mapping:table.mapping,rows:table.records.length};}finally{intakeBatchPhones=null;intakeBatchVipNumbers=null;}return true;}
  function vipKey(value){return String(value??'').trim().slice(0,64).toLocaleLowerCase();}
  function knownIntakeVipNumbers(){if(!intakeVipIndex){intakeVipIndex=new Map();for(const customer of activeCustomers()){const key=vipKey(customer.vipNumber||customer.vipId||customer.vipCode);if(key&&!intakeVipIndex.has(key))intakeVipIndex.set(key,customer);}}return intakeVipIndex;}
  function knownIntakePhones(){if(!intakePhoneIndex){intakePhoneIndex=new Map();for(const customer of activeCustomers()){for(const phone of customerPhoneKeys(customer)){if(phone.length===10&&!intakePhoneIndex.has(phone))intakePhoneIndex.set(phone,customer);}}}return intakePhoneIndex;}
  const money = n => `¥${Number(n || 0).toLocaleString('zh-CN')}`;
  const localDateKey=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const localDateOffset=(days,base=new Date())=>{const date=new Date(base.getFullYear(),base.getMonth(),base.getDate()+days,12);return localDateKey(date);};
  const isValidDateKey=value=>{const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!match)return false;const [,year,month,day]=match.map(Number),date=new Date(year,month-1,day,12);return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day;};
  let today = localDateKey();
  const relative = date => date < today ? '已逾期' : date === today ? '今天' : date;
  function backupHealth(){const at=state.settings.lastBackupAt,stamp=at&&Date.parse(at),days=stamp?Math.max(0,Math.floor((Date.now()-stamp)/86400000)):null;return {at,days,needed:(activeCustomers().length>0||state.phoneRegistry.length>0)&&(days===null||days>=7),label:days===null?'尚未创建完整备份':days===0?'今天已完整备份':`${days} 天前完整备份`};}
  const buildCounts = () => {
    const result={total:0,single:0,group:0,joined:0,notJoined:0,left:0,hot:0,favorite:0,vip:0,ticket:0,deposit:0,today:0,overdue:0,due:0,unassigned:0,missingGroup:0};
    const business=businessSummaryIndex();
    for(const customer of activeCustomers()){const summary=customerBusinessSummary(customer,business),validDue=isValidDateKey(customer.due);result.total++;if(!isGroupFanSource(customer.source))result.single++;if(isGroupFanSource(customer.source))result.group++;if(['已进群','在群'].includes(customer.status))result.joined++;if(customer.status==='未进群')result.notJoined++;if(['已退群','临时退群'].includes(customer.status))result.left++;if(customer.hot)result.hot++;if(customer.favorite)result.favorite++;if(String(customer.vipNumber||customer.vipId||customer.vipCode||'').trim())result.vip++;if(summary.ticket)result.ticket++;if(summary.deposit)result.deposit++;if(customer.registered===today)result.today++;if(validDue&&customer.due<today)result.overdue++;if(validDue&&customer.due===today)result.due++;if(customer.assistant==='未分配')result.unassigned++;if(customer.group==='—')result.missingGroup++;}
    return result;
  };
  let countsCache=null;
  function counts(){const signature=`${state.dataRevision||0}:${state.customers.length}:${state.tickets.length}:${state.deposits.length}:${state.followups.length}:${state.customers[0]?.id||''}:${today}`;if(!countsCache||countsCache.signature!==signature)countsCache={signature,value:buildCounts()};return countsCache.value;}
  const linkedPhone=value=>String(value||'').replace(/\D/g,'').replace(/^91(?=\d{10}$)/,'');
  function customerPhoneKeys(customer){return [...new Set([customer.phone,customer.rawPhone,...(Array.isArray(customer.legacyPhones)?customer.legacyPhones:[])].map(linkedPhone).filter(Boolean))];}
  function buildBusinessSummaryIndex(){const tickets=new Set(),ticketRecordIds=new Set(),ticketPhones=new Set(),ticketRecordPhones=new Set(),depositCounts=new Set(),depositRecordIds=new Set(),depositPhones=new Set(),depositRecordPhones=new Set(),depositTotals=new Map(),depositPhoneTotals=new Map(),phoneOwners=new Map();for(const customer of normalizeObjectRows(state.customers)){if(customer.deleted)continue;for(const phone of customerPhoneKeys(customer)){if(!phoneOwners.has(phone))phoneOwners.set(phone,new Set());phoneOwners.get(phone).add(String(customer.id));}}for(const record of normalizeObjectRows(state.tickets)){const id=String(record.customerId||''),phone=linkedPhone(record.phone),confirmed=record.status!=='待确认';if(id){ticketRecordIds.add(id);if(confirmed)tickets.add(id);}else if(phone){ticketRecordPhones.add(phone);if(confirmed)ticketPhones.add(phone);}}for(const record of normalizeObjectRows(state.deposits)){const id=String(record.customerId||''),phone=linkedPhone(record.phone),amount=Number(record.amount)||0,confirmed=record.status!=='待确认';if(id){depositRecordIds.add(id);if(confirmed){depositCounts.add(id);depositTotals.set(id,(depositTotals.get(id)||0)+amount);}}else if(phone){depositRecordPhones.add(phone);if(confirmed){depositPhones.add(phone);depositPhoneTotals.set(phone,(depositPhoneTotals.get(phone)||0)+amount);}}}return {tickets,ticketRecordIds,ticketPhones,ticketRecordPhones,depositCounts,depositRecordIds,depositPhones,depositRecordPhones,depositTotals,depositPhoneTotals,phoneOwners};}
  let businessIndexCache=null,businessRecordsCache={revision:-1,tickets:null,deposits:null};
  function businessSummaryIndex(){const customers=Array.isArray(state.customers)?state.customers:[],tickets=Array.isArray(state.tickets)?state.tickets:[],deposits=Array.isArray(state.deposits)?state.deposits:[],signature=`${Number(state.dataRevision||0)}:${customers.length}:${tickets.length}:${deposits.length}:${customers[0]?.id||''}:${tickets[0]?.id||''}:${deposits[0]?.id||''}`;if(!businessIndexCache||businessIndexCache.signature!==signature)businessIndexCache={signature,value:buildBusinessSummaryIndex()};return businessIndexCache.value;}
  function customerBusinessSummary(customer,index=businessSummaryIndex()){const id=String(customer.id),phones=customerPhoneKeys(customer).filter(phone=>index.phoneOwners.get(phone)?.size===1&&index.phoneOwners.get(phone)?.has(id)),ticketPhoneRecords=phones.some(phone=>index.ticketRecordPhones.has(phone)),depositPhoneRecords=phones.some(phone=>index.depositRecordPhones.has(phone)),ticketRecords=index.ticketRecordIds.has(id)||ticketPhoneRecords,depositRecords=index.depositRecordIds.has(id)||depositPhoneRecords,phoneTicket=phones.some(phone=>index.ticketPhones.has(phone)),phoneAmount=phones.reduce((sum,phone)=>sum+(index.depositPhoneTotals.get(phone)||0),0);return {ticket:ticketRecords?index.tickets.has(id)||phoneTicket:Boolean(customer.ticket),deposit:depositRecords?index.depositCounts.has(id)||phones.some(phone=>index.depositPhones.has(phone)):Boolean(customer.deposit),amount:depositRecords?(index.depositTotals.get(id)||0)+phoneAmount:Number(customer.amount)||0};}
  let crmFollowCache={signature:'',counts:new Map()};
  function crmFollowCounts(){const signature=`${state.followups.length}:${state.followups[0]?.id||''}:${state.followups.at(-1)?.id||''}`;if(crmFollowCache.signature!==signature){const counts=new Map();for(const item of state.followups){const id=String(item.customerId||'');if(id)counts.set(id,(counts.get(id)||0)+1);}crmFollowCache={signature,counts};}return crmFollowCache.counts;}
  function computeCrmProfile(customer,businessIndex=businessSummaryIndex()){const business=customerBusinessSummary(customer,businessIndex),joined=['已进群','在群'].includes(customer.status),left=['已退群','临时退群'].includes(customer.status),followCount=crmFollowCounts().get(String(customer.id))||0,lastDate=customer.lastFollow&&customer.lastFollow!=='—'?customer.lastFollow:customer.registered,ageDays=Math.max(0,Math.floor((Date.now()-Date.parse(`${lastDate||today}T12:00:00`))/86400000));let score=10;if(customer.phone?.length===10)score+=8;if(customer.name&&customer.name!=='未命名客户')score+=5;if(customer.assistant&&customer.assistant!=='未分配')score+=5;if(customer.group&&customer.group!=='—')score+=4;if(joined)score+=12;if(customer.hot)score+=18;if(customer.investor)score+=8;if(followCount)score+=Math.min(15,followCount*3);if(business.ticket)score+=15;if(business.deposit)score+=30;if(customer.due<today)score-=Math.min(18,Math.max(4,Math.floor((Date.now()-Date.parse(`${customer.due}T12:00:00`))/86400000)*2));if(left)score-=10;if(ageDays>30&&!business.deposit)score-=12;score=Math.max(0,Math.min(100,score));const grade=score>=80?'S':score>=65?'A':score>=45?'B':score>=25?'C':'D';let stage=business.deposit?'已成交':business.ticket?'跟票转化':customer.hot?'重点培育':joined?'已进群培育':followCount?'持续跟进':'新线索';if(left&&!business.deposit)stage='流失唤醒';else if(ageDays>30&&!business.deposit)stage='沉睡唤醒';let nextAction='保持关系并关注复购';if(!business.deposit){if(customer.assistant==='未分配')nextAction='分配跟进助理';else if(!followCount)nextAction='完成首次联系';else if(customer.due<today)nextAction='处理逾期跟进';else if(left)nextAction='安排流失唤醒';else if(customer.hot&&!business.ticket)nextAction='确认需求并推动跟票';else if(business.ticket)nextAction='跟进跟票结果与入金';else if(!joined)nextAction='推动进群并持续培育';else nextAction='按计划继续跟进';}const sla=customer.due==='—'?'未安排':customer.due<today?'已逾期':customer.due===today?'今日到期':'计划中';return {score,grade,stage,nextAction,sla,followCount,ageDays,business};}
  let crmProfileCache=new WeakMap(),customerPriorityOrderCache={revision:-1,date:'',source:null,value:[]};
  let qualityScanCache={revision:-1,value:null};
  function crmProfile(customer,businessIndex=businessSummaryIndex()){const business=customerBusinessSummary(customer,businessIndex),followCount=crmFollowCounts().get(String(customer.id))||0,signature=[customer.name,customer.phone,customer.assistant,customer.group,customer.status,customer.phase,customer.hot,customer.investor,customer.due,customer.lastFollow,customer.registered,business.ticket,business.deposit,business.amount,followCount,today].join('|'),cached=crmProfileCache.get(customer);if(cached?.signature===signature)return cached.value;const value=computeCrmProfile(customer,businessIndex);crmProfileCache.set(customer,{signature,value});return value;}
  function customersByPriority(){
    const source=activeCustomers(),revision=Number(state.dataRevision||0);
    if(customerPriorityOrderCache.revision===revision&&customerPriorityOrderCache.date===today&&customerPriorityOrderCache.source===source)return customerPriorityOrderCache.value;
    const business=businessSummaryIndex();
    const value=source.map(customer=>({customer,profile:crmProfile(customer,business)})).sort((a,b)=>Number(Boolean(b.customer.favorite))-Number(Boolean(a.customer.favorite))||b.profile.score-a.profile.score||String(b.customer.registered||'').localeCompare(String(a.customer.registered||''))).map(item=>item.customer);
    customerPriorityOrderCache={revision,date:today,source,value};
    return value;
  }
  function advanceCrm(customer,event){const rank={'新客户':0,'潜在客户':1,'意向客户':2,'高意向':3,'成交客户':4};const promote=phase=>{if((rank[phase]??0)>(rank[customer.phase]??0))customer.phase=phase;};if(event==='follow'){customer.lastFollow=today;promote('潜在客户');}if(event==='joined')promote('意向客户');if(event==='hot'){customer.hot=true;promote('高意向');}if(event==='ticket'){customer.hot=true;promote('高意向');}if(event==='deposit'){customer.hot=true;customer.phase='成交客户';}}
  function smartFollowDays(customer){const crm=crmProfile(customer);if(crm.business.deposit)return 14;if(crm.grade==='S'||crm.grade==='A'||customer.hot)return 1;if(crm.grade==='B'||crm.business.ticket)return 3;if(crm.stage.includes('唤醒'))return 5;return 7;}
  function smartPriority(customer,businessIndex){const crm=crmProfile(customer,businessIndex),overdueDays=customer.due&&customer.due<today?Math.max(1,Math.floor((Date.now()-Date.parse(`${customer.due}T12:00:00`))/86400000)):0;return overdueDays*12+crm.score+(crm.sla==='今日到期'?20:0)+(customer.hot?12:0)+(customer.assistant==='未分配'?8:0);}
  function updateCounts() {
    const n=counts(); const nav=$('#navCustomerCount'); if(nav) nav.textContent=n.total.toLocaleString();
    const follow=$('#navFollowCount'); if(follow) follow.textContent=n.due+n.overdue;
    const hot=$('#navHotCount'); if(hot) hot.textContent=n.hot; const vip=$('#navVipCount'); if(vip) vip.textContent=activeCustomers().filter(c=>String(c.vipNumber||'').trim()).length;
    const tickets=$('#navTicketCount'); if(tickets) tickets.textContent=state.tickets.length;
    const registrations=$('#navRegistrationCount'); if(registrations){const activeIds=new Set(activeCustomers().map(customer=>String(customer.id)));registrations.textContent=new Set(state.registrations.filter(item=>item.status==='已报名'&&activeIds.has(String(item.customerId))).map(item=>String(item.customerId))).size;}
    const quality=$('#navQualityCount'); if(quality){const scan=qualityScan();quality.textContent=pendingImportIssues().length+scan.duplicates.length+scan.vipDuplicates.length+scan.invalid.length;}
    const phoneRegistry=$('#navPhoneRegistryCount'); if(phoneRegistry) phoneRegistry.textContent=state.phoneRegistry.filter(item=>item.phone).length;
    const alerts=n.due+n.overdue+(state.settings.staleHotReminder===false?0:staleHotCustomers().length)+pendingImportIssues().length+(backupHealth().needed?1:0);
    $('#notificationButton')?.classList.toggle('has-alert',alerts>0);
    const footer=$('#footerCount'); if(footer) footer.textContent=`本地客户库 · ${n.total.toLocaleString()} 位客户`;
  }
  function toast(message, icon='check') {
    const node=document.createElement('div'); node.className='toast'; node.innerHTML=`${icons(icon)}<span>${esc(message)}</span>`; $('#toastRegion').append(node); setTimeout(()=>node.remove(),2900);
  }
  function updateProfileAvatar(){for(const avatar of $$('.profile-avatar,.top-avatar')){avatar.replaceChildren();const value=state.settings.profileAvatar;if(typeof value==='string'&&value.startsWith('data:image/')){const image=document.createElement('img');image.src=value;image.alt='本地管理员头像';avatar.append(image);}else avatar.textContent=(state.settings.adminName||'本地管理员').trim().slice(0,1)||'管';}}
  function updateWorkspaceIdentity(){const name=(state.settings.workspaceName||'本地客户库').trim(),subtitle=(state.settings.workspaceSubtitle||'离线数据空间').trim(),admin=(state.settings.adminName||'本地管理员').trim();if($('#workspaceName'))$('#workspaceName').textContent=name;if($('#workspaceSubtitle'))$('#workspaceSubtitle').textContent=subtitle;if($('#adminName'))$('#adminName').textContent=admin;updateProfileAvatar();}
  function workspaceProfileModal(){openModal('工作区资料','名称和管理员称呼会保存在当前离线工作区，并随完整备份迁移。',`<div class="filter-grid" style="grid-template-columns:1fr"><label class="filter-field"><span>工作区名称</span><input id="workspaceNameInput" maxlength="32" value="${esc(state.settings.workspaceName||'本地客户库')}" placeholder="例如：印度客户运营中心"></label><label class="filter-field"><span>工作区说明</span><input id="workspaceSubtitleInput" maxlength="48" value="${esc(state.settings.workspaceSubtitle||'离线数据空间')}" placeholder="例如：销售一组 · 本机数据库"></label><label class="filter-field"><span>管理员称呼</span><input id="adminNameInput" maxlength="24" value="${esc(state.settings.adminName||'本地管理员')}" placeholder="例如：张主管"></label></div><div class="notice-line">这些资料只用于本机界面识别，不会上传，也不会改变客户数据。</div>`,`<button class="btn" data-action="close-modal">取消</button><button class="btn primary" data-action="save-workspace-profile">保存资料</button>`);$('#workspaceNameInput')?.focus();}
  async function saveWorkspaceProfile(){const next={workspaceName:$('#workspaceNameInput')?.value.trim().slice(0,32)||'本地客户库',workspaceSubtitle:$('#workspaceSubtitleInput')?.value.trim().slice(0,48)||'离线数据空间',adminName:$('#adminNameInput')?.value.trim().slice(0,24)||'本地管理员'},before={workspaceName:state.settings.workspaceName,workspaceSubtitle:state.settings.workspaceSubtitle,adminName:state.settings.adminName},beforeActivities=state.activities.slice();Object.assign(state.settings,next);updateWorkspaceIdentity();activity(`更新工作区资料：${next.workspaceName}`);try{await flushStateWrites();}catch{for(const [key,value] of Object.entries(before))if(value===undefined)delete state.settings[key];else state.settings[key]=value;state.activities=beforeActivities;updateWorkspaceIdentity();persist();toast('工作区资料保存失败，已恢复原设置','x');return;}closeModal();render();toast('工作区资料已保存');}
  function profileAvatarModal(){const hasAvatar=typeof state.settings.profileAvatar==='string'&&state.settings.profileAvatar.startsWith('data:image/'),initial=esc((state.settings.adminName||'本地管理员').trim().slice(0,1)||'管');openModal('本地管理员头像','头像保存在当前离线工作区，并同步显示在侧栏与顶栏。',`<div class="profile-avatar-editor"><div class="profile-avatar-preview" id="profileAvatarPreview">${hasAvatar?'<img alt="头像预览">':initial}</div><div class="profile-avatar-info"><strong>设置工作台头像</strong><span>支持 JPG、PNG、WebP，单张不超过 8 MB。图片会自动裁切并压缩为方形缩略图。</span></div></div><input id="profileAvatarFile" type="file" accept="image/jpeg,image/png,image/webp" hidden><div class="profile-avatar-actions"><button class="btn primary" data-action="choose-profile-avatar">${icons('edit')}选择图片</button>${hasAvatar?'<button class="btn" data-action="remove-profile-avatar">移除头像</button>':''}</div>`,`<button class="btn" data-action="close-modal">完成</button>`);if(hasAvatar)$('#profileAvatarPreview img').src=state.settings.profileAvatar;}
  async function saveProfileAvatar(file){if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)){toast('请选择 JPG、PNG 或 WebP 图片','x');return;}if(file.size>8*1024*1024){toast('图片超过 8 MB，请选择较小的文件','x');return;}let bitmap;try{bitmap=await createImageBitmap(file);if(bitmap.width<1||bitmap.height<1||bitmap.width>12000||bitmap.height>12000||bitmap.width*bitmap.height>50000000)throw new Error('图片尺寸过大，无法安全处理');const side=256,scale=Math.max(side/bitmap.width,side/bitmap.height),width=Math.round(bitmap.width*scale),height=Math.round(bitmap.height*scale),canvas=document.createElement('canvas');canvas.width=side;canvas.height=side;const context=canvas.getContext('2d');if(!context)throw new Error('当前环境无法处理图片');context.drawImage(bitmap,(side-width)/2,(side-height)/2,width,height);let dataUrl=canvas.toDataURL('image/webp',0.86);if(!dataUrl.startsWith('data:image/webp'))dataUrl=canvas.toDataURL('image/jpeg',0.86);const previous=state.settings.profileAvatar,previousActivities=state.activities.slice();state.settings.profileAvatar=dataUrl;activity('更新本地管理员头像');try{await flushStateWrites();}catch(error){if(previous===undefined)delete state.settings.profileAvatar;else state.settings.profileAvatar=previous;state.activities=previousActivities;persist();throw error;}updateProfileAvatar();profileAvatarModal();toast('头像已保存并同步到工作区');}catch(error){toast(error.message||'图片读取或保存失败','x');}finally{bitmap?.close();}}
  async function removeProfileAvatar(){const previous=state.settings.profileAvatar,previousActivities=state.activities.slice();delete state.settings.profileAvatar;activity('移除本地管理员头像');try{await flushStateWrites();}catch(error){state.settings.profileAvatar=previous;state.activities=previousActivities;persist();toast('头像移除失败，原头像已恢复','x');return;}updateProfileAvatar();profileAvatarModal();toast('已恢复默认头像');}
  function activity(text) { const now=new Date();state.activities.unshift({id:`A${Date.now()}-${Math.random().toString(36).slice(2,6)}`,text,time:now.toLocaleString('zh-CN'),createdAt:now.toISOString(),color:'green'});state.activities=state.activities.slice(0,5000);if(/^批量/.test(text)&&!state.batchOperations.some(op=>Date.now()-Date.parse(op.createdAt||0)<2000)){const count=Number(text.match(/(\d+)\s*位/)?.[1]||0);state.batchOperations.unshift({id:`OP${Date.now()}`,type:text.replace(/\s*\d+\s*位客户.*$/,''),value:'见操作详情',count,createdAt:now.toISOString(),status:'已执行'});state.batchOperations=state.batchOperations.slice(0,500);}persist(); }
  function setView(view) {
    if(state.view==='gpt'&&view!=='gpt')void window.ZhikeGPT?.cancel?.();
    state.view=view; state.page=1; state.selected.clear();
    document.documentElement.dataset.view=view;
    $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
    $('#crumbCurrent').textContent=navNames[view] || '工作台'; render();
  }
  const heading = (title, subtitle, actions='') => `<div class="page-heading"><div><h1 class="page-title">${title}</h1><p class="page-subtitle">${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;
  function governanceHeading(title,subtitle,eyebrow,actions='',signals=[]){
    const signalHtml=signals.filter(Boolean).map(([label,value,note='',tone=''])=>`<div class="governance-hero-signal ${tone}"><span>${esc(label)}</span><strong>${typeof value==='number'?value.toLocaleString():esc(value)}</strong>${note?`<small>${esc(note)}</small>`:''}</div>`).join('');
    return `<section class="page-heading governance-page-hero"><div class="governance-hero-copy"><span class="governance-eyebrow">${icons('spark')}${esc(eyebrow)}</span><h1 class="page-title">${esc(title)}</h1><p class="page-subtitle">${esc(subtitle)}</p></div><div class="heading-actions governance-hero-actions">${actions}</div>${signalHtml?`<div class="governance-hero-signals">${signalHtml}</div>`:''}</section>`;
  }
  const btn = (label, icon, action, cls='') => `<button class="btn ${cls}" data-action="${action}">${icons(icon)}${label}</button>`;
  const metric = (label,value,icon,tone,foot,action) => {const tag=action?'button':'div',type=action?' type="button"':'';return `<${tag}${type} class="metric-card" data-action="${action||''}"${action?` aria-label="${esc(label)}：${esc(value)}"`:''}><div class="metric-icon ${tone||''}">${icons(icon)}</div><div class="metric-data"><span class="metric-label">${label}</span><strong class="metric-value">${value}</strong></div><span class="metric-foot ${tone==='red'?'':'up'}">${foot||''}</span></${tag}>`;};
  function statusEventKind(status){return ['已进群','在群'].includes(status)?'joined':['已退群','临时退群'].includes(status)?'left':'';}
  function isStatusBaseline(event){return Boolean(event?.initial||(!event?.from&&event?.initial!==false));}
  function recordCustomerStatus(customer,nextStatus,{initial=false}={}){const previous=customer.status||'',before=initial?'':statusEventKind(previous),after=statusEventKind(nextStatus);if((!initial&&previous===nextStatus)||!after||after===before)return nextStatus;const at=new Date();const event={id:`S${at.getTime()}-${Math.random().toString(36).slice(2,7)}`,from:initial?'':previous,to:nextStatus,type:after,initial:Boolean(initial),date:localDateKey(at),at:at.toISOString(),source:effectiveCustomerSource(customer),sourceId:customer.sourceId||window.ZhikeBusinessRules?.stableSourceId?.(effectiveCustomerSource(customer))||'',group:customer.group||'—'};customer.statusHistory=[...(Array.isArray(customer.statusHistory)?customer.statusHistory:[]),event];return nextStatus;}
  function customerHasStatusEvent(customer,date,type,source='全部'){return Array.isArray(customer.statusHistory)&&customer.statusHistory.some(event=>event&&!isStatusBaseline(event)&&event.date===date&&event.type===type&&(source==='全部'||effectiveStatusEventSource(customer,event)===source));}
  function todayStatusCounts(list){const totals={singleJoined:0,singleLeft:0,groupJoined:0,groupLeft:0};for(const customer of list){const counted=new Set();for(const event of Array.isArray(customer.statusHistory)?customer.statusHistory:[]){if(isStatusBaseline(event)||event?.date!==today)continue;const source=event.source||customer.source,key=`${source}:${event.type}`;if(counted.has(key))continue;counted.add(key);if(source==='单导'&&event.type==='joined')totals.singleJoined++;else if(source==='单导'&&event.type==='left')totals.singleLeft++;else if(isGroupFanSource(source)&&event.type==='joined')totals.groupJoined++;else if(isGroupFanSource(source)&&event.type==='left')totals.groupLeft++;}}return totals;}
  function currentSourceStatusCounts(list){return {singleJoined:list.filter(c=>!isGroupFanSource(c.source)&&['已进群','在群'].includes(c.status)).length,singleLeft:list.filter(c=>!isGroupFanSource(c.source)&&['已退群','临时退群'].includes(c.status)).length,groupJoined:list.filter(c=>isGroupFanSource(c.source)&&['已进群','在群'].includes(c.status)).length,groupLeft:list.filter(c=>isGroupFanSource(c.source)&&['已退群','临时退群'].includes(c.status)).length};}
  function statusSourceSummary(list){
    const order=[...new Set([...sources,...groupFanSources].map(value=>canonicalBusinessSource(value)).filter(Boolean))],rows=new Map();
    const ensure=source=>{const key=String(source||'未分类').trim()||'未分类';if(!rows.has(key))rows.set(key,{source:key,todayJoined:0,todayLeft:0,currentJoined:0,currentLeft:0});return rows.get(key);};
    for(const source of order)ensure(source);
    for(const customer of Array.isArray(list)?list:[]){
      if(!customer||typeof customer!=='object')continue;
      const source=effectiveCustomerSource(customer),row=ensure(source);
      if(['已进群','在群'].includes(customer.status))row.currentJoined++;
      if(['已退群','临时退群'].includes(customer.status))row.currentLeft++;
      const counted=new Set();
      for(const event of Array.isArray(customer.statusHistory)?customer.statusHistory:[]){
        if(isStatusBaseline(event)||event?.date!==today)continue;
        const eventSource=effectiveStatusEventSource(customer,event),key=`${eventSource}:${event.type}`;
        if(counted.has(key))continue;counted.add(key);
        const eventRow=ensure(eventSource);
        if(event.type==='joined')eventRow.todayJoined++;
        if(event.type==='left')eventRow.todayLeft++;
      }
    }
    return [...rows.values()];
  }
  function renderStatusSummary(list){
    const rows=statusSourceSummary(list),items=rows.flatMap(row=>[
      {label:`${row.source} · 今日进群`,value:row.todayJoined,source:row.source,scope:'today',type:'joined'},
      {label:`${row.source} · 今日退群`,value:row.todayLeft,source:row.source,scope:'today',type:'left'},
      {label:`${row.source} · 总进群（当前）`,value:row.currentJoined,source:row.source,scope:'current',type:'joined'},
      {label:`${row.source} · 总退群（当前）`,value:row.currentLeft,source:row.source,scope:'current',type:'left'},
    ]);
    return `<div class="home-status-grid">${items.map(item=>`<button data-action="go-segments" data-home-source="${esc(item.source)}" data-home-scope="${item.scope}" data-home-status="${item.type}"><span>${esc(item.label)}</span><strong>${item.value}</strong></button>`).join('')}</div><p class="rule-hint">按系统设置中的具体渠道分别统计；今日只统计实际状态变化；录入时的初始状态作为基线保留、不计入。旧资料不会补算当日变化。</p><div style="display:flex;justify-content:flex-end;padding:0 17px 8px"><button class="link-button" data-action="export-status-history">导出进退群明细</button></div>`;
  }
  let homeTaskFilter='all';
  let homeDetailExpanded=false;
  let homeWsAlertRequest=0;
  let homeWsAlertController=null;
  let homeWsAlertFlight=null;
  let homeWsAlertFlightHeading=null;
  let homeWsAlertTimer=null;
  function horizonCustomerName(customer, fallback=''){
    const stored=String(customer?.name||'').trim();
    if(stored&&stored!=='未命名客户')return stored;
    return String(customer?.rawPhone||customer?.phone||fallback||'').trim()||'未命名客户';
  }
  function horizonAlertItems(alerts,customerIndex,taskIndex){
    return alerts.map(item=>{
      const customer=customerIndex.get(String(item.customerId||'')),task=taskIndex.get(String(item.taskId||''));
      const phone=String(customer?.rawPhone||customer?.phone||task?.phone||item.phone||item.externalId||'').trim();
      const reason=String(item.scoreReason||[item.qualificationReason,item.engagementReason].filter(Boolean).join('；')||item.reason||'AI 已完成当前聊天分析').trim();
      return {customerId:String(item.customerId||''),taskId:String(item.taskId||''),name:horizonCustomerName(customer,task?.customerName||item.title||phone),grade:Number(item.priorityScore||0)>=85?'极高':Number(item.priorityScore||0)>=70?'高':Number(item.priorityScore||0)>=50?'中':'观察',stage:String(customer?.phase||item.customerStage||'AI 待跟进'),priority:Number(item.priorityScore||0),qualificationScore:Number(item.qualificationScore||0),engagementScore:Number(item.engagementScore||0),reason,objective:String(item.objective||item.nextStep||item.summary||'查看任务并确认跟进方式'),followupTime:String(item.followupTime||'待安排'),opener:String(item.opener||''),source:'ai'};
    }).filter(item=>item.customerId||item.name!=='未命名客户').slice(0,5);
  }
  function horizonNodeHtml(item,index){
    const meta=`综合 ${Math.max(0,Math.round(item.priority))}/100 · ${item.followupTime}`;
    return `<button class="horizon-flow-node" data-action="go-operations" data-task-id="${esc(item.taskId||'')}" data-flow-index="${index}">${customerAvatarHtml(item,'list')}<span class="horizon-node-copy"><strong>${esc(item.name)}</strong><span>${esc(meta)}</span></span><em class="horizon-node-grade">${esc(item.grade||'待评估')}</em></button>`;
  }
  function horizonProcessHtml(note){
    const stages=[['filter','线索识别','捕捉新增机会'],['users','意向评估','动态评估意向'],['spark','跟进建议','生成优先动作'],['calendar','任务安排','创建跟进计划'],['layers','进度追踪','持续更新状态']];
    return `<div class="horizon-process" aria-label="客户跟进流程">${stages.map(([icon,title,description])=>`<div class="horizon-process-step"><span class="horizon-process-icon">${icons(icon)}</span><strong>${title}</strong><small>${description}</small></div>`).join('')}</div><div class="horizon-flow-empty"><span>${esc(note)}</span></div>`;
  }
  function horizonSpotlightHtml(item){
    if(!item)return `<div class="horizon-spotlight-empty"><div class="horizon-spotlight-empty-head">${icons('users')}<strong>客户行动洞察</strong></div><p>暂无优先跟进客户。完成聊天分析后，这里会呈现有依据的行动建议。</p><div class="horizon-spotlight-capabilities"><span>${icons('chart')}<b>重点跟进</b><small>按真实聊天与客户动态排序</small></span><span>${icons('calendar')}<b>建议排期</b><small>结合意向与进度安排时间</small></span><span>${icons('message')}<b>沟通提醒</b><small>避免重复话题和机械问候</small></span><span>${icons('shield')}<b>风险关注</b><small>识别需进一步核实的信息</small></span></div><button class="btn primary" data-action="go-operations">查看任务中心</button></div>`;
    const scoreLine=`资金实力 ${Math.max(0,Math.round(item.qualificationScore||0))}/100 · 聊天粘度 ${Math.max(0,Math.round(item.engagementScore||0))}/100`;
    return `<div class="horizon-spotlight-head">${customerAvatarHtml(item,'detail')}<div><strong>${esc(item.name)}</strong><span>${esc(scoreLine)}</span></div><span class="horizon-spotlight-badge">${esc(item.grade||'待评估')}</span></div><div class="horizon-insight-list"><div class="horizon-insight"><span>为什么现在跟进</span><strong>${esc(item.reason||'等待 AI 生成证据说明')}</strong></div><div class="horizon-insight"><span>建议目标</span><strong>${esc(item.objective||'查看任务并确认下一步')}</strong></div>${item.opener?`<div class="horizon-insight"><span>建议开场</span><strong>${esc(item.opener)}</strong></div>`:''}<div class="horizon-insight"><span>建议联系时间</span><strong>${esc(item.followupTime||'待安排')}</strong></div></div><div class="horizon-spotlight-actions"><button class="btn primary" data-action="go-operations" data-task-id="${esc(item.taskId||'')}">处理跟进</button>${item.customerId?`<button class="btn" data-customer="${esc(item.customerId)}">查看档案</button>`:''}</div>`;
  }
  function updateHorizonFlow(items,sourceLabel){
    const nodes=$('#horizonFlowNodes'),spotlight=$('#horizonSpotlight'),label=$('#horizonFlowSourceLabel');
    if(!nodes||!spotlight)return;
    nodes.dataset.hasAlerts=items.length?'true':'false';
    nodes.innerHTML=items.length?items.map(horizonNodeHtml).join(''):horizonProcessHtml('当前没有可展示的优先客户。AI 完成有效聊天分析后会自动更新。');
    spotlight.innerHTML=horizonSpotlightHtml(items[0]);
    if(label)label.textContent=sourceLabel;
  }
  function renderHorizonHero(items,kpis){
    const kpiIcons=['users','calendar','chart','spark','check','layers'];
    return `<section class="horizon-workbench-hero" id="horizonWorkbenchHero"><div class="horizon-kpis" aria-label="业务关键指标">${kpis.map((item,index)=>`<div class="horizon-kpi"><span class="horizon-kpi-icon" aria-hidden="true">${icons(kpiIcons[index])}</span><div class="horizon-kpi-copy"><span class="horizon-kpi-heading">${esc(item.label)}</span><strong>${typeof item.value==='number'?item.value.toLocaleString():esc(item.value)}</strong><small>${esc(item.foot||'本机业务数据')}</small></div></div>`).join('')}</div><div class="horizon-flow-stage"><div class="horizon-hero-heading"><div><span class="horizon-eyebrow">智能客户运营</span><h2>AI 跟进流域</h2><span class="horizon-flow-description">基于客户动态与业务进展，智能生成跟进优先级与下一步动作</span></div><span class="horizon-flow-source" id="horizonFlowSourceLabel">正在读取 AI 跟进提醒</span></div><div class="horizon-flow-nodes" id="horizonFlowNodes" data-has-alerts="${items.length?'true':'false'}">${items.length?items.map(horizonNodeHtml).join(''):horizonProcessHtml('正在读取最新聊天分析；不会使用本地排序冒充 AI 结论。')}</div><div class="horizon-weight-legend"><span><i></i>资金实力 <b>55%</b></span><span><i></i>聊天粘度 <b>45%</b></span><small>投资经验仅补充档案，不计入提醒权重</small></div></div><aside class="horizon-spotlight" id="horizonSpotlight">${horizonSpotlightHtml(items[0])}</aside></section>`;
  }
  function ensureHomeWsFollowupPanel(heading){
    const existing=$('#homeWsFollowups');
    if(existing)return existing;
    const anchor=$('#homeDashboardGrid')||$('#horizonWorkbenchHero')||heading;
    if(!anchor)return null;
    anchor.insertAdjacentHTML('afterend','<section id="homeWsFollowups" class="panel home-ai-followups" aria-busy="true"><div class="panel-heading"><h2 class="panel-title">AI 客户跟进雷达</h2></div><div class="empty-state">正在读取最新 AI 跟进提醒…</div></section>');
    return $('#homeWsFollowups');
  }
  function loadHomeWsFollowups(){
    if(state.view!=='home')return Promise.resolve({skipped:true});
    const heading=$('#viewContainer .page-heading');
    if(!heading)return Promise.resolve({skipped:true});
    if(homeWsAlertFlight&&homeWsAlertFlightHeading===heading)return homeWsAlertFlight;
    homeWsAlertController?.abort?.();
    const controller=new AbortController();
    homeWsAlertController=controller;
    const request=++homeWsAlertRequest;
    const mountedPanel=ensureHomeWsFollowupPanel(heading);
    if(!mountedPanel)return Promise.resolve({skipped:true});
    const bridge=window.__zhikeWsFollowups;
    const pending=Promise.resolve().then(async()=>{
      if(bridge?.load)return bridge.load(5);
      const response=await fetch('/api/ws/followup-alerts?allAccounts=1&limit=5',{cache:'no-store',signal:controller.signal});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||result.message||`提醒读取失败（${response.status}）`);
      return Array.isArray(result.alerts)?result.alerts:[];
    });
    const flight=pending.then(value=>{
      if(request!==homeWsAlertRequest||state.view!=='home'||$('#viewContainer .page-heading')!==heading||$('#homeWsFollowups')!==mountedPanel)return {stale:true};
      const alerts=Array.isArray(value)?value:[];
      const customerIndex=new Map((state.customers||[]).filter(customer=>!customer.deleted).map(customer=>[String(customer.id),customer]));
      const taskIndex=new Map((state.settings?.operatingTasks||[]).map(task=>[String(task.id),task]));
      const horizonItems=horizonAlertItems(alerts,customerIndex,taskIndex);
      updateHorizonFlow(horizonItems,alerts.length?'AI 已更新 · 资金 55% / 粘度 45%':'当前无 AI 跟进提醒');
      const cards=alerts.map(item=>{
        const customer=customerIndex.get(String(item.customerId||'')),task=taskIndex.get(String(item.taskId||''));
        const storedName=String(customer?.name||task?.customerName||item.title||'').trim(),phone=String(customer?.rawPhone||customer?.phone||task?.phone||item.phone||'').trim();
        const customerName=storedName&&storedName!=='未命名客户'?storedName:(phone||String(item.externalId||'').trim()||'未命名客户');
        const scoreReason=String(item.scoreReason||[item.qualificationReason,item.engagementReason].filter(Boolean).join('；')||'暂无明确评分依据').trim();
        return `<button class="home-ai-followup" data-action="go-operations" data-task-id="${esc(item.taskId||'')}"><div class="home-ai-followup-identity"><b>${esc(customerName)}</b>${phone&&phone!==customerName?`<small class="home-ai-followup-contact">${esc(phone)}</small>`:''}<small class="home-ai-followup-meta">${esc(item.reason||'AI 建议跟进')} · ${esc(item.followupTime||'待安排')} · 综合 ${Number(item.priorityScore||0)}/100 · 资金 ${Number(item.qualificationScore||0)} · 粘度 ${Number(item.engagementScore||0)}</small></div><strong class="home-ai-followup-objective">${esc(item.objective||item.nextStep||item.summary||'查看任务并确认跟进方式')}</strong><small class="home-ai-followup-score">评分依据：${esc(scoreReason)}</small>${item.opener?`<small class="home-ai-followup-opener">建议开场：${esc(item.opener)}</small>`:''}<em>处理这条任务 →</em></button>`;
      }).join('');
      mountedPanel.removeAttribute('aria-busy');
      mountedPanel.innerHTML=`<div class="panel-heading"><h2 class="panel-title">${icons('spark')} AI 客户跟进雷达</h2><button class="link-button" data-action="go-operations">进入任务中心 →</button></div>${cards?`<div class="home-ai-followup-list">${cards}</div>`:'<div class="empty-state">当前没有由最新有效聊天分析触发的待跟进提醒。</div>'}`;
      return {alerts:alerts.length};
    }).catch(error=>{
      if(controller.signal.aborted||error?.name==='AbortError')return {stale:true};
      if(request!==homeWsAlertRequest||state.view!=='home'||$('#viewContainer .page-heading')!==heading||$('#homeWsFollowups')!==mountedPanel)return {stale:true};
      mountedPanel.removeAttribute('aria-busy');
      updateHorizonFlow([],'AI 提醒暂不可用 · 可重试');
      mountedPanel.innerHTML=`<div class="panel-heading"><h2 class="panel-title">AI 客户跟进雷达</h2><button class="btn small" data-action="retry-home-ai">重试</button></div><p class="ws-error-line">提醒暂时读取失败：${esc(error?.message||'本机服务暂不可用')}</p>`;
      return {error:true};
    }).finally(()=>{
      if(homeWsAlertFlight===flight){homeWsAlertFlight=null;homeWsAlertFlightHeading=null;}
      if(homeWsAlertController===controller)homeWsAlertController=null;
    });
    homeWsAlertFlightHeading=heading;
    homeWsAlertFlight=flight;
    return flight;
  }
  function scheduleHomeWsFollowups({immediate=false}={}){
    clearTimeout(homeWsAlertTimer);
    if(immediate)return loadHomeWsFollowups();
    return new Promise(resolve=>{homeWsAlertTimer=setTimeout(()=>{homeWsAlertTimer=null;resolve(loadHomeWsFollowups());},140);});
  }
  let homeMetricsCache=null,metricsProjectionCache=null;
  function buildHomeTrendSeries(customers,asOfDay=today){
    const base=new Date(`${asOfDay}T12:00:00`);
    const days=Array.from({length:7},(_,i)=>{const date=localDateOffset(i-6,base);return {date,label:date.slice(5),customers:0,followups:0};});
    const byDate=new Map(days.map(day=>[day.date,day]));
    for(const customer of customers){const day=byDate.get(String(customer.registered||'').slice(0,10));if(day)day.customers++;}
    for(const event of state.followups){const day=byDate.get(String(event.date||'').slice(0,10));if(day)day.followups++;}
    return days;
  }
  function prepareHomeMetrics(){
    const asOfDay=today,key=[state.dataRevision||0,localDataRevision,stateVersion,asOfDay,homeTaskFilter].join(':');
    if(homeMetricsCache?.key===key&&homeMetricsCache.customers===state.customers&&homeMetricsCache.registrations===state.registrations&&homeMetricsCache.deposits===state.deposits&&homeMetricsCache.followups===state.followups)return homeMetricsCache.value;
    const n=counts(),list=activeCustomers(),ids=new Set(list.map(c=>String(c.id))),daily=todayStatusCounts(list),business=businessSummaryIndex();
    const date=new Date(`${asOfDay}T12:00:00`),monday=localDateOffset(-((date.getDay()+6)%7),date),inWeek=row=>String(row.date||row.createdAt||'').slice(0,10)>=monday&&String(row.date||row.createdAt||'').slice(0,10)<=asOfDay;
    const registrations=state.registrations.filter(r=>r.status==='已报名'&&ids.has(String(r.customerId))),registeredIds=new Set(registrations.map(r=>String(r.customerId)));
    const weekRegistrations=new Set(registrations.filter(inWeek).map(r=>String(r.customerId))).size;
    const weekAmount=state.deposits.filter(r=>ids.has(String(r.customerId))&&inWeek(r)).reduce((sum,r)=>sum+(Number(r.amount)||0),0);
    const allDue=list.filter(c=>isValidDateKey(c.due)&&c.due<=asOfDay),overdue=allDue.filter(c=>c.due<asOfDay),planned=allDue.filter(c=>c.due===asOfDay);
    const selectedRows=homeTaskFilter==='overdue'?overdue:homeTaskFilter==='today'?planned:allDue;
    const priorityByCustomer=new Map(selectedRows.map(customer=>[customer,smartPriority(customer,business)]));
    const rows=selectedRows.sort((a,b)=>priorityByCustomer.get(b)-priorityByCustomer.get(a)||String(a.due).localeCompare(String(b.due))).slice(0,5);
    const customerById=new Map(list.map(c=>[String(c.id),c]));
    const uncontacted=registrations.filter(r=>{const c=customerById.get(String(r.customerId));return c&&(!c.lastFollow||c.lastFollow<String(r.date).slice(0,10));}),pendingRegistered=new Set(uncontacted.map(r=>String(r.customerId))).size;
    const high=list.filter(c=>['S','A'].includes(crmProfile(c,business).grade)&&(!isValidDateKey(c.due)||c.due<asOfDay)).length;
    const profileGaps=list.filter(c=>!String(c.name||'').trim()||c.name==='未命名客户'||!String(c.country||c.region||'').trim()||!String(c.occupation||c.job||'').trim()).length;
    const max=Math.max(1,n.total),funnel=[['客户总数',n.total],['已进群',n.joined],['热聊客户',n.hot],['已报名',registeredIds.size],['入金客户',n.deposit]];
    const horizonKpis=[{label:'今日进群',value:daily.singleJoined+daily.groupJoined},{label:'本周报名',value:weekRegistrations},{label:'本周入金',value:money(weekAmount)},{label:'今日待跟进',value:n.due+n.overdue},{label:'高价值待安排',value:high},{label:'档案待补齐',value:profileGaps}];
    const sevenDayActivity=buildHomeTrendSeries(list,asOfDay);
    const value={asOfDay,n,list,daily,business,monday,registeredIds,weekRegistrations,weekAmount,allDue,overdue,planned,rows,pendingRegistered,high,profileGaps,max,funnel,horizonKpis,sevenDayActivity};
    homeMetricsCache={key,customers:state.customers,registrations:state.registrations,deposits:state.deposits,followups:state.followups,value};
    return value;
  }
  function freezeMetricsDto(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const item of Object.values(value))freezeMetricsDto(item);Object.freeze(value);}return value;}
  function getMetricsProjection(options={}){
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>key!=='scope')||(options.scope!==undefined&&options.scope!=='global-crm'))throw new Error('Unsupported metrics scope: only global-crm state is available');
    const prepared=prepareHomeMetrics(),key=[homeMetricsCache.key,metricsReadState.revision,Boolean(pendingStateData),queuedWriteCount,Boolean(writeConflict)].join(':');
    if(metricsProjectionCache?.key===key&&metricsProjectionCache.prepared===prepared)return metricsProjectionCache.value;
    const {asOfDay,n,daily,monday,weekRegistrations,weekAmount,pendingRegistered,high,profileGaps}=prepared;
    const sourceState={status:metricsReadState.status,hasLastGood:metricsReadState.hasLastGood,lastLoadedAt:metricsReadState.lastLoadedAt,lastCheckedAt:metricsReadState.lastCheckedAt,refreshing:metricsReadState.pending.size>0,errorCode:metricsReadState.errorCode,pendingLocalWrite:Boolean(pendingStateData)||queuedWriteCount>0,writeConflict:Boolean(writeConflict)};
    const visible=sourceState.status==='loaded',metric=(value,label,unit,basis)=>{
      const available=visible&&Number.isFinite(value),safeBasis={scope:'global-crm',...basis};
      if(Object.hasOwn(basis,'denominator')){safeBasis.numerator=available?value:null;safeBasis.ratioDefined=available&&Boolean(basis.ratioDefined);}
      if(!visible){for(const field of ['numerator','denominator'])if(Object.hasOwn(safeBasis,field))safeBasis[field]=null;if(Object.hasOwn(safeBasis,'ratioDefined'))safeBasis.ratioDefined=false;}
      return {label,unit,status:!visible?sourceState.status:!Number.isFinite(value)?'invalid':value===0?'empty':'available',value:available?value:null,basis:safeBasis};
    };
    const active={owner:'counts / buildCounts / activeCustomers',periodKind:'current-snapshot',statusRule:'未删除客户；沿用现有标记与业务记录优先规则',dedupeRule:'既有有效客户主档行，不新增去重'},coverage={...active,denominator:visible?n.total:null,ratioDefined:visible&&n.total>0};
    const dailyBasis={owner:'todayStatusCounts',dateField:'statusHistory.date',periodKind:'local-day',from:asOfDay,to:asOfDay,statusRule:'非初始事件；保留单导/群粉既有来源分类',dedupeRule:'每客户按来源+进退类型去重'};
    const dueBasis={owner:'counts / buildCounts',dateField:'due',periodKind:'local-day',from:asOfDay,to:asOfDay,statusRule:'有效YYYY-MM-DD；今日与逾期分别计算',dedupeRule:'有效客户主档行'};
    const metrics={
      'customers.total':metric(n.total,'客户总数','客户',active),
      'customers.joined':metric(n.joined,'已进群客户','客户',{...coverage,statusRule:'状态为已进群或在群'}),
      'customers.hot':metric(n.hot,'热聊客户','客户',{...coverage,statusRule:'现有hot标记'}),
      'customers.vip':metric(n.vip,'VIP客户','客户',{...coverage,statusRule:'按客户主档中的 VIP 编号统计'}),
      'customers.ticket':metric(n.ticket,'跟票客户','客户',{...coverage,owner:'customerBusinessSummary / buildBusinessSummaryIndex',statusRule:'已有跟票记录优先；待确认不计入；无记录沿用旧客户标记'}),
      'customers.deposit':metric(n.deposit,'入金客户','客户',{...coverage,owner:'customerBusinessSummary / buildBusinessSummaryIndex',statusRule:'已有入金记录优先；待确认不计入；无记录沿用旧客户标记'}),
      'home.joinedToday':metric(daily.singleJoined+daily.groupJoined,'今日进群','客户事件',dailyBasis),
      'home.leftToday':metric(daily.singleLeft+daily.groupLeft,'今日退群','客户事件',dailyBasis),
      'home.weekRegistrations':metric(weekRegistrations,'本周报名','客户',{owner:'prepareHomeMetrics（原renderHome）',dateField:'date || createdAt（前10位）',periodKind:'calendar-week-to-date',from:monday,to:asOfDay,statusRule:'已报名；仅有效客户关联',dedupeRule:'按customerId去重'}),
      'home.weekDeposit':metric(weekAmount,'本周入金','CNY',{owner:'prepareHomeMetrics（原renderHome）',dateField:'date || createdAt（前10位）',periodKind:'calendar-week-to-date',from:monday,to:asOfDay,statusRule:'仅有效客户ID关联；沿用原首页，不额外排除待确认',dedupeRule:'按入金记录累加，非客户去重'}),
      'home.dueToday':metric(n.due,'今日计划跟进','客户',dueBasis),
      'home.overdue':metric(n.overdue,'逾期待跟进','客户',{...dueBasis,periodKind:'before-local-day',from:null,statusRule:'有效due早于今日'}),
      'home.profileGaps':metric(profileGaps,'档案待补齐','客户',{owner:'prepareHomeMetrics（原renderHome）',periodKind:'current-snapshot',statusRule:'姓名为空/未命名，或country/region为空，或occupation/job为空',dedupeRule:'有效客户主档行'}),
      'home.highUnplanned':metric(high,'高价值待安排','客户',{owner:'crmProfile / smartPriority（本地规则，非AI评分）',periodKind:'current-snapshot',statusRule:'现有CRM评级S/A且due无效或逾期',dedupeRule:'有效客户主档行'}),
      'home.pendingRegistered':metric(pendingRegistered,'报名后未跟进','客户',{owner:'prepareHomeMetrics（原renderHome）',dateField:'registration.date 与 customer.lastFollow',periodKind:'all-registrations',statusRule:'已报名且无lastFollow或早于报名日期',dedupeRule:'按有效customerId去重'}),
    };
    const trendStatus=visible?(prepared.sevenDayActivity.some(day=>day.customers||day.followups)?'available':'empty'):sourceState.status;
    const value={schemaVersion:1,source:'main-state-projection',scope:{kind:'global-crm',label:'全局客户主档与既有业务记录'},sourceState,version:{stateVersion,localDataRevision,dataRevision:state.dataRevision||0},calculatedAt:new Date().toISOString(),metrics,
      series:{sevenDayActivity:visible?prepared.sevenDayActivity.map(day=>({...day})):[]},seriesStatus:{sevenDayActivity:trendStatus},seriesBasis:{sevenDayActivity:{owner:'buildHomeTrendSeries（原renderTrendChart）',periodKind:'rolling-7-local-days',from:prepared.sevenDayActivity[0].date,to:prepared.sevenDayActivity[6].date,customers:{unit:'客户',dateField:'registered（前10位）',scope:'未删除客户主档行'},followups:{unit:'记录',dateField:'date（前10位）',scope:'现有全部followups记录，不新增客户关联过滤'},notes:['新增客户按登记日期；跟进按记录日期，二者不是转化漏斗。','本周指标为周一至今日，与近7日趋势窗口不同。']}},
      notes:['首页今日待跟进=今日计划+逾期；不改变现有业务口径。','客户状态覆盖度可重叠，不能解释为逐级转化率。','值来自本机已读取业务状态，不代表实时WhatsApp同步或AI质量结论。']};
    metricsProjectionCache={key,prepared,value:freezeMetricsDto(value)};return metricsProjectionCache.value;
  }
  function homeMetricDisplay(value,projection){if(typeof value==='number'&&!Number.isFinite(value))return '—';return projection.sourceState.status==='loaded'?value:'—';}
  function renderHome() {
    const {n,list,daily,business,monday,registeredIds,weekRegistrations,weekAmount,allDue,overdue,planned,rows,pendingRegistered,high,profileGaps,max,funnel}=prepareHomeMetrics();
    const projection=getMetricsProjection(),display=value=>homeMetricDisplay(value,projection),saveFoot=projection.sourceState.writeConflict?'存在保存冲突':projection.sourceState.pendingLocalWrite?'保存中':'',readFoot=(projection.sourceState.status==='loaded'?'本机业务数据':projection.sourceState.status==='error'?'读取失败 · 指标暂不可用':'加载中 · 数据未确认')+(saveFoot?' · '+saveFoot:'');
    const horizonKpis=prepareHomeMetrics().horizonKpis.map(item=>({...item,value:display(item.label==='本周入金'&&!Number.isFinite(weekAmount)?'—':item.value),foot:(projection.sourceState.status==='loaded'?'':readFoot+' · ')+(item.label==='本周入金'?'周一至今日 · 含待确认':item.label==='本周报名'?'周一至今日':item.label==='今日待跟进'?'包含逾期客户':item.label==='高价值待安排'?'本地CRM规则':item.label==='档案待补齐'?'姓名、地区或职业有缺口':'按客户进群事件')}));
    const readAt=projection.sourceState.lastLoadedAt,readTime=readAt?`<time datetime="${esc(readAt)}">${esc(new Date(readAt).toLocaleString('zh-CN',{hour12:false}))}</time>`:'尚无成功读取';
    const readContext=`范围：${esc(projection.scope.label)} · ${esc(readFoot)} · 本机业务读取时间：${readTime}`;
    const readReady=projection.sourceState.status==='loaded';
    const readNotice=readReady?'':`<p class="muted-cell home-reading-context" role="status">${readContext}。${projection.sourceState.hasLastGood?'业务列表保留；指标不将本地待保存变更冒充已确认读取。':'尚未确认的数值显示为—，不等同于零。'}可通过顶部同步状态重试。</p>`;
    const tasks=rows.map(c=>'<tr data-customer="'+esc(c.id)+'"><td><div class="task-person"><div class="mini-avatar">'+esc((c.name||'客')[0])+'</div><strong>'+esc(c.name||'未命名客户')+'</strong></div></td><td>'+esc(c.rawPhone||c.phone||'—')+'</td><td><span class="status-tag tag-blue">'+esc(c.qualification||'未评级')+'</span></td><td>'+esc(c.source||'—')+'</td><td>'+esc(c.assistant||'未分配')+'</td><td><span class="'+(c.due<today?'home-overdue':'')+'">'+esc(c.due===today?'今天':c.due)+'</span></td><td><button class="table-action" data-action="follow" data-id="'+esc(c.id)+'">跟进 →</button></td></tr>').join('');
    const dashboard='<div class="home-dashboard-grid home-dashboard-primary" id="homeDashboardGrid" aria-label="业务趋势与客户计划概况">'+
      '<section class="panel compact-panel home-activity-panel '+(!state.activities.length?'is-empty':'')+'" data-activity-state="'+(projection.sourceState.status==='loaded'?(state.activities.length?'available':'empty'):projection.sourceState.status)+'"><div class="panel-heading"><h2 class="panel-title">'+icons('clock')+' 最近业务动态</h2><button class="link-button" data-action="go-activity">全部动态 →</button></div><div class="activity-list">'+((projection.sourceState.hasLastGood?state.activities:[]).slice(0,6).map(a=>'<div class="activity-item"><i class="activity-dot"></i><div class="activity-text">'+esc(a.text)+'</div><time class="activity-time">'+esc(a.time)+'</time></div>').join('')||'<div class="empty-state">'+(projection.sourceState.hasLastGood?'暂无业务动态，新增或跟进后显示。':'正在读取动态；读取失败时可通过顶部同步状态重试。')+'</div>')+'</div></section>'+
      '<section class="panel compact-panel home-trend-panel"><div class="panel-heading"><h2 class="panel-title">'+icons('chart')+' 近7日趋势</h2></div><div class="chart-wrap">'+renderTrendChart(list)+'</div></section>'+
      '<section class="panel compact-panel home-health-panel"><div class="panel-heading"><h2 class="panel-title">'+icons('spark')+' 客户计划概况</h2></div><div class="home-health-list">'+
      '<button class="home-health-row" data-action="go-followups"><span>待跟进客户</span><strong>'+display(allDue.length)+'</strong><small>逾期 '+display(overdue.length)+'</small></button>'+
      '<button class="home-health-row" data-action="go-quality"><span>档案待补齐</span><strong>'+display(profileGaps)+'</strong><small>有效客户 '+display(n.total)+'</small></button>'+
      '<button class="home-health-row" data-action="go-groups"><span>今日进退群</span><strong>'+display(daily.singleJoined+daily.groupJoined)+' / '+display(daily.singleLeft+daily.groupLeft)+'</strong><small>进群 / 退群</small></button>'+
      '<button class="home-health-row" data-action="go-registrations"><span>报名后未跟进</span><strong>'+display(pendingRegistered)+'</strong><small>已报名 '+display(registeredIds.size)+'</small></button>'+
      '</div></section></div>';
    const heroTotal=projection.sourceState.status==='loaded'?(Number(n.total)||0).toLocaleString('en-US'):'—';
    const heroStorage=readReady?'本机存储正常':projection.sourceState.status==='error'?'读取失败':'读取中';
    const horizonGlobe='<svg class="digital-horizon-art" viewBox="0 0 460 200" preserveAspectRatio="xMaxYMid slice" aria-hidden="true" focusable="false"><defs><radialGradient id="dhGlobeCore" cx="42%" cy="36%" r="64%"><stop offset="0" stop-color="#9dddff" stop-opacity=".55"/><stop offset=".55" stop-color="#3f7fd6" stop-opacity=".2"/><stop offset="1" stop-color="#152a5e" stop-opacity="0"/></radialGradient><linearGradient id="dhGlobeRim" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d6f1ff" stop-opacity=".95"/><stop offset=".55" stop-color="#63aef5" stop-opacity=".55"/><stop offset="1" stop-color="#a58bff" stop-opacity=".32"/></linearGradient><pattern id="dhGlobeDots" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="1.4" cy="1.4" r="1" fill="#a7ddff" fill-opacity=".55"/></pattern><radialGradient id="dhGlobeFade" cx="50%" cy="50%" r="50%"><stop offset=".6" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><mask id="dhGlobeMask"><circle cx="352" cy="102" r="74" fill="url(#dhGlobeFade)"/></mask></defs><circle cx="352" cy="102" r="116" fill="url(#dhGlobeCore)"/><g fill="none" stroke="url(#dhGlobeRim)"><ellipse cx="352" cy="102" rx="116" ry="34" stroke-opacity=".34"/><ellipse cx="352" cy="102" rx="104" ry="62" stroke-opacity=".18" transform="rotate(-18 352 102)"/><circle cx="352" cy="102" r="74" stroke-width="1.3"/><ellipse cx="352" cy="102" rx="30" ry="74" stroke-opacity=".55"/><ellipse cx="352" cy="102" rx="58" ry="74" stroke-opacity=".38"/><path d="M278 102h148" stroke-opacity=".5"/><path d="M284 72q68-18 136 0" stroke-opacity=".38"/><path d="M284 132q68 18 136 0" stroke-opacity=".38"/></g><g mask="url(#dhGlobeMask)"><circle cx="352" cy="102" r="74" fill="url(#dhGlobeDots)" opacity=".95"/></g><g fill="#c6ecff"><circle cx="296" cy="66" r="2.6"/><circle cx="400" cy="86" r="2.2"/><circle cx="330" cy="146" r="1.9"/><circle cx="420" cy="130" r="1.7"/></g><g fill="none" stroke="#a7ddff" stroke-opacity=".32" stroke-width=".9"><path d="M296 66 352 38 400 86"/><path d="M330 146 352 102 400 86"/></g></svg>';
    const horizonBanner='<section class="digital-horizon" aria-label="数字地平线 · 今日工作台"><span class="digital-horizon-scan" aria-hidden="true"></span><div class="digital-horizon-copy"><span class="digital-horizon-brand">HORIZON ATELIER PRO · 数字地平线</span>'+heading('今日工作台','本地客户运营概览 · 今天优先处理最重要的事','')+'<div class="digital-horizon-context" aria-label="工作台实时状态"><span class="digital-horizon-chip"><span>当前日期</span><time datetime="'+esc(today)+'">'+esc(today)+'</time></span><span class="digital-horizon-chip"><span>今日待跟进</span><b>'+display(allDue.length)+'</b><span>位</span></span><span class="digital-horizon-chip"><span>客户总数</span><b>'+esc(heroTotal)+'</b><span>位</span></span><span class="digital-horizon-chip '+(readReady?'is-ok':projection.sourceState.status==='error'?'is-warn':'')+'"><span>本机数据库</span><b>SQLite</b><span>'+esc(heroStorage)+'</span></span></div>'+(readReady?'<p class="digital-horizon-reading" role="status">'+readContext+'</p>':'')+'</div>'+horizonGlobe+'</section>';
    $('#viewContainer').innerHTML=horizonBanner+readNotice+renderHorizonHero([],horizonKpis)+dashboard+
      '<details class="home-detail-sections"'+(homeDetailExpanded?' open':'')+'><summary>完整业务数据与操作</summary><div class="home-detail-content">'+
      '<div class="home-action-row">'+btn('导入客户','upload','go-data')+btn('新增客户','plus','new-customer','primary')+'</div>'+
      '<section class="crm-command-strip home-reference-command"><div class="crm-command-title"><strong>客户运营概览</strong></div>'+[['今日进群',daily.singleJoined+daily.groupJoined],['今日退群',daily.singleLeft+daily.groupLeft],['本周报名',weekRegistrations],['本周入金',(Number.isFinite(weekAmount)?money(weekAmount):'—')]].map(([label,value])=>'<div><span>'+label+'</span><strong>'+display(value)+'</strong></div>').join('')+'</section>'+
      '<div class="metric-grid">'+metric('客户总数',display(n.total),'users','','全局有效客户','go-customers')+metric('今日待跟进',display(n.due+n.overdue),'calendar','red','包含逾期客户','go-followups')+metric('热聊客户',display(n.hot),'message','blue','全局热聊标记','go-hot')+metric('已报名客户',display(registeredIds.size),'check','','按报名记录去重','go-registrations')+'</div>'+
      '<div class="home-main-grid"><section class="panel task-panel"><div class="panel-heading"><h2 class="panel-title">'+icons('calendar')+' 今日待跟进</h2><button class="link-button" data-action="go-followups">查看全部 →</button></div><div class="home-task-tabs">'+[['all','全部',allDue.length],['overdue','已逾期',overdue.length],['today','今日计划',planned.length]].map(([key,label,count])=>'<button class="'+(homeTaskFilter===key?'active':'')+'" data-home-task-filter="'+key+'">'+label+' <b>'+display(count)+'</b></button>').join('')+'</div><div class="home-task-scroll"><table class="task-table"><thead><tr><th>客户</th><th>联系方式</th><th>评级</th><th>渠道</th><th>负责人</th><th>下次跟进</th><th>操作</th></tr></thead><tbody>'+(tasks||'<tr><td colspan="7" class="muted-cell">'+(projection.sourceState.hasLastGood?'当前范围暂无待跟进客户':'数据尚未确认，请等待读取或通过顶部同步状态重试')+'</td></tr>')+'</tbody></table></div></section>'+
      '<section class="panel suggestion-panel"><div class="panel-heading"><h2 class="panel-title">'+icons('spark')+' 运营提醒</h2></div><div class="suggestion-list">'+
      suggestion('clock','red','逾期客户待跟进','共有 '+display(n.overdue)+' 位客户已逾期，建议及时跟进',display(n.overdue)+' 位 →','home-overdue')+
      suggestion('users','blue','已报名未跟进','共有 '+display(pendingRegistered)+' 位客户报名后尚未跟进',display(pendingRegistered)+' 位 →','home-unfollowed-registered')+
      suggestion('chart','','高价值客户待安排','共有 '+display(high)+' 位 S/A 客户尚需安排跟进',display(high)+' 位 →','home-high-value')+'</div></section></div>'+
      '<div class="home-bottom-grid"><section class="panel compact-panel"><div class="panel-heading"><h2 class="panel-title">'+icons('filter')+' 客户状态覆盖度</h2></div><div class="funnel-content">'+funnel.map(([label,value])=>'<div class="home-funnel-row"><span>'+label+'</span><div class="funnel-bar-wrap"><div class="funnel-bar" style="width:'+(projection.sourceState.status==='loaded'&&value?value/max*100:0)+'%"></div></div><strong>'+display(value)+'</strong><small>('+(projection.sourceState.status==='loaded'&&n.total?Math.round(value/max*100)+'%':'—')+')</small></div>').join('')+'<p class="muted-cell">各状态可重叠；百分比以有效客户主档总数为分母，不代表逐级转化率。</p></div></section>'+
      '</div>'+
      '<details class="panel home-status-details"><summary>进退群明细与统计口径</summary>'+(projection.sourceState.status==='loaded'?renderStatusSummary(list):'<p class="muted-cell">数据尚未确认；不显示进退群零值。</p>')+'</details></div></details>';
    $('#viewContainer .home-detail-sections')?.addEventListener('toggle',event=>{homeDetailExpanded=event.currentTarget.open;});
    document.querySelectorAll('[data-home-task-filter]').forEach(button=>button.addEventListener('click',()=>{homeTaskFilter=button.dataset.homeTaskFilter;homeDetailExpanded=true;render();}));
    loadHomeWsFollowups();
  }
  function renderTrendChart(customers){
    const projection=getMetricsProjection(),days=projection.series.sevenDayActivity,status=projection.seriesStatus.sevenDayActivity;
    if(window.ZhikeMetricsCharts?.renderTrend)return window.ZhikeMetricsCharts.renderTrend({id:'home-seven-day-activity',title:'近7日业务活动',points:days,status,notes:projection.seriesBasis.sevenDayActivity.notes,scopeLabel:projection.scope.label});
    if(status==='loading'||status==='error')return `<div class="horizon-trend-empty"><strong>${status==='error'?'读取失败':'正在读取业务数据'}</strong><span>尚未确认的数据不显示为零；可通过顶部同步状态重试。</span></div>`;
    if(days.every(day=>day.customers===0&&day.followups===0))return `<div class="horizon-trend-empty">${icons('chart')}<strong>暂无数据</strong><span>实际业务变化出现后，趋势将在这里呈现</span></div>`;
    const max=Math.max(1,...days.flatMap(day=>[day.customers,day.followups]));
    const points=key=>days.map((day,index)=>`${35+index*57.5} ${125-Math.round((day[key]/max)*94)}`);
    const first=points('customers'),second=points('followups');
    return `<svg class="trend-svg" viewBox="0 0 400 150" preserveAspectRatio="none"><path class="grid" d="M28 20H390M28 55H390M28 90H390M28 125H390"/><path class="area" d="M${first.join(' L')} L380 125 L35 125Z"/><path class="line1" d="M${first.join(' L')}"/><path class="line2" d="M${second.join(' L')}"/>${days.map((day,index)=>`<circle cx="${35+index*57.5}" cy="${125-Math.round((day.customers/max)*94)}" r="3"/><text x="${26+index*57.5}" y="143">${day.label}</text>`).join('')}</svg>`;
  }
  function suggestion(icon,tone,title,desc,label,action){return `<div class="suggestion"><div class="suggestion-icon ${tone}">${icons(icon)}</div><div class="suggestion-copy"><strong>${title}</strong><p>${desc}</p></div><button class="suggestion-cta" data-action="${action}">${label}</button></div>`;}

  function filteredCustomers(mode='segment') {
    // Filtering a 50k customer workspace must not re-score and re-sort all
    // rows on every page click. `customersByPriority` is invalidated by the
    // existing data revision and day rollover; filtering preserves that
    // stable order, which is equivalent to sorting the filtered subset.
    let list=customersByPriority(); const f=state.segment,business=businessSummaryIndex();
    if(mode==='customer'&&state.homeCustomerScope){
      const scope=state.homeCustomerScope;
      if(scope==='overdue')list=list.filter(c=>isValidDateKey(c.due)&&c.due<today);
      if(scope==='high-value')list=list.filter(c=>['S','A'].includes(crmProfile(c,business).grade)&&(!isValidDateKey(c.due)||c.due<today));
      if(scope==='registered-unfollowed'){const byId=new Map(list.map(c=>[String(c.id),c]));const pendingIds=new Set(state.registrations.filter(r=>{const c=byId.get(String(r.customerId));return r.status==='已报名'&&c&&(!c.lastFollow||c.lastFollow<String(r.date).slice(0,10));}).map(r=>String(r.customerId)));list=list.filter(c=>pendingIds.has(String(c.id)));}
    }
    if(mode==='segment'){
      if(f.eventFilter){const [eventDate,eventType]=f.eventFilter.split(':');list=list.filter(c=>customerHasStatusEvent(c,eventDate,eventType,f.source));}
      else if(f.source!=='全部') list=list.filter(c=>effectiveCustomerSource(c)===f.source);
      if(f.page!=='全部') list=list.filter(c=>c.page===f.page);
      if(f.assistant!=='全部') list=list.filter(c=>c.assistant===f.assistant);
      if(f.registered) list=list.filter(c=>c.registered===f.registered);
      if(f.status) list=list.filter(c=>f.status==='退群（含临时）'?['已退群','临时退群'].includes(c.status):f.status==='已进群（含在群）'?['已进群','在群'].includes(c.status):c.status===f.status);
      if(f.phase) list=list.filter(c=>c.phase===f.phase);
      if(f.hot) list=list.filter(c=>c.hot===(f.hot==='是'));
      if(f.vip) list=list.filter(c=>Boolean(String(c.vipNumber||'').trim())===(f.vip==='有'));
      if(f.ticket) list=list.filter(c=>customerBusinessSummary(c,business).ticket===(f.ticket==='有'));
      if(f.deposit) list=list.filter(c=>customerBusinessSummary(c,business).deposit===(f.deposit==='有'));
      if(f.follow==='逾期') list=list.filter(c=>isValidDateKey(c.due)&&c.due<today);
      if(f.follow==='今日') list=list.filter(c=>c.due===today);
      if(f.missingGroup) list=list.filter(c=>c.group==='—');
    } else {
      if(state.extraFilters.source) list=list.filter(c=>effectiveCustomerSource(c)===state.extraFilters.source);
      if(state.extraFilters.page) list=list.filter(c=>c.page===state.extraFilters.page);
      if(state.extraFilters.assistant) list=list.filter(c=>c.assistant===state.extraFilters.assistant);
      if(state.extraFilters.status) list=list.filter(c=>c.status===state.extraFilters.status);
      if(state.extraFilters.phase) list=list.filter(c=>c.phase===state.extraFilters.phase);
      if(state.extraFilters.qualification) list=list.filter(c=>(c.qualification||'待评估')===state.extraFilters.qualification);
      if(state.extraFilters.hot) list=list.filter(c=>String(c.hot)===state.extraFilters.hot);
      if(state.extraFilters.vip) list=list.filter(c=>String(Boolean(String(c.vipNumber||'').trim()))===state.extraFilters.vip);
      if(state.extraFilters.favorite) list=list.filter(c=>Boolean(c.favorite));
      if(state.extraFilters.registered) list=list.filter(c=>c.registered===state.extraFilters.registered);
    }
    const q=(mode==='segment'?state.search:state.customerSearch).trim().toLocaleLowerCase();
     if(q) list=window.ZhikeDesktopPerformance?.searchIndex ? window.ZhikeDesktopPerformance.searchIndex(list,q,['name','phone','rawPhone','group','vipNumber','note','channel','assistant']) : list.filter(c=>[c.name,c.phone,c.rawPhone,c.group,c.vipNumber,c.note,c.channel,c.assistant].join('\u0001').toLocaleLowerCase().includes(q));
     return list;
  }
  function renderSegmentTabs() {
    const f=state.segment,n=counts(),customers=activeCustomers(),sourceCount=new Map(),pageCount=new Map(),assistantCount=new Map();
    for(const customer of customers){const source=effectiveCustomerSource(customer);sourceCount.set(source,(sourceCount.get(source)||0)+1);assistantCount.set(customer.assistant,(assistantCount.get(customer.assistant)||0)+1);if(f.source&&f.source!=='全部'&&source===f.source)pageCount.set(customer.page,(pageCount.get(customer.page)||0)+1);}
    const sourceOptions=[...new Set([...sources,...groupFanSources,...customers.map(effectiveCustomerSource)].filter(Boolean))],sourceTabs=[['全部',customers.length],...sourceOptions.map(source=>[source,sourceCount.get(source)||0])];
    const sourceHtml=sourceTabs.map(([v,c])=>`<button class="segment-tab ${f.source===v?'active':''}" data-set="source" data-value="${esc(v)}">${esc(v)}<span class="count">${c}</span></button>`).join('');
    const pageOptions=['全部',...new Set([...pages,...customers.map(c=>c.page).filter(Boolean)])];
    const assistantOptions=['全部',...new Set(customers.map(c=>c.assistant))];
    const statusOptions=['未进群','已进群','在群','已进群（含在群）','已退群','临时退群','退群（含临时）','重粉'];
    const stageOptions=['新客户','潜在客户','意向客户','高意向','成交客户','暂停跟进'];
    return `<div class="classification-row"><span class="class-label">渠道</span><div class="pill-list">${sourceHtml}</div><span class="panel-note">${n.total.toLocaleString()} 条</span></div>
      ${f.source&&f.source!=='全部'?`<div class="classification-row"><span class="class-label">页面</span><div class="pill-list">${pageOptions.map(v=>`<button class="filter-pill ${f.page===v?'active':''}" data-set="page" data-value="${esc(v)}">${esc(v)}<span class="pill-count">${v==='全部'?sourceCount.get(f.source)||0:pageCount.get(v)||0}</span></button>`).join('')}</div></div>`:''}
      <div class="classification-row"><span class="class-label">跟进助理</span><div class="pill-list">${assistantOptions.map(v=>`<button class="filter-pill ${f.assistant===v?'active':''}" data-set="assistant" data-value="${esc(v)}">${esc(v)}<span class="pill-count">${v==='全部'?customers.length:assistantCount.get(v)||0}</span></button>`).join('')}</div></div>
      <div class="classification-row"><span class="class-label">业务分类</span><div class="pill-list">${['status','phase','hot','ticket','deposit','follow','vip'].map((dim,idx)=>{const labels=['进群状态','客户阶段','热聊','跟票','入金','跟进','VIP'];const values=[statusOptions,stageOptions,['是','否'],['有','无'],['有','无'],['逾期','今日'],['有','无']][idx];const selected=f[dim];return `<div class="class-actions"><select class="compact-select" data-filter-dim="${dim}"><option value="">${labels[idx]}：全部</option>${values.map(v=>`<option ${selected===v?'selected':''}>${v}</option>`).join('')}</select></div>`}).join('')}</div></div>`;
  }
  function renderSegmentSummary(list) {
    const business=businessSummaryIndex();const n={all:list.length,joined:list.filter(c=>['已进群','在群'].includes(c.status)).length,not:list.filter(c=>c.status==='未进群').length,left:list.filter(c=>['已退群','临时退群'].includes(c.status)).length,hot:list.filter(c=>c.hot).length,vip:list.filter(c=>String(c.vipNumber||'').trim()).length,ticket:list.filter(c=>customerBusinessSummary(c,business).ticket).length,deposit:list.filter(c=>customerBusinessSummary(c,business).deposit).length,follow:list.filter(c=>isValidDateKey(c.due)&&c.due<=today).length};
    const cards=[['当前结果',n.all,''],['已进群',n.joined,'status:joined'],['未进群',n.not,'status:not'],['已退群',n.left,'status:left'],['热聊',n.hot,'hot'],['VIP',n.vip,'vip'],['跟票',n.ticket,'ticket'],['入金',n.deposit,'deposit'],['待跟进',n.follow,'follow']];
    return `<div class="segment-summary">${cards.map(([label,value,key],i)=>`<button class="summary-tile ${state.segmentCard===key&&key?'active':''}" data-summary="${key}" ${key?'':'disabled'}><span>${label}</span><strong>${value}</strong><small>${i===0?'位':''}</small></button>`).join('')}</div>`;
  }
  function renderActiveChips(mode) {
    const f=mode==='segment'?state.segment:state.extraFilters; const labels={source:'渠道',page:'页面',assistant:'助理',status:'进群',phase:'阶段',qualification:'资质评级',hot:'热聊',favorite:'重点关注',vip:'VIP',ticket:'跟票',deposit:'入金',follow:'跟进',registered:'登记日期',eventFilter:'状态变更',missingGroup:'资料问题'};
    const chips=Object.entries(f).filter(([k,v])=>v&&!(mode==='segment'&&((k==='source'&&v==='全部')||(k==='page'&&v==='全部')||(k==='assistant'&&v==='全部'))));
    return chips.length?`<div class="active-filter-row"><span class="active-filter-label">当前条件</span>${chips.map(([k,v])=>`<span class="active-chip">${labels[k]||k}：${esc(k==='missingGroup'?'缺少群编号':k==='eventFilter'?`${v.split(':')[0]} ${v.endsWith(':joined')?'进群':'退群'}`:v)}<button data-clear-filter="${k}" aria-label="移除">${icons('x')}</button></span>`).join('')}<button class="link-button" data-action="clear-filters">清空条件</button></div>`:'';
  }
  function customerAvatarHtml(customer,size='table'){
    return window.ZhikeAvatar?.render?.({name:customer.name,size,vip:Boolean(String(customer.vipNumber||'').trim())})||'';
  }
  function customerName(customer){return String(customer.name??'').trim()||'未命名客户';}
  function customerRows(list,mode='segment') {
    const start=(state.page-1)*state.perPage,visible=list.slice(start,start+state.perPage);
    const columns=visibleCustomerColumns(mode);
    if(!visible.length){const scopeFiltered=mode==='customer'&&(Boolean(state.customerSearch.trim())||Object.values(state.extraFilters||{}).some(Boolean)||Boolean(state.homeCustomerScope));const actions=scopeFiltered?'<button class="btn small" data-action="clear-search">清空搜索与范围</button><button class="btn small" data-action="clear-extra">清除高级筛选</button>':'<button class="btn small primary" data-action="new-customer">新增客户</button><button class="btn small" data-action="go-data">导入或采集</button>';return `<tr><td colspan="${columns.size}" class="empty-cell"><div class="empty-state customer-empty-state" role="status"><strong>${scopeFiltered?'当前条件下没有匹配的客户':'还没有客户资料'}</strong><p>${scopeFiltered?'筛选与搜索只影响当前列表；导出、跟票和群组数据仍按全部记录保留。':'客户主档来自快速录入、CSV 导入或 WS 采集，同一号码只保留一条主档。'}</p><div class="empty-state-actions">${actions}</div></div></td></tr>`;}
    const businessIndex=businessSummaryIndex(),eventFilter=mode==='segment'?state.segment.eventFilter:'';
    const [eventDate,eventType]=eventFilter?eventFilter.split(':'):[];
    return visible.map(c=>{
      const business=customerBusinessSummary(c,businessIndex);
      const matchedEvent=eventFilter?(c.statusHistory||[]).filter(event=>!isStatusBaseline(event)&&event.date===eventDate&&event.type===eventType&&(event.source||c.source)===state.segment.source).sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')))[0]:null;
      const eventTime=matchedEvent?.at&&Number.isFinite(Date.parse(matchedEvent.at))?new Date(matchedEvent.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):'';
      const eventLabel=matchedEvent?`<small class="customer-status-change">${esc(matchedEvent.from||'未记录')} → ${esc(matchedEvent.to)}${eventTime?` · ${eventTime}`:''}</small>`:'';
      const id=esc(c.id),name=esc(customerName(c)),favorite=Boolean(c.favorite);
      const favoriteLabel=favorite?'取消重点关注':'标记为重点关注';
      const nameCell=`<div class="customer-name-cell">
        <button class="favorite-button ${favorite?'active':''}" data-action="toggle-favorite" data-id="${id}" title="${favoriteLabel}" aria-label="${favoriteLabel}" aria-pressed="${favorite}">★</button>
        <button type="button" class="customer-name-open" data-customer="${id}" aria-label="打开 ${name} 的完整档案">
          ${customerAvatarHtml(c)}
          <span class="customer-name-copy"><strong title="${name}">${name}</strong>${eventLabel}</span>
        </button>
      </div>`;
      const cells={
        select:`<input type="checkbox" data-select="${id}" ${state.selected.has(c.id)?'checked':''}>`,
        customer:nameCell,rawPhone:esc(c.rawPhone),phone:esc(c.phone),source:sourceTag(c.source),
        page:esc(c.page||'—'),channel:esc(c.channel),assistant:esc(c.assistant),
        status:statusTag(c.status||'未知'),phase:phaseTag(c.phase||'未记录'),
        hot:c.hot?'<span class="status-tag tag-coral">热聊</span>':'<span class="muted-cell">—</span>',
        vip:String(c.vipNumber||'').trim()?`<span class="status-tag tag-amber">VIP ${esc(c.vipNumber)}</span>`:'<span class="muted-cell">—</span>',
        group:esc(c.group),ticket:business.ticket?'<span class="status-tag tag-blue">有跟票</span>':'<span class="muted-cell">—</span>',
        deposit:business.deposit?`<span class="status-tag tag-green">${money(business.amount)}</span>`:'<span class="muted-cell">—</span>',
        registered:esc(c.registered||'—'),
        actions:`<button class="table-action" data-action="soft-delete" data-id="${id}">移入回收站</button>`,
      };
      return `<tr class="${state.selected.has(c.id)?'selected':''}" data-customer="${id}">${customerColumnDefs.map(([key])=>`<td data-column="${key}" ${columns.has(key)?'':'hidden'}${key==='select'?' class="check-cell"':''}${key==='rawPhone'||key==='phone'?' class="phone-cell"':''}>${cells[key]}</td>`).join('')}</tr>`;
    }).join('');
  }
  function sourceTag(source){const cls=!isGroupFanSource(source)?'tag-blue':'tag-gray';return `<span class="status-tag ${cls}">${esc(source||'未分类')}</span>`;}
  function statusTag(status){const cls={'已进群':'tag-green','在群':'tag-green','未进群':'tag-gray','已退群':'tag-amber','临时退群':'tag-amber','重粉':'tag-red'}[status]||'tag-gray';return `<span class="status-tag ${cls}">${esc(status)}</span>`;}
  function groupMembershipStatusTag(status){const cls={'在群':'tag-green','已退群':'tag-amber','被移除':'tag-red','未关联客户':'tag-gray','状态未知':'tag-gray'}[status]||'tag-gray';return `<span class="status-tag ${cls}">${esc(status||'状态未知')}</span>`;}
  function groupMembershipRows(customer){
    const rows=Array.isArray(customer?.groupMemberships)?customer.groupMemberships.filter(item=>item?.groupJid):[];
    if(!rows.length)return '<p class="customer-group-membership-empty">暂无 WS 群组关系记录，整体同步状态未知。</p>';
    return `<div class="customer-group-membership-list">${rows.slice(0,12).map(item=>{
      const account=String(item.accountId??'').trim(),name=esc(item.groupName||item.groupJid);
      const time=item.lastEventAt?esc(String(item.lastEventAt).slice(0,16).replace('T',' ')):'暂无时间';
      const status=account?groupMembershipStatusTag(item.status):'';
      const legacy=account?'':`<small class="customer-group-membership-legacy">关联待核实 · 历史状态：${esc(item.status||'未知')}</small>`;
      return `<div class="customer-group-membership-row">
        <div><strong title="${name}">${name}</strong><small>${esc(account||'账号未记录')} · ${time}</small>${legacy}</div>${status}
      </div>`;
    }).join('')}</div>`;
  }
  function phaseTag(phase){const cls={'高意向':'tag-red','意向客户':'tag-blue','成交客户':'tag-green','潜在客户':'tag-amber'}[phase]||'tag-gray';return `<span class="status-tag ${cls}">${esc(phase)}</span>`;}
  function paginationButtons(pageCount){const wanted=new Set([1,pageCount,state.page-2,state.page-1,state.page,state.page+1,state.page+2].filter(page=>page>=1&&page<=pageCount)),ordered=[...wanted].sort((a,b)=>a-b);let previous=0;return ordered.map(page=>{const gap=previous&&page-previous>1?'<span class="page-gap">…</span>':'';previous=page;return `${gap}<button class="page-btn ${page===state.page?'active':''}" data-page="${page}">${page}</button>`;}).join('');}
  function capacityWarning(count, label='客户'){
    const total=Math.max(0,Number(count)||0);
    if(total>=250000)return `${label}库已达到本机安全上限 250,000 条，请分批导出归档后再继续导入。`;
    if(total>=50000)return `${label}库已超过 50,000 条，已启用分页与后台分批处理；建议按渠道或日期筛选，避免一次性全选。`;
    if(total>=10000)return `${label}库已超过 10,000 条，当前使用大数据模式：搜索、筛选和导入会分批执行，不会静默截断。`;
    return '';
  }
  function tableBlock(list, mode='segment') {
    const pages=Math.max(1,Math.ceil(list.length/state.perPage)); if(state.page>pages)state.page=pages;
    const allSelected=state.selected.size>0&&list.length>0&&list.slice((state.page-1)*state.perPage,state.page*state.perPage).every(c=>state.selected.has(selectionKey(c.id)));
    const title=mode==='segment'?segmentTitle(): '客户列表';
    const selectedInScope=state.selected.size?list.reduce((total,customer)=>total+Number(state.selected.has(selectionKey(customer.id))),0):0,selectedOutsideScope=state.selected.size-selectedInScope,scopeId=`customer-list-scope-${mode}`;
    const activeAdvancedFilters=mode==='customer'?['source','page','assistant','status','phase','qualification','hot','vip','favorite','registered'].filter(key=>Boolean(state.extraFilters[key])).length:0;
    const activeConditions=activeAdvancedFilters+(mode==='customer'&&state.customerSearch.trim()?1:0)+(mode==='customer'&&['overdue','high-value','registered-unfollowed'].includes(state.homeCustomerScope)?1:0);
    const capacity=capacityWarning(Math.max(list.length,activeCustomers().length),mode==='segment'?'客户视图':'客户');
    return `<section class="panel table-panel">${capacity?`<div class="performance-notice capacity-warning" role="status"><strong>容量提示</strong><span>${esc(capacity)}</span></div>`:''}<div class="table-toolbar"><div class="table-context"><strong>${title}</strong><span>${list.length.toLocaleString()} 位客户</span>${state.selected.size?`<span class="status-tag tag-green">已选 ${state.selected.size}</span>`:''}</div><div class="toolbar-controls"><label class="input-search">${icons('search')}<input data-search="${mode}" aria-describedby="${esc(scopeId)}" value="${esc(mode==='segment'?state.search:state.customerSearch)}" placeholder="搜索姓名、号码、群编号"></label>${mode==='customer'?`<button class="btn small" data-action="toggle-filters" aria-controls="customerAdvancedFilters" aria-expanded="${String(Boolean(state.showFilters))}" aria-label="${state.showFilters?'收起':'展开'}高级筛选，当前 ${activeAdvancedFilters} 项">${icons('filter')}筛选${activeAdvancedFilters?`（${activeAdvancedFilters}）`:''}</button>`:''}<button class="btn small" data-action="export-filtered" aria-describedby="${esc(scopeId)}" title="导出当前筛选全部 ${list.length} 位客户，不限当前页">${icons('download')}导出筛选结果</button><button class="btn small" data-action="columns" data-mode="${mode}">列设置</button></div></div>
      ${mode==='customer'?(state.showFilters?renderCustomerFilters():'<div id="customerAdvancedFilters" hidden></div>'):''}
      ${renderActiveChips(mode)}
      <div class="customer-list-scope" id="${esc(scopeId)}" role="status"><span>${mode==='customer'?`生效条件 ${activeConditions} 项 · `:''}当前筛选 ${list.length.toLocaleString()} 位客户 · 导出筛选结果包含全部匹配页。</span>${state.selected.size?`<span>已选 ${state.selected.size} 位 · 筛选内 ${selectedInScope} 位，筛选外 ${selectedOutsideScope} 位；选择可跨页保留，导出所选按已选客户 ID。</span>`:'<span>表头复选框仅选择本页；筛选与导出不受隐藏列影响。</span>'}</div>
      <div class="table-scroll"><table class="data-table"><thead><tr>${customerColumnDefs.map(([key,label])=>`<th data-column="${key}" ${visibleCustomerColumns(mode).has(key)?'':'hidden'}${key==='select'?' class="check-cell"':''}>${key==='select'?`<input type="checkbox" data-select-page aria-label="选择本页客户" ${allSelected?'checked':''}>`:label}</th>`).join('')}</tr></thead><tbody>${customerRows(list,mode)}</tbody></table></div>
      ${state.selected.size?`<div class="batch-bar"><strong>已选择 ${state.selected.size} 条</strong><button class="btn small" data-action="batch-qualification">改评级</button><button class="btn small" data-action="batch-registration">报名状态</button><button class="btn small" data-action="batch-phase">客户阶段</button><button class="btn small" data-action="batch-assistant">分配助理</button><button class="btn small" data-action="batch-follow">批量排期</button><button class="btn small" data-action="batch-tag">添加标签</button><button class="btn small" data-action="export-selected">导出所选</button><button class="btn small danger-text" data-action="batch-delete-customers">批量删除（进回收站）</button><button class="btn small subtle" data-action="clear-selection">取消选择</button></div>`:state.lastBatchUndo?`<div class="batch-bar batch-undo-bar"><strong>上次批量操作：${esc(state.lastBatchUndo.label)} ${state.lastBatchUndo.rows.length} 位客户</strong><span>可撤销至操作前状态</span><button class="btn small" data-action="undo-batch">撤销上次操作</button><button class="btn small subtle" data-action="dismiss-batch-undo">不再提示</button></div>`:''}
      <div class="table-footer"><span>显示 ${list.length?((state.page-1)*state.perPage+1):0}–${Math.min(state.page*state.perPage,list.length)} 条，共 ${list.length.toLocaleString()} 条</span><div class="pagination"><button class="page-btn" data-page="${Math.max(1,state.page-1)}">‹</button>${paginationButtons(pages)}<button class="page-btn" data-page="${Math.min(pages,state.page+1)}">›</button><label class="page-jump">跳至 <input type="number" min="1" max="${pages}" value="${state.page}" data-page-jump></label><select class="compact-select page-size"><option ${state.perPage===10?'selected':''}>10</option><option ${state.perPage===20?'selected':''}>20</option><option ${state.perPage===50?'selected':''}>50</option><option ${state.perPage===100?'selected':''}>100</option></select></div></div></section>`;
  }
  function segmentTitle(){const f=state.segment,event=f.eventFilter?`${f.eventFilter.split(':')[0]} ${f.eventFilter.endsWith(':joined')?'进群变更':'退群变更'}`:'';return [f.source!=='全部'?f.source:'',f.page!=='全部'?f.page:'',f.assistant!=='全部'?f.assistant:'',event,f.status,f.phase,f.hot?`热聊${f.hot}`:'',f.vip?`VIP${f.vip}`:'',f.ticket?`${f.ticket}跟票`:'',f.deposit?`${f.deposit}入金`:'',f.follow].filter(Boolean).join(' · ')||'全部客户';}
  function renderCustomerFilters(){const f=state.extraFilters,pageOptions=[...new Set([...pages,...activeCustomers().map(customer=>customer.page).filter(Boolean)])];return `<div id="customerAdvancedFilters" class="quick-filters"><div class="quick-filter-head"><strong>高级筛选</strong><button class="link-button" data-action="clear-extra">清空</button></div><div class="filter-grid">${filterSelect('source','渠道',sources,f.source)}${f.source?filterSelect('page','页面',pageOptions,f.page):''}${filterSelect('assistant','跟进助理',assistants,f.assistant)}${filterSelect('status','进群状态',statuses,f.status)}${filterSelect('phase','客户阶段',phases,f.phase)}${filterSelect('qualification','资质评级',qualifications,f.qualification)}${filterSelect('hot','热聊状态',['true','false'],f.hot,'是,否')}${filterSelect('vip','VIP 状态',['true','false'],f.vip,'是,否')}</div></div>`;}
  function filterSelect(key,label,options,value,display){return `<label class="filter-field"><span>${label}</span><select data-extra-filter="${key}"><option value="">全部</option>${options.map((v,i)=>`<option value="${esc(v)}" ${String(value||'')===String(v)?'selected':''}>${display?display.split(',')[i]:esc(v)}</option>`).join('')}</select></label>`;}
  function renderSegments(){const list=filteredCustomers();$('#viewContainer').innerHTML=heading('分类视图','按照参考工作台的单导、群粉、页面和助理逻辑，快速组合查看客户',btn('导出分类','download','export-filtered'))+renderSavedViews('segment')+`<div class="segment-top"><div class="segment-count">当前数据视图</div><span class="offline-pill"><span class="status-dot"></span>分类与统计实时联动</span></div>${renderSegmentTabs()}${renderSegmentSummary(list)}<div class="table-toolbar panel" style="margin-bottom:9px"><div class="table-context"><strong>组合筛选</strong><span>不同维度可叠加，点击统计卡片可快速筛选</span></div><div class="toolbar-controls"><label class="input-search">${icons('search')}<input data-search="segment" value="${esc(state.search)}" placeholder="搜索姓名、号码、群编号"></label></div></div>${tableBlock(list,'segment')}`;}
  // V5.0 §17 客户资料完整度：按真实已存在的字段实时计算，人工编辑与 AI 补齐后立即反映。
  // 占位值、"WhatsApp" 这类通用标签和"待确认"状态不计分（规则在 customer-completeness-core.js）。
  function customerCompletenessHtml(customer){
    const engine=window.ZhikeCustomerCompleteness;
    if(!engine||typeof engine.computeProfileCompleteness!=='function')return '<p class="panel-note">资料完整度模块未加载，请重新打开应用。</p>';
    const result=engine.computeProfileCompleteness(customer);
    const tag={complete:'tag-green',good:'tag-blue',partial:'tag-amber',sparse:'tag-red'}[result.band]||'tag-gray';
    const missing=result.missing.length?`<div class="completeness-missing"><span>待补齐</span>${result.missing.map(item=>`<i>${esc(item)}</i>`).join('')}</div>`:'<p class="panel-note completeness-done">资料已完整，未发现缺失项。</p>';
    return `<div class="completeness-head"><strong>${result.score}%</strong><span class="status-tag ${tag}">${esc(result.bandLabel)}</span></div><div class="completeness-meter" role="img" aria-label="客户资料完整度 ${result.score}%"><span style="width:${result.score}%"></span></div>${missing}<p class="panel-note completeness-note">评分只依据真实已存在的字段；占位值、待确认状态和通用标签不计分。</p>`;
  }
  // V5.0 §19 客户 360：字段来源、待确认冲突和资料变更记录。只读取本机治理数据，
  // 渲染为抽屉中的只读区块；读取失败时显示真实原因，不显示旧数据冒充新结果。
  async function loadCustomerGovernancePanel(customerId){
    const view=window.ZhikeCustomerGovernanceView;
    const drawer=document.querySelector('#customerDrawer');
    if(!drawer)return;
    const isCurrent=()=>{const current=document.querySelector('#customerDrawer');return Boolean(current&&current.classList.contains('open')&&String(current.dataset.customerId||'')===String(customerId));};
    const mount=html=>{const current=document.querySelector('#customerDrawer');if(!current||!isCurrent())return;const old=current.querySelector('[data-governance-panel]');if(old)old.remove();const holder=document.createElement('div');holder.dataset.governancePanel='';holder.innerHTML=html;const actions=current.querySelector('.customer-360-actions')||current.querySelector('.drawer-actions');if(actions)actions.insertAdjacentElement('beforebegin',holder);else current.appendChild(holder);};
    if(!view){mount('<section class="customer-360-section zk-surface"><p class="panel-note">治理视图模块未加载，请重新打开应用。</p></section>');return;}
    mount(view.renderGovernancePanel({loading:true}));
    try{
      const response=await fetch(`/api/data-governance/customers/${encodeURIComponent(customerId)}/profile`,{cache:'no-store'});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body&&body.error?body.error:`读取失败（${response.status}）`);
      if(!isCurrent())return;
      mount(view.renderGovernancePanel({evidence:body.evidence,actions:body.actions,conflicts:body.conflicts}));
    }catch(error){
      mount(view.renderGovernancePanel({error:String(error&&error.message||'读取字段来源与变更记录失败。')}));
    }
  }
  // V5.0 §12/§19 渠道归属与在群证据：只显示已存储的值，缺失显示“未记录”。
  function customerAttributionRows(customer){
    const engine=window.ZhikeCustomerAttribution;
    if(!engine||typeof engine.attributionFields!=='function')return [['渠道归属','模块未加载，请重新打开应用']];
    return engine.attributionFields(customer);
  }
  // V5.0 §16/§19 字段锁定：锁定后 AI、导入和自动补全都不会改写这些字段。
  function customerFieldLockHtml(customer){
    const engine=window.ZhikeFieldLocks;
    if(!engine||!Array.isArray(engine.LOCKABLE_FIELDS))return '<p class="panel-note">字段锁定模块未加载，请重新打开应用。</p>';
    const summary=engine.lockSummary(customer);
    const chips=engine.LOCKABLE_FIELDS.map(item=>{const on=summary.fields.includes(item.key);return `<button type="button" class="lock-chip ${on?'active':''}" data-action="toggle-field-lock" data-id="${esc(customer.id)}" data-field="${esc(item.key)}" aria-pressed="${on}">${on?'🔒 ':''}${esc(item.label)}</button>`;}).join('');
    return `<div class="lock-chips">${chips}</div><p class="panel-note">已锁定 ${summary.count} 个字段。锁定后 AI 分析、导入和自动补全都不会改写这些字段；再次点击即可解锁。</p>`;
  }
  // V5.0 §14/§19 投资资料：只显示已存储的值，缺失显示“未记录”。
  function customerInvestmentRows(customer){
    const engine=window.ZhikeInvestmentProfile;
    if(!engine||typeof engine.investmentFields!=='function')return [['投资资料','模块未加载，请重新打开应用']];
    return engine.investmentFields(customer);
  }
  function customerIdentityHtml(customer,drawer=false){
    const name=esc(customerName(customer));
    const phone=esc(customer.rawPhone||customer.phone||'未登记号码');
    const vip=String(customer.vipNumber||'').trim();
    return `<div class="${drawer?'detail-hero customer-360-hero':'customer6-focus-identity'} zk-surface zk-surface--accent">
      ${customerAvatarHtml(customer,'hero')}
      <div class="customer-360-identity">
        <strong title="${name}">${name}</strong>
        <p class="customer-360-phone">${phone}</p>
        <div class="customer-360-tags">
          ${statusTag(customer.status||'进群状态未知')}
          ${phaseTag(customer.phase||'阶段未记录')}
          ${vip?`<span class="status-tag tag-amber">VIP ${esc(vip)}</span>`:'<span class="status-tag tag-gray">无 VIP 编号</span>'}
          ${customer.hot?'<span class="status-tag tag-coral">热聊</span>':''}
          ${customer.favorite?'<span class="status-tag tag-amber">重点关注</span>':''}
        </div>
      </div>
    </div>`;
  }
  function customerDetailCard(title,icon,body,extra='',drawer=false){
    const heading=drawer?'strong':'h3';
    return `<section class="${drawer?'customer-360-section':'customer6-focus-card'} zk-surface">
      <div class="customer-360-section-title"><${heading}><span class="customer-card-icon" aria-hidden="true">${icons(icon)}</span>${title}</${heading}>${extra}</div>
      ${body}
    </section>`;
  }
  function customerDetailFields(rows,kind='preview'){
    return rows.map(([label,value])=>{
      const text=esc(value);
      return `<div class="${kind==='preview'?'customer6-focus-field':'detail-field'}"><span>${label}</span><strong title="${text}">${text}</strong></div>`;
    }).join('');
  }
  function customerHotFields(customer){
    const tags=Array.isArray(customer.tags)?customer.tags.filter(value=>typeof value==='string'&&value.trim()).join('、'):'';
    return [['热聊状态',customer.hot===true?'是':customer.hot===false?'否':'未记录'],['客户阶段',customer.phase||'未记录'],['跟进标签',tags||'暂无跟进标签']];
  }
  function customerFollowFields(customer,crm){
    const validDue=isValidDateKey(customer.due);
    const followStatus=validDue?(customer.due<today?'逾期':customer.due===today?'今日待跟进':'已安排'):'未安排';
    return [['上次跟进',customer.lastFollow||'未记录'],['下次跟进',validDue?customer.due:'未安排'],['跟进状态',followStatus],['CRM 阶段',crm.stage]];
  }
  function customerDepositLabel(customer,business,index){
    if(!business.deposit||!Number.isFinite(business.amount))return 'Unknown';
    if(business.amount!==0)return money(business.amount);
    // The business aggregate also uses zero for missing amounts. Check the source before displaying zero.
    const hasAmount=value=>(typeof value==='number'||typeof value==='string')&&String(value).trim()!==''&&Number.isFinite(Number(value));
    const id=String(customer.id);
    const phones=customerPhoneKeys(customer).filter(phone=>index.phoneOwners.get(phone)?.size===1&&index.phoneOwners.get(phone).has(id));
    if(!index.depositRecordIds.has(id)&&!phones.some(phone=>index.depositRecordPhones.has(phone)))return hasAmount(customer.amount)?money(0):'Unknown';
    const confirmed=state.deposits.filter(record=>record&&record.status!=='待确认'&&
      (record.customerId?sameId(record.customerId,customer.id):phones.includes(linkedPhone(record.phone))));
    return confirmed.length&&confirmed.every(record=>hasAmount(record.amount))?money(0):'Unknown';
  }
  function customerBusinessFields(customer){
    const index=businessSummaryIndex(),business=customerBusinessSummary(customer,index);
    const registered=state.registrations.some(record=>record?.status==='已报名'&&sameId(record.customerId,customer.id));
    return [
      ['CRM 群编号',customer.group||'—'],
      ['跟票',business.ticket?'已有记录':'暂无已确认记录'],
      ['累计入金',customerDepositLabel(customer,business,index)],
      ['报名',registered?'已有报名记录':'暂无报名记录'],
    ];
  }
  function customerReadingSummary(){
    return '<p class="customer-360-reading"><span class="status-tag tag-gray">Unknown</span><span>客户档案中暂无可验证的消息回执。</span></p>';
  }
  function customerAiSummary(customer){
    const summary=String(customer.aiSummary??'').trim();
    return `<p class="customer6-focus-summary"${summary?` title="${esc(summary)}"`:''}>${esc(summary||'尚无已保存的聊天分析摘要')}</p>`;
  }
  function customerCenterFocusHtml(customer,selected=false){
    const title=`<div class="customer6-focus-title"><span>客户 360°</span>${customer?`<small>${selected?'当前选中客户':'本页首位客户'}</small>`:''}</div>`;
    const empty='<div class="customer6-focus-empty"><strong>选择客户查看档案</strong><p>当前列表暂无客户可预览。</p></div>';
    const content=customer?`${customerIdentityHtml(customer)}
      <div class="customer6-focus-sections">
        ${customerDetailCard('基础资料','user',customerDetailFields([
          ['手机号码',customer.rawPhone||customer.phone||'—'],['身份标识',customer.identity||customer.identityId||'—'],
          ['渠道',customer.channel||customer.source||'—'],['页面分类',customer.page||'—'],
          ['资质评级',customer.qualification||'待评估'],['客户阶段',customer.phase||'未记录'],
        ]))}
        ${customerDetailCard('热聊资料','message',customerDetailFields(customerHotFields(customer)))}
        ${customerDetailCard('业务概览','wallet',customerDetailFields(customerBusinessFields(customer)))}
        ${customerDetailCard('群组关系','users-group',groupMembershipRows(customer))}
        ${customerDetailCard('跟进时间线','history',customerDetailFields(customerFollowFields(customer,crmProfile(customer))))}
        ${customerDetailCard('阅读统计','check',customerReadingSummary())}
        ${customerDetailCard('AI 摘要','spark',customerAiSummary(customer))}
      </div>
      <button type="button" class="btn primary customer6-focus-open" data-action="open-search-customer" data-id="${esc(customer.id)}">打开完整档案 ${icons('arrow-right')}</button>`:empty;
    return `<aside id="customerCenterPreview" class="customer6-focus zk-surface" aria-label="客户档案预览">${title}${content}</aside>`;
  }
  function updateCustomerPreviewHighlight(customer){
    $$('#viewContainer tr[data-customer]').forEach(row=>{
      const current=Boolean(customer&&sameId(row.dataset.customer,customer.id));
      row.classList.toggle('customer6-preview-selected',current);
      const button=row.querySelector('button[data-customer]');
      if(current)button?.setAttribute('aria-current','true');
      else button?.removeAttribute('aria-current');
    });
  }
  function updateCustomerPreview(customer){
    if(!customer||state.view!=='customers')return;
    state.customerPreviewId=String(customer.id);
    const preview=$('#viewContainer .customer6-focus');
    if(preview)preview.outerHTML=customerCenterFocusHtml(customer,true);
    updateCustomerPreviewHighlight(customer);
  }
  function renderCustomers(){
    const list=filteredCustomers('customer'),count=counts(),favoriteCount=count.favorite,duplicateCount=duplicateCustomerPlan().duplicates.length;
    const metrics=[['客户总数',count.total,'teal','users'],['有跟票',count.ticket,'cyan','chart'],['今日待跟进',count.due,'gold','calendar'],['已进群',count.joined,'teal','layers'],['VIP 客户',count.vip,'gold','shield'],['热聊客户',count.hot,'violet','message'],['逾期待跟进',count.overdue,'cyan','clock']];
    const previewCollapsed=Boolean(state.customerPreviewCollapsed);
    const related=[['群组','go-groups','users-group'],['VIP','go-vip','crown'],['跟票','go-tickets','trending'],['报名','go-registrations','clipboard-check'],['入金','go-deposits','wallet']];
    const table=tableBlock(list,'customer'),start=(state.page-1)*state.perPage;
    const visible=list.slice(start,start+state.perPage);
    const selected=visible.find(customer=>sameId(customer.id,state.customerPreviewId));
    const previewCustomer=selected||visible[0];
    $('#viewContainer').innerHTML=heading('客户中心',`客户资料是唯一主档 · ${count.total.toLocaleString()} 位客户；跟票、报名和入金保持独立记录`,`${favoriteCount?`<button class="btn" data-action="favorite-customers">★ 重点关注 ${favoriteCount}</button>`:''}<button class="btn" data-action="deduplicate-customers">删除重复值${duplicateCount?` (${duplicateCount})`:''}</button>${btn('导入客户','upload','go-data')}${btn('新增客户','plus','new-customer','primary')}`)+
      `<details class="customer-business-overview"${state.customerOverviewExpanded?' open':''}><summary><strong class="customer-business-overview-title">客户业务概览</strong><span class="customer-business-overview-summary">全局 ${count.total.toLocaleString()} 位 · 今日计划 ${count.due.toLocaleString()} 位 · 逾期 ${count.overdue.toLocaleString()} 位</span><span class="customer-business-overview-toggle" data-overview-toggle-label>${state.customerOverviewExpanded?'收起指标':'展开7项指标'}</span></summary><div class="customer6-overview" aria-label="客户业务摘要">${metrics.map(([label,value,tone,icon])=>`<div class="customer6-metric ${tone}"><span class="customer6-metric-label"><span class="customer6-metric-icon" aria-hidden="true">${icons(icon)}</span>${label}</span><strong>${Number(value).toLocaleString()}</strong><small>全局有效客户</small></div>`).join('')}</div></details><div class="customer6-view-context"><p>搜索与筛选作用于客户列表；右侧预览可收起，完整档案仍可从客户行打开。</p><button type="button" class="btn" data-action="toggle-customer-preview" aria-controls="customerCenterPreview" aria-expanded="${String(!previewCollapsed)}">${previewCollapsed?'显示档案预览':'收起档案预览'}</button></div><div class="customer6-workspace ${previewCollapsed?'is-preview-collapsed':''}"><div class="customer6-primary">${renderSavedViews('customer')}${table}<nav class="customer6-relations" aria-label="客户关联业务">${related.map(([label,action,icon])=>`<button type="button" class="zk-surface zk-surface--interactive" data-action="${action}"><span class="customer-relation-icon" aria-hidden="true">${icons(icon)}</span><strong>${label}</strong></button>`).join('')}</nav></div>${previewCollapsed?'<div id="customerCenterPreview" hidden aria-hidden="true"></div>':customerCenterFocusHtml(previewCustomer,Boolean(selected))}</div>`;
    $('#viewContainer .customer-business-overview')?.addEventListener('toggle',event=>{if(event.currentTarget!==$('#viewContainer .customer-business-overview'))return;state.customerOverviewExpanded=event.currentTarget.open;const label=event.currentTarget.querySelector('[data-overview-toggle-label]');if(label)label.textContent=event.currentTarget.open?'收起指标':'展开7项指标';});
    updateCustomerPreviewHighlight(previewCustomer);
    if(state.homeCustomerScope){const labels={overdue:'逾期客户','high-value':'高价值待安排','registered-unfollowed':'已报名未跟进'};$('#viewContainer .page-heading').insertAdjacentHTML('afterend','<div class="notice-line">当前范围：'+esc(labels[state.homeCustomerScope]||'首页提醒')+' · '+list.length+' 位客户 <button class="link-button" data-action="go-customers">查看全部客户</button></div>');}
  }

  function normalizeIntakePaste(text){
    const invisible=/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
    const value=String(text||'').normalize('NFKC').replace(/\r\n?/g,'\n').replace(invisible,'').replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g,' ');
    const output=[];
    for(const sourceLine of value.split('\n')){
      const hasTableColumns=sourceLine.includes('\t');
      if(hasTableColumns){const cells=sourceLine.split('\t').map(cell=>cell.trim());if(cells.some(Boolean))output.push(cells.join('\t'));continue;}
      let line=sourceLine.trim().replace(/[•·●▪■◆★※]+/g,',').replace(/[，、；;|｜]+/g,',').replace(/,+/g,',').replace(/[ \t]+/g,' ');
      if(!line)continue;
      const phoneOnly=/^[+\d\s().,\-_/\\]+$/.test(line);
      if(phoneOnly){
        const separated=line.split(/[,\t]+/).map(item=>item.trim()).filter(Boolean);
        const spaced=line.split(/\s+/).map(item=>item.trim()).filter(Boolean);
        const candidates=separated.length>1?separated:spaced;
        if(candidates.length>1&&candidates.every(item=>{const count=item.replace(/\D/g,'').length;return count>=10&&count<=13;})){
          output.push(...candidates.map(item=>(item.trim().startsWith('+')?'+':'')+item.replace(/\D/g,'')));
          continue;
        }
        const digits=line.replace(/\D/g,'');
        if(digits.length>=24&&digits.length%12===0){const chunks=[];for(let index=0;index<digits.length;index+=12)chunks.push(digits.slice(index,index+12));if(chunks.every(chunk=>chunk.startsWith('91'))){output.push(...chunks);continue;}}
        if(digits.length>13&&digits.startsWith('91')&&(digits.length-2)%10===0){const local=digits.slice(2);for(let index=0;index<local.length;index+=10)output.push(local.slice(index,index+10));continue;}
        if(digits.length>13&&digits.length%10===0){for(let index=0;index<digits.length;index+=10)output.push(digits.slice(index,index+10));continue;}
        if(digits.length>=10&&digits.length<=13){output.push((line.startsWith('+')?'+':'')+digits);continue;}
      }
      line=line.replace(/(?:\+?\d[\d().-]*)(?:\s+\d[\d().-]*)*/g,match=>{const digits=match.replace(/\D/g,'');return digits.length>=10&&digits.length<=13?(match.trim().startsWith('+')?'+':'')+digits:match;});
      output.push(line.replace(/^,+|,+$/g,'').trim());
    }
    return output.join('\n');
  }
  function parseLine(line,index){
    const raw=line.trim(); if(!raw)return null;
    let parts=raw.includes('\t')?raw.split('\t'):raw.split(/[,，、|;；/]/).map(s=>s.trim()).filter(Boolean);
    if(parts.length===1) parts=raw.split(/\s+/).filter(Boolean);
    const phoneSource=raw.replace(/(?:\d{4}[年.\/-]\d{1,2}[月.\/-]\d{1,2}日?|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}|\b\d{8}\b)/g,' ');
    const phoneCandidates=[...phoneSource.matchAll(/(?:\+?\d[\d\s().-]{7,}\d)/g)].map(match=>match[0].trim()).filter(candidate=>{const digits=candidate.replace(/\D/g,'');return digits.length>=8&&digits.length<=15;});
    const phoneMatch=phoneCandidates[0]||''; const rawPhone=phoneMatch; const phone=rawPhone.replace(/\D/g,'').replace(/^91(?=\d{10}$)/,'');
    let remainder=raw.replace(phoneMatch||'',' ').split(/[,，、|;；/\t\s]+/).map(v=>v.trim()).filter(Boolean);
    const row={id:`P${index+1}`,raw,rawPhone,phone,name:'',nameOrigin:'',source:'',sourceExplicit:false,page:'',pageExplicit:false,pageOrigin:'',assistant:'',assistantOrigin:'',thirdParty:'',group:'',groupOrigin:'',status:'',statusExplicit:false,statusOrigin:'',phase:'',phaseOrigin:'',vipNumber:'',registered:'',due:'',hot:false,hotExplicit:false,investor:false,investorExplicit:false,note:'',confidence:phone.length===10?100:phone?35:0,issues:[]};const smart=window.ZhikeSmartImport?.parseNaturalLine?.(raw,importSourceCatalog());if(smart){if(smart.name)row.name=smart.name;if(smart.source){row.source=smart.source;row.sourceExplicit=true;}if(smart.status){row.status=smart.status;row.statusExplicit=true;}if(smart.vipNumber)row.vipNumber=smart.vipNumber;if(smart.registered)row.registered=smart.registered;if(smart.due)row.due=smart.due;if(Number.isFinite(smart.confidence))row.confidence=Math.max(row.confidence,smart.confidence);}const dueLabelMatch=raw.match(/(?:下次跟进(?:日期)?|计划跟进(?:日期)?|跟进日期|计划日期|下次联系(?:日期)?)\s*[:：=]?\s*([^\s,，;；|]+)/i);if(dueLabelMatch&&!row.due)row.due=normalizeImportedDate(dueLabelMatch[1]);
    if(!phone)row.issues.push('未识别号码'); else if(phone.length!==10)row.issues.push('号码长度异常');
    const consumed=new Set(); const norm=s=>s.toLowerCase().replace(/[ _-]/g,'');
    const aliases={
      assistant:{},
      status:{'已进群':'已进群','已进':'已进群','进了':'已进群','在群':'在群','在群里':'在群','未进群':'未进群','未进':'未进群','没进':'未进群','已退群':'已退群','退群':'已退群','退了':'已退群','临时退群':'临时退群','临退':'临时退群','重粉':'重粉','重复粉':'重粉','无效':'无效'},
      phase:{'新客户':'新客户','潜在客户':'潜在客户','意向客户':'意向客户','高意向':'高意向','成交客户':'成交客户','暂停跟进':'暂停跟进'},
    };
    const getToken=(token,map,configured=[])=>{const key=norm(token);for(const [alias,val] of Object.entries(map))if(norm(alias)===key)return val;return configured.find(value=>norm(value)===key)||null;};
    remainder.forEach((token,i)=>{
      const t=token.replace(/^(来源|渠道|助理|群号|群编号|阶段|姓名)[:：=]/,''); const low=token.toLowerCase();
      if(/^(姓名)[:：=]/i.test(token)){row.name=t;row.nameOrigin='资料';consumed.add(i);return;}
      if(/^(渠道|来源|归属)[:：=]/i.test(token)){const sourceValue=sources.find(value=>norm(value)===norm(t))||(/^group|群粉$/i.test(t)?'群粉':/^single|单导$/i.test(t)?'单导':t);row.source=normalizeBusinessSource(sourceValue,row.page);row.sourceExplicit=true;if(!sources.includes(row.source))sources.push(row.source);consumed.add(i);return;}
      if(/^(助理)[:：=]/i.test(token)){row.assistant=getToken(t,aliases.assistant,assistants)||t;row.assistantOrigin='资料';consumed.add(i);return;}
      if(/^(群号|群编号)[:：=]/i.test(token)){row.group=t.toUpperCase();row.groupOrigin='资料';consumed.add(i);return;}
      if(/^(VIP编号|VIP号|会员编号)[:：=]/i.test(token)){row.vipNumber=t.replace(/^(VIP编号|VIP号|会员编号)[:：=]/i,'').trim().slice(0,64);consumed.add(i);return;}
      if(/^VIP[-_ ]?[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/i.test(token)){row.vipNumber=token.replace(/\s+/g,'').slice(0,64);consumed.add(i);return;}
      const dueValue=t.replace(/^(下次跟进(?:日期)?|计划跟进(?:日期)?|跟进日期|计划日期|下次联系(?:日期)?)[:：=]/i,'');const detectedDue=normalizeImportedDate(dueValue);if(/^(下次跟进|计划跟进|跟进日期|计划日期|下次联系)/i.test(t)&&detectedDue){row.due=detectedDue;consumed.add(i);return;}
      const detectedDate=normalizeImportedDate(t.replace(/^(登记日期|注册日期|日期|时间)[:：=]/i,''));if(detectedDate){row.registered=detectedDate;consumed.add(i);return;}
      if(/^(登记日期|注册日期|日期|时间)[:：=]/i.test(token)){const labelled=normalizeImportedDate(t);if(labelled){row.registered=labelled;consumed.add(i);return;}}
      const sourceValue=sources.find(value=>norm(value)===norm(token));if(sourceValue){row.source=sourceValue;row.sourceExplicit=true;consumed.add(i);return;}
      const assistant=getToken(token,aliases.assistant,assistants);if(assistant){row.assistant=assistant;row.assistantOrigin='识别';consumed.add(i);return;}
      const statusPhrase=/未进群|已进群|在群|已退群|临时退群|重粉|进群|退群/.exec(token);if(statusPhrase){const statusValue=getToken(statusPhrase[0],aliases.status,statuses);if(statusValue){if(row.statusExplicit&&row.status!==statusValue)row.issues.push('进群状态冲突');row.status=statusValue;row.statusExplicit=true;consumed.add(i);return;}}
      const status=getToken(token,aliases.status,statuses);if(status){if(row.statusExplicit&&row.status!==status)row.issues.push('进群状态冲突');row.status=status;row.statusExplicit=true;consumed.add(i);return;}
      const phase=getToken(token,aliases.phase,phases);if(phase){row.phase=phase;row.phaseOrigin='识别';consumed.add(i);return;}
      const customPage=pages.find(page=>norm(page)===norm(token));if(customPage){row.page=customPage;row.pageExplicit=true;row.pageOrigin='资料';consumed.add(i);return;}
      if(/^(单导[-_ ]?\w+|助理\d{3,5}|\d{3,5})$/i.test(token)){row.page=token.toLowerCase().startsWith('单导')?token.replace(/\s/g,''):/^\d{3,5}$/.test(token)?`助理${token}`:token;row.pageExplicit=true;row.pageOrigin='资料';consumed.add(i);return;}
      if(/群粉|群粉登记|群导|社群|微信群|WhatsApp群|telegram群/i.test(token)){row.source='群粉';row.sourceExplicit=true;consumed.add(i);return;}
      if(/单导|私聊|广告|落地页|自然流量/i.test(token)){row.source='单导';row.sourceExplicit=true;consumed.add(i);return;}
      const configuredGroup=groupIds.find(group=>norm(group)===norm(token));if(configuredGroup){row.group=configuredGroup;row.groupOrigin='识别';consumed.add(i);return;}
      if(/^(G[-_]?\d+|群\w+|VIP[-_]?\w+)$/i.test(token)){row.group=token.replace(/^群/,'G').toUpperCase();row.groupOrigin='识别';consumed.add(i);return;}
      if(/^(?:\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d{8})$/.test(token)){const parts=token.match(/\d+/g)||[];let year,month,day;if(parts.length===3)[year,month,day]=parts.map(Number);else if(parts.length===1&&parts[0].length===8)[year,month,day]=[Number(parts[0].slice(0,4)),Number(parts[0].slice(4,6)),Number(parts[0].slice(6,8))];if(year>=1900){const date=new Date(year,month-1,day);if(date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day)row.registered=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;}if(row.registered){consumed.add(i);return;}}
      if(/热聊|重点聊/.test(token)){row.hot=!/非热聊|不热聊/.test(token);row.hotExplicit=true;consumed.add(i);return;}
      if(/股民/.test(token)){row.investor=!/非股民|不是股民/.test(token);row.investorExplicit=true;consumed.add(i);return;}
      if(/电话未接|需回拨|已联系|已拨打/.test(token)){row.note+=(row.note?' ':'')+token;consumed.add(i);return;}
    });
    const leftovers=remainder.filter((_,i)=>!consumed.has(i));
    if(!row.source){const sourceToken=leftovers.find(token=>sources.some(value=>norm(value)===norm(token)));if(sourceToken){row.source=sources.find(value=>norm(value)===norm(sourceToken));row.sourceExplicit=true;leftovers.splice(leftovers.indexOf(sourceToken),1);}else row.source='单导';}
    if(!row.name){const candidate=leftovers.find(t=>/[A-Za-z\u3400-\u9fff]/.test(t)&&t.length<18&&!/\d{5,}/.test(t));if(candidate){row.name=candidate;row.nameOrigin='识别';leftovers.splice(leftovers.indexOf(candidate),1);row.confidence=Math.min(row.confidence,86);}}
    row.note=[row.note,...leftovers].filter(Boolean).join(' ');
    const existing=knownIntakePhones().get(phone); if(existing)row.issues.push(`已存在：${existing.name}`);
    if(phone&&intakeBatchPhones?.has(phone))row.issues.push('同批重复');if(phone)intakeBatchPhones?.add(phone);
    const vip=vipKey(row.vipNumber),vipOwner=vip?knownIntakeVipNumbers().get(vip):null;if(vipOwner)row.issues.push(`VIP编号已存在：${vipOwner.name}`);if(vip&&intakeBatchVipNumbers?.has(vip))row.issues.push('同批 VIP 编号重复');if(vip)intakeBatchVipNumbers?.add(vip);
    if(!row.status){row.status=isGroupFanSource(row.source)?'在群':'未进群';row.statusOrigin='识别';}else if(row.statusExplicit)row.statusOrigin='资料';
    if(!row.assistant)row.assistant='未分配';
    row.suggestions=window.ZhikeSmartImport?.rowSuggestions?.(row,state.channelAliases)||[];
    if(row.suggestions.length&&(row.confidence<70||row.suggestions.some(item=>/多个候选/.test(item))))row.issues.push(`请复核：${row.suggestions.join('、')}`);
    if(row.issues.length)row.confidence=Math.min(row.confidence,40);
    return row;
  }
  function revalidateIntakeRows(){const phoneCounts=new Map(),vipCounts=new Map();for(const row of state.parsed){if(row.phone)phoneCounts.set(row.phone,(phoneCounts.get(row.phone)||0)+1);const key=vipKey(row.vipNumber||$('#defaultVipNumber')?.value||'');if(key)vipCounts.set(key,(vipCounts.get(key)||0)+1);}const known=knownIntakePhones(),knownVips=knownIntakeVipNumbers();let good=0,existingCount=0,bad=0;state.parsed.forEach((row,rowIndex)=>{row.issues=row.issues.filter(issue=>!['未识别号码','号码长度异常','同批重复','同批 VIP 编号重复'].includes(issue)&&!issue.startsWith('已存在：')&&!issue.startsWith('VIP编号已存在：')&&!(row.channelConfirmed&&issue.startsWith('渠道存在歧义：')));if(!row.phone)row.issues.push('未识别号码');else if(row.phone.length!==10)row.issues.push('号码长度异常');const existing=known.get(row.phone);if(existing)row.issues.push(`已存在：${existing.name}`);if(row.phone&&phoneCounts.get(row.phone)>1)row.issues.push('同批重复');const key=vipKey(row.vipNumber||$('#defaultVipNumber')?.value||'');if(key&&knownVips.has(key))row.issues.push(`VIP编号已存在：${knownVips.get(key).name}`);if(key&&vipCounts.get(key)>1)row.issues.push('同批 VIP 编号重复');row.confidence=row.phone.length===10?(row.name?86:100):35;if(row.issues.length)row.confidence=Math.min(row.confidence,40);if(!row.issues.length&&row.phone.length===10)good++;else if(row.issues.some(issue=>issue.startsWith('已存在：')||issue.startsWith('VIP编号已存在：')))existingCount++;else bad++;if(rowIndex>=100)return;const numberCell=$(`[data-normalized-phone="${rowIndex}"]`);if(numberCell)numberCell.textContent=row.phone||'未识别';const confidenceCell=$(`[data-parsed-row="${rowIndex}"] .confidence`);if(confidenceCell)confidenceCell.textContent=`${row.confidence}%`;const issueCell=$(`[data-parse-issues="${rowIndex}"]`);if(issueCell)issueCell.innerHTML=row.issues.length?`<span class="status-tag ${row.issues.some(issue=>issue.startsWith('已存在：')||issue.startsWith('VIP编号已存在：'))?'tag-amber':'tag-red'}">${esc(row.issues.join('、'))}</span>`:'<span class="status-tag tag-green">可新增</span>';});const summary=$$('.parse-count');if(summary[0])summary[0].textContent=`可新增 ${good}`;if(summary[1])summary[1].textContent=`已存在 ${existingCount}`;if(summary[2])summary[2].textContent=`待检查 ${bad}`;}
  function parseIntake(){const lines=$('#intakeText')?.value||state.intakeText;state.intakeText=lines;parseIntakeLines(lines);renderIntake();}
  function intakeMode(values){const counts=new Map();for(const value of values.map(item=>String(item||'').trim()).filter(Boolean))counts.set(value,(counts.get(value)||0)+1);const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'zh-CN'));return ranked[0]||['',0];}
  function applyIntakeSmartDefaults(){const rows=state.parsed||[];if(!rows.length){toast('请先粘贴或导入客户资料');return;}const explicit=(field,origin)=>rows.filter(row=>row[field]&&(!origin||row[origin]));const sourceMode=intakeMode(explicit('source','sourceExplicit').map(row=>normalizeBusinessSource(row.source,row.page)));const pageMode=intakeMode(explicit('page','pageExplicit').map(row=>row.page));const assistantMode=intakeMode(explicit('assistant','assistantOrigin').map(row=>row.assistant));const groupMode=intakeMode(explicit('group','groupOrigin').map(row=>row.group));const statusMode=intakeMode(explicit('status','statusExplicit').map(row=>row.status));const phaseMode=intakeMode(rows.map(row=>row.phase));const dateMode=intakeMode(rows.map(row=>row.registered));let changed=[];const set=(id,value)=>{const node=$('#'+id);if(node&&value){node.value=value;changed.push(id);}};set('defaultSource',sourceMode[0]);set('defaultPage',pageMode[0]);set('defaultAssistant',assistantMode[0]);set('defaultGroup',groupMode[0]);set('defaultStatus',statusMode[0]);set('defaultPhase',phaseMode[0]);if(dateMode[0]&&dateMode[1]===rows.length){set('defaultRegistered',dateMode[0]);const manual=$('#manualRegistered');if(manual){manual.checked=true;manual.dispatchEvent(new Event('change'));}}const defaults=currentIntakeDefaults();state.settings.intakeDefaults=defaults;state.settings.intakeDraft={text:state.intakeText,defaults};scheduleIntakeDraft();renderIntake();toast(changed.length?`已应用 ${changed.length} 项批次默认值，逐行识别结果优先`:'没有足够的统一字段可自动填充');}
  function organizeIntake(){const textarea=$('#intakeText');const raw=textarea?.value||state.intakeText||'';if(!raw.trim()){toast('请先粘贴或导入客户资料');return;}const cleaned=raw.replace(/[\u200B\uFEFF]/g,'').replace(/\r\n?/g,'\n').split('\n').map(line=>line.includes('\t')?line.split('\t').map(cell=>cell.trim()).join('\t'):line.replace(/[ \t]+/g,' ').trim()).filter(Boolean).join('\n');state.intakeText=cleaned;parseIntakeLines(cleaned);scheduleIntakeDraft();renderIntake();const skipped=Number(state.intakeSkippedHeaders||0),table=state.intakeTableSummary;const hint=table?`，已识别 ${table.rows} 行表格字段`:(skipped?`，跳过 ${skipped} 行表头或分隔线`:'');toast(`已智能整理并重新识别${hint}`);}
  function intakeDefaults(){return state.settings.intakeDefaults||state.settings.intakeDraft?.defaults||{};}
  function currentIntakeDefaults(){const page=$('#defaultPage')?.value||'';return {source:normalizeBusinessSource($('#defaultSource')?.value,page),page,assistant:$('#defaultAssistant')?.value.trim()||'',group:$('#defaultGroup')?.value.trim()||'',vipNumber:$('#defaultVipNumber')?.value.trim()||'',status:$('#defaultStatus')?.value||'',phase:$('#defaultPhase')?.value||'',registered:$('#defaultRegistered')?.value||today,manualRegistered:Boolean($('#manualRegistered')?.checked),hot:Boolean($('#defaultHot')?.checked),investor:Boolean($('#defaultInvestor')?.checked)};}
  async function loadQuickIntakeFile(file){if(!file)return;try{if(file.size>24*1024*1024)throw new Error('文件超过 24 MB 上限');let tables=[];if(/\.xlsx?$|\.xlsm$/i.test(file.name)){if(!window.zhikeAI?.parseExcel)throw new Error('当前环境无法解析 Excel，请改用 CSV');const parsed=await window.zhikeAI.parseExcel({bytes:await file.arrayBuffer()});tables=parsed.tables||[];}else{const text=(await decodeCsvFile(file)).replace(/^\ufeff/,''),rows=parseCsv(text,detectCsvDelimiter(text));tables=[{name:file.name,rows}];}for(const table of tables){const detected=window.ZhikeSmartImport?.detectHeaderRow?.(table.rows||[]);if(detected?.index>0)table.rows=table.rows.slice(detected.index);}const mixedBusiness=tables.some(table=>{const headers=(table.rows?.[0]||[]).map(value=>String(value||'').trim()),mapping=csvHeaderMapping(headers,(table.rows||[]).slice(1,21));return mapping.recordType!=null||mapping.product!=null||mapping.amount!=null||mapping.followDate!=null||mapping.direction!=null||mapping.businessNote!=null;});if(mixedBusiness){toast('已识别混合业务列，切换到智能批量导入预览');await importCsvFiles([file]);return;}const lines=[];for(const table of tables){if(!table.rows?.length)continue;const headers=table.rows[0].map(value=>String(value||'').trim()),mapping=csvHeaderMapping(headers,table.rows.slice(1,21));if(mapping.phone==null)continue;const fileSource=window.ZhikeSmartImport?.sourceSignal?.(table.name)||'';for(const row of table.rows.slice(1)){const read=key=>mapping[key]==null?'':String(row[mapping[key]]||'').trim(),phone=read('phone');if(!phone&&!row.some(value=>String(value??'').trim()))continue;const route=window.ZhikeSmartImport?.inferRowClassification?.(row,mapping,headers,{aliases:importSourceCatalog(),filename:table.name})||{},source=read('source')||route.source||fileSource,status=read('status')||route.status,parts=[phone,read('name'),read('vipNumber')?`VIP编号:${read('vipNumber')}`:'',source?`渠道:${source}`:'',read('page'),read('assistant')?`助理:${read('assistant')}`:'',read('group')?`群号:${read('group')}`:'',status,read('phase'),read('registered'),read('nextFollow')?`下次跟进:${read('nextFollow')}`:'',read('note')].filter(Boolean),mappedIndexes=new Set(Object.values(mapping).filter(Number.isInteger)),unmapped=row.filter((value,index)=>!mappedIndexes.has(index)).map(value=>String(value??'').trim()).filter(Boolean);if(unmapped.length)parts.push(unmapped.join(' '));if(!parts.length)parts.push(row.map(value=>String(value??'').trim()).join('\t'));lines.push(parts.join('\t'));}}if(!lines.length)throw new Error('文件中没有识别到“手机号码”列或有效数据');const existing=($('#intakeText')?.value||state.intakeText||'').trim(),combined=[existing,lines.join('\n')].filter(Boolean).join('\n');state.intakeText=combined;parseIntakeLines(combined);renderIntake();toast(`已读取 ${lines.length} 行，渠道和状态按每行自动识别`);}catch(error){toast(error.message||'快速录入文件读取失败','x');}}
  let intakeDraftTimer;
  let intakeRenderTimer;
  function scheduleIntakeRender(){
    clearTimeout(intakeRenderTimer);
    intakeRenderTimer=setTimeout(()=>{
      if(state.view!=='intake')return;
      const textarea=$('#intakeText');
      if(!textarea)return;
      const caret=textarea.selectionStart,scrollTop=textarea.scrollTop;
      parseIntakeLines(textarea.value);
      renderIntake();
      const next=$('#intakeText');
      if(next){next.focus();next.setSelectionRange(Math.min(caret,next.value.length),Math.min(caret,next.value.length));next.scrollTop=scrollTop;}
    },180);
  }
  function scheduleIntakeDraft(){clearTimeout(intakeDraftTimer);const defaults=currentIntakeDefaults();state.settings.intakeDefaults=defaults;state.settings.intakeDraft={text:state.intakeText,defaults};intakeDraftTimer=setTimeout(()=>persist(),700);}
  function preferredAssistantForPage(page,source=$('#defaultSource')?.value||''){const counts=new Map();for(const customer of activeCustomers())if(customer.page===page&&(!source||customer.source===source)&&customer.assistant&&customer.assistant!=='未分配')counts.set(customer.assistant,(counts.get(customer.assistant)||0)+1);return [...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'zh-CN'))[0]?.[0]||'';}
  function replaceIntakeSelectWithInput(id,listId,values,placeholder){const select=$(`#${id}`);if(!select)return;const value=select.value;const datalist=document.createElement('datalist');datalist.id=listId;datalist.innerHTML=[...new Set(values)].filter(Boolean).map(option=>`<option value="${esc(option)}"></option>`).join('');const input=document.createElement('input');input.id=id;input.value=value==='未分配'||value==='不指定'?'':value;input.setAttribute('list',listId);input.placeholder=placeholder;input.autocomplete='off';select.replaceWith(input);input.insertAdjacentElement('afterend',datalist);}
  function clearImportedDatePlaceholders(){
    if(state.view!=='intake')return;
    $$('input[data-parsed-field="registered"]').forEach(input=>{
      const index=Number(input.dataset.parsedIndex);
      if(Number.isInteger(index)&&!state.parsed?.[index]?.registered)input.value='';
    });
  }
  function renderIntake(){
    setTimeout(clearImportedDatePlaceholders,0);
    const setIntakeSubmitState=()=>{const submit=$('.intake-submit');if(!submit)return;const good=state.parsed.filter(row=>!row.issues.length&&row.phone.length===10).length;submit.disabled=good===0;submit.title=good===0?'请先粘贴或导入有效客户资料':`将写入 ${good} 位新客户`;};
    const rows=state.parsed,good=rows.filter(row=>!row.issues.length&&row.phone.length===10).length,existing=rows.filter(row=>row.issues.some(issue=>issue.startsWith('已存在'))).length,errors=rows.filter(row=>row.issues.length&&!row.issues.some(issue=>issue.startsWith('已存在'))).length;
    const preview=rows.length?rows.slice(0,100).map((row,index)=>{const source=row.sourceExplicit?row.source:($('#defaultSource')?.value||'单导'),page=row.pageExplicit?row.page:($('#defaultPage')?.value||''),status=row.statusExplicit?row.status:($('#defaultStatus')?.value||(isGroupFanSource(source)?'在群':'未进群')),assistant=row.assistantOrigin?row.assistant:(($('#defaultAssistant')?.value||'')||row.assistant),group=row.groupOrigin?row.group:(($('#defaultGroup')?.value||'')||row.group),vipNumber=row.vipNumber||($('#defaultVipNumber')?.value||'');return `<tr data-parsed-row="${index}"><td><input class="preview-edit" aria-label="修正原始号码" data-parsed-index="${index}" data-parsed-field="rawPhone" value="${esc(row.rawPhone)}"></td><td class="phone-cell" data-normalized-phone="${index}">${esc(row.phone||'未识别')}</td><td><input class="preview-edit" aria-label="修正客户姓名" data-parsed-index="${index}" data-parsed-field="name" value="${esc(row.name)}"></td><td><select class="preview-edit" aria-label="修正渠道" data-parsed-index="${index}" data-parsed-field="source">${sources.map(value=>`<option ${source===value?'selected':''}>${esc(value)}</option>`).join('')}</select></td><td><select class="preview-edit" aria-label="修正页面" data-parsed-index="${index}" data-parsed-field="page"><option value="">不分页面</option>${[...new Set([...pages,...(page&&!pages.includes(page)?[page]:[])])].map(value=>`<option value="${esc(value)}" ${page===value?'selected':''}>${esc(value)}</option>`).join('')}</select></td><td><input class="preview-edit" aria-label="修正跟进助理" data-parsed-index="${index}" data-parsed-field="assistant" value="${esc(assistant==='未分配'?'':assistant)}" list="intakeAssistantOptions"><datalist id="intakeAssistantOptions">${assistants.map(value=>`<option value="${esc(value)}"></option>`).join('')}</datalist></td><td><select class="preview-edit" aria-label="修正进群状态" data-parsed-index="${index}" data-parsed-field="status">${[...new Set([...statuses,status])].map(value=>`<option ${status===value?'selected':''}>${esc(value)}</option>`).join('')}</select></td><td><input class="preview-edit" aria-label="修正群编号" data-parsed-index="${index}" data-parsed-field="group" value="${esc(group)}" list="intakeGroupOptions"><datalist id="intakeGroupOptions">${groupIds.map(value=>`<option value="${esc(value)}"></option>`).join('')}</datalist></td><td><input class="preview-edit" aria-label="修正 VIP 编号" data-parsed-index="${index}" data-parsed-field="vipNumber" value="${esc(vipNumber)}" maxlength="64"></td><td><input class="preview-edit" aria-label="修正登记日期" data-parsed-index="${index}" data-parsed-field="registered" type="date" value="${esc(row.registered||'')}"></td><td><input class="preview-edit" aria-label="修正下次跟进日期" data-parsed-index="${index}" data-parsed-field="due" type="date" value="${esc(row.due||'')}"></td><td data-parse-issues="${index}">${row.issues.length?`<span class="status-tag ${row.issues.some(issue=>issue.startsWith('已存在'))?'tag-amber':'tag-red'}">${esc(row.issues.join('、'))}</span>`:'<span class="status-tag tag-green">可新增</span>'}</td></tr>`;}).join('')+(rows.length>100?`<tr><td colspan="12" class="muted-cell">预览前 100 行，剩余 ${rows.length-100} 行仍会按同一规则完整校验。</td></tr>`:''):`<tr><td colspan="12" style="text-align:center;padding:36px;color:#9aa4b1">粘贴客户资料后，本地识别结果会显示在这里</td></tr>`;
    $('#viewContainer').innerHTML=heading('快速录入','直接粘贴表格或聊天文本；先智能整理，再一键写入。逐行识别结果优先于批次默认值',`${btn('从文件读取','upload','quick-intake-file')} ${btn('智能整理','sparkles','organize-intake')}<input id="quickIntakeFile" type="file" accept=".csv,.tsv,.xlsx,.xls,.xlsm" hidden>${btn('清空','x','clear-intake')}`)+`<div class="intake-grid"><section class="panel intake-panel intake-input-panel"><div class="panel-headline"><strong>粘贴客户资料</strong><span>支持多行 / Excel · Ctrl+Enter 写入</span></div><textarea id="intakeText" class="intake-textarea" placeholder="粘贴带表头的表格或聊天文本&#10;号码 姓名 渠道 登记日期&#10;每位客户一行，字段顺序可以不同；预览识别结果后再保存">${esc(state.intakeText)}</textarea></section><section class="panel intake-panel intake-default-panel"><div class="panel-headline"><strong>本批次默认值</strong><span>仅填未填写项</span></div><div class="source-defaults"><label>渠道<select id="defaultSource">${sources.map(value=>`<option>${esc(value)}</option>`).join('')}</select></label><label>页面<select id="defaultPage"><option value="">不分页面</option>${pages.map(value=>`<option>${esc(value)}</option>`).join('')}</select></label><label>跟进助理<select id="defaultAssistant"><option>未分配</option>${assistants.filter(value=>value!=='未分配').map(value=>`<option>${esc(value)}</option>`).join('')}</select></label><label>群编号<input id="defaultGroup" list="groupIdOptions" placeholder="例如 G001" /><datalist id="groupIdOptions">${groupIds.map(value=>`<option value="${esc(value)}"></option>`).join('')}</datalist></label><label>VIP编号<input id="defaultVipNumber" maxlength="64" placeholder="可选"></label><label class="intake-binary-default"><input id="defaultHot" type="checkbox"><span>热聊</span></label><label class="intake-binary-default"><input id="defaultInvestor" type="checkbox"><span>股民</span></label><details class="intake-advanced"><summary>高级设置</summary><div class="intake-advanced-fields"><label>未填写状态<select id="defaultStatus">${statuses.map(value=>`<option>${esc(value)}</option>`).join('')}</select></label><label>登记日期<input id="defaultRegistered" type="date" value="${today}"><label class="manual-date-choice"><input id="manualRegistered" type="checkbox"><span>手动指定登记日期</span></label></label><label>客户阶段<select id="defaultPhase">${phases.map(value=>`<option>${esc(value)}</option>`).join('')}</select></label><label>备注<input id="defaultNote" maxlength="500" placeholder="留空则使用资料中的备注"></label><div class="automation-switch"><span>自动创建首次跟进任务</span><button class="switch on" data-toggle aria-label="切换规则"></button></div></div></details></div><div class="intake-default-actions"><button class="btn" type="button" data-action="apply-intake-smart-defaults">智能填充默认值</button><button class="btn primary intake-submit" data-action="save-intake">安全写入客户</button></div><div class="intake-hint">系统会自动跳过表头、识别日期并拦截重复号码；保存失败会保留原始输入。</div></section><section class="panel intake-panel intake-preview-panel"><div class="panel-headline"><strong>识别预览</strong><span>${rows.length} 行内容${rows.length>100?' · 展示前 100 行':''}</span></div><div class="parse-summary"><span class="parse-count good">可新增 ${good}</span><span class="parse-count warn">已存在 ${existing}</span><span class="parse-count bad">待检查 ${errors}</span></div><div class="preview-table-wrap"><table class="preview-table"><thead><tr><th>原始号码</th><th>标准号码</th><th>姓名</th><th>渠道</th><th>页面</th><th>助理</th><th>状态</th><th>群编号</th><th>VIP编号</th><th>登记日期</th><th>下次跟进</th><th>检查结果</th></tr></thead><tbody>${preview}</tbody></table></div></section></div>`;
    const saved=intakeDefaults();if(saved.page&&!pages.includes(saved.page))pages.push(saved.page);if(saved.source&&!sources.includes(saved.source))sources.push(saved.source);for(const [id,key] of [['defaultSource','source'],['defaultPage','page'],['defaultAssistant','assistant'],['defaultGroup','group'],['defaultVipNumber','vipNumber'],['defaultStatus','status'],['defaultRegistered','registered'],['defaultPhase','phase']]){const control=$(`#${id}`);if(control&&saved[key]!=null){if(control.tagName==='SELECT'&&saved[key]&&!Array.from(control.options).some(option=>option.value===saved[key]))control.insertAdjacentHTML('beforeend',`<option>${esc(saved[key])}</option>`);control.value=saved[key];}}const sourceSelect=$('#defaultSource'),statusSelect=$('#defaultStatus');if(sourceSelect)sourceSelect.innerHTML=sources.map(value=>`<option ${value===saved.source?'selected':''}>${esc(value)}</option>`).join('');if(statusSelect){statusSelect.innerHTML=[...new Set([...statuses,...(saved.status?[saved.status]:[])])].map(value=>`<option>${esc(value)}</option>`).join('');statusSelect.value=saved.status||((sourceSelect?.value||'单导')==='群粉'?'在群':'未进群');}$('#defaultHot').checked=Boolean(saved.hot);$('#defaultInvestor').checked=Boolean(saved.investor);$('#defaultNote').value=saved.note||'';
    replaceIntakeSelectWithInput('defaultAssistant','defaultAssistantOptions',assistants,'选择或输入助理');if(saved.assistant)$('#defaultAssistant').value=saved.assistant;if(saved.page)$('#defaultPage').value=saved.page;if($('#manualRegistered')){$('#manualRegistered').checked=Boolean(saved.manualRegistered);if(!saved.manualRegistered)$('#defaultRegistered').value=today;$('#defaultRegistered').disabled=!saved.manualRegistered;}
    const firstFollow=$('[data-toggle]');if(firstFollow){const enabled=state.settings.autoInitialFollow!==false;firstFollow.classList.toggle('on',enabled);firstFollow.setAttribute('aria-pressed',String(enabled));}const assistantInput=$('#defaultAssistant');if(assistantInput&&!assistantInput.value&&$('#defaultPage')?.value){const suggestion=preferredAssistantForPage($('#defaultPage').value,sourceSelect?.value);if(suggestion){assistantInput.value=suggestion;state.settings.lastSuggestedAssistant=suggestion;state.settings.intakeDefaults={...saved,assistant:suggestion};}}
    const textarea=$('#intakeText');if(textarea){textarea.addEventListener('input',()=>{state.intakeText=textarea.value;const cleaned=textarea.value.replace(/[\u200B\uFEFF]/g,'').replace(/[，、；|]+/g,',').replace(/\r\n/g,'\n').split('\n').map(line=>line.includes('\t')?line.split('\t').map(cell=>cell.trim()).join('\t'):line.replace(/[ \t]+/g,' ')).join('\n');if(cleaned!==textarea.value){const pos=textarea.selectionStart;textarea.value=cleaned;textarea.setSelectionRange(Math.min(pos,cleaned.length),Math.min(pos,cleaned.length));state.intakeText=cleaned;}scheduleIntakeDraft();scheduleIntakeRender();});textarea.addEventListener('paste',event=>{const clip=event.clipboardData?.getData('text');if(!clip)return;event.preventDefault();const start=textarea.selectionStart,end=textarea.selectionEnd,pasted=normalizeIntakePaste(clip),withNextLine=pasted.endsWith('\n')?pasted:`${pasted}\n`;textarea.setRangeText(withNextLine,start,end,'end');state.intakeText=textarea.value;scheduleIntakeDraft();scheduleIntakeRender();});}
    const persistDefaults=()=>{state.settings.intakeDefaults=currentIntakeDefaults();scheduleIntakeDraft();};sourceSelect?.addEventListener('change',()=>{if(sourceSelect.value==='群粉')$('#defaultStatus').value='在群';else $('#defaultStatus').value='未进群';persistDefaults();});$('#defaultPage')?.addEventListener('change',()=>{const assistant=$('#defaultAssistant'),suggestion=preferredAssistantForPage($('#defaultPage').value,sourceSelect?.value);if(assistant&&suggestion&&(!assistant.value||assistant.value===state.settings.lastSuggestedAssistant)){assistant.value=suggestion;state.settings.lastSuggestedAssistant=suggestion;}persistDefaults();});['defaultAssistant','defaultGroup','defaultVipNumber','defaultStatus','defaultPhase','defaultNote','defaultRegistered','manualRegistered','defaultHot','defaultInvestor'].forEach(id=>$(`#${id}`)?.addEventListener('change',()=>{if(id==='manualRegistered'){const manual=$('#manualRegistered').checked;$('#defaultRegistered').disabled=!manual;if(!manual)$('#defaultRegistered').value=today;}if(id==='defaultVipNumber')revalidateIntakeRows();persistDefaults();}));
  }
  function newCustomerModal(){openModal('新增客户','填写最常用资料，其他分类信息可以稍后补充。',`<div class="filter-grid" style="grid-template-columns:repeat(2,1fr)"><label class="filter-field"><span>客户姓名</span><input id="newName" placeholder="姓名"></label><label class="filter-field"><span>手机号码</span><input id="newPhone" placeholder="原始号码"></label><label class="filter-field"><span>渠道</span><select id="newSource">${sources.map(value=>`<option>${esc(value)}</option>`).join('')}</select></label><label class="filter-field"><span>页面（可不选）</span><select id="newPage"><option value="">不分页面</option>${pages.map(value=>`<option>${esc(value)}</option>`).join('')}</select></label><label class="filter-field"><span>跟进助理</span><select id="newAssistant">${assistants.map(value=>`<option>${esc(value)}</option>`).join('')}</select></label><label class="filter-field"><span>进群状态</span><select id="newStatus">${statuses.map(value=>`<option>${esc(value)}</option>`).join('')}</select></label><label class="filter-field"><span>资质评级</span><select id="newQualification">${qualifications.map(value=>`<option>${esc(value)}</option>`).join('')}</select></label><label class="filter-field"><span>VIP 编号（可选）</span><input id="newVipNumber" maxlength="64" placeholder="例如 VIP-001"></label></div>`,`<button class="btn" data-action="close-modal">取消</button><button class="btn primary" data-action="create-customer">保存客户</button>`);const source=$('#newSource'),status=$('#newStatus');if(source&&status){const syncDefault=()=>{status.value=source.value==='群粉'?'在群':'未进群';};syncDefault();source.addEventListener('change',syncDefault);}}

  function renderFollowups(){
    const tab=state.followTab||'open';const seven=localDateOffset(7);const dueList=activeCustomers().filter(c=>isValidDateKey(c.due));
    const list=dueList.filter(c=>tab==='overdue'?c.due<today:tab==='today'?c.due===today:tab==='week'?c.due>today&&c.due<=seven:tab==='none'?false:tab==='done'?false:c.due<=today).sort((a,b)=>(a.due||'').localeCompare(b.due||''));
    const tabs=[['open','待处理'],['overdue','已逾期'],['today','今天'],['week','未来7天'],['none','未安排'],['done','已完成']];
    const bar=`<div class="subnav">${tabs.map(([key,label])=>`<button class="${tab===key?'active':''}" data-follow-tab="${key}">${label}</button>`).join('')}</div>`;
    const summary=`<div class="business-summary"><div class="business-kpi"><span>待处理</span><strong>${dueList.filter(c=>c.due<=today).length}</strong></div><div class="business-kpi"><span>已逾期</span><strong>${dueList.filter(c=>c.due<today).length}</strong></div><div class="business-kpi"><span>今日计划</span><strong>${dueList.filter(c=>c.due===today).length}</strong></div><div class="business-kpi"><span>未安排</span><strong>${activeCustomers().filter(c=>!c.due||c.due==='—').length}</strong></div></div>`;
    let content='';
    if(tab==='none')content=simpleCustomerTable(activeCustomers().filter(c=>!c.due||c.due==='—'),'follow');
    else if(tab==='done'){
      const events=[...state.followups].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
      const customerById=new Map(state.customers.map(customer=>[String(customer.id),customer]));const pageCount=Math.max(1,Math.ceil(events.length/state.perPage));state.page=Math.min(pageCount,Math.max(1,Math.trunc(Number(state.page)||1)));const start=(state.page-1)*state.perPage;const visible=events.slice(start,start+state.perPage);const rows=visible.map(event=>{const customer=customerById.get(String(event.customerId));return `<tr ${customer?`data-customer="${esc(customer.id)}"`:''}><td>${esc(customer?.name||event.customer||'客户记录')}</td><td class="phone-cell">${esc(customer?.rawPhone||event.phone||'')}</td><td>${esc(event.date||'')}</td><td>${esc(event.method||'')}</td><td>${esc(event.result||event.note||'')}</td><td>${esc(event.nextDate||'—')}</td></tr>`}).join('');
      content=`<section class="panel table-panel"><div class="table-toolbar"><div class="table-context"><strong>已登记跟进</strong><span>${events.length} 条记录</span></div></div><div class="table-scroll"><table class="data-table"><thead><tr><th>客户</th><th>号码</th><th>跟进时间</th><th>方式</th><th>结果与备注</th><th>下次跟进</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="muted-cell">还没有已完成的跟进记录</td></tr>'}</tbody></table></div><div class="table-footer"><span>显示 ${events.length?start+1:0}–${Math.min(start+state.perPage,events.length)} 条，共 ${events.length} 条</span><div class="pagination"><button class="page-btn" data-page="${Math.max(1,state.page-1)}">‹</button><span>${state.page} / ${pageCount}</span><button class="page-btn" data-page="${Math.min(pageCount,state.page+1)}">›</button></div></div></section>`;
    }else content=simpleCustomerTable(list,'follow');
    $('#viewContainer').innerHTML=heading('客户跟进',tab==='done'?'已登记的跟进记录 · 每次沟通独立留痕':'按客户计划日期跟进 · 这里的数量为客户数，非任务数',tab==='done'?btn('导出跟进记录','download','export-filtered'):btn('批量排期','calendar','batch-follow'))+bar+summary+content;
  }
  function simpleCustomerTable(list,kind){const vip=kind==='vip',follow=kind==='follow',pageCount=follow?Math.max(1,Math.ceil(list.length/state.perPage)):1;if(follow)state.page=Math.min(pageCount,Math.max(1,Math.trunc(Number(state.page)||1)));const start=follow?(state.page-1)*state.perPage:0,visible=follow?list.slice(start,start+state.perPage):list.slice(0,100);const headers=vip?['客户','VIP编号','号码','渠道','页面','跟进助理','客户阶段','登记日期','下次跟进','操作']:['客户','号码','渠道','页面','跟进助理','客户阶段','计划日期','跟进内容','操作'];return `<section class="panel table-panel"><div class="table-toolbar"><div class="table-context"><strong>${kind==='follow'?'近期跟进计划':'客户明细'}</strong><span>${list.length} 条</span></div><label class="input-search">${icons('search')}<input data-search="module" placeholder="搜索客户"></label></div><div class="table-scroll"><table class="data-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${visible.map(c=>vip?`<tr data-customer="${esc(c.id)}"><td><div class="customer-name-cell">${customerAvatarHtml(c)}<strong>${esc(customerName(c))}</strong></div></td><td><span class="status-tag tag-amber">${esc(c.vipNumber)}</span></td><td class="phone-cell">${esc(c.rawPhone||c.phone||'')}</td><td>${sourceTag(c.source)}</td><td>${esc(c.page||'—')}</td><td>${esc(c.assistant||'未分配')}</td><td>${phaseTag(c.phase)}</td><td>${esc(c.registered||'—')}</td><td><span class="status-tag ${c.due&&c.due<today?'tag-red':'tag-blue'}">${esc(c.due||'未安排')}</span></td><td><button class="table-action" data-action="follow" data-id="${esc(c.id)}">登记跟进</button><button class="table-action danger-text" data-action="clear-vip" data-id="${esc(c.id)}">移出 VIP</button></td></tr>`:`<tr data-customer="${esc(c.id)}"><td><div class="customer-name-cell">${customerAvatarHtml(c)}<strong>${esc(customerName(c))}</strong></div></td><td class="phone-cell">${esc(c.rawPhone)}</td><td>${sourceTag(c.source)}</td><td>${esc(c.page||'—')}</td><td>${esc(c.assistant)}</td><td>${phaseTag(c.phase)}</td><td><span class="status-tag ${c.due<today?'tag-red':'tag-blue'}">${esc(c.due)}</span></td><td>${esc(c.note)}</td><td>${kind==='hot'?`<button class="table-action" data-action="toggle-hot" data-id="${esc(c.id)}">取消热聊</button>`:`<button class="table-action" data-action="follow" data-id="${esc(c.id)}">登记</button>`}</td></tr>`).join('')}</tbody></table></div><div class="table-footer"><span>${follow?`显示 ${list.length?start+1:0}–${Math.min(start+state.perPage,list.length)} 条，共 ${list.length} 位客户`:`本地查询 · ${list.length} 条记录`}</span>${follow?`<div class="pagination"><button class="page-btn" data-page="${Math.max(1,state.page-1)}" ${state.page===1?'disabled':''} aria-label="上一页">‹</button>${paginationButtons(pageCount)}<span>${state.page} / ${pageCount}</span><button class="page-btn" data-page="${Math.min(pageCount,state.page+1)}" ${state.page===pageCount?'disabled':''} aria-label="下一页">›</button><select class="compact-select page-size" aria-label="每页客户数量">${[10,20,50,100].map(size=>`<option ${state.perPage===size?'selected':''}>${size}</option>`).join('')}</select></div>`:''}${btn('导出清单','download','export-filtered','small')}</div></section>`;}
  function daysSinceFollow(customer){const date=String(customer.lastFollow||customer.registered||'').slice(0,10);const stamp=Date.parse(`${date}T00:00:00Z`);return Number.isFinite(stamp)?Math.floor((Date.parse(`${today}T00:00:00Z`)-stamp)/86400000):null;}
  function staleHotCustomers(){return activeCustomers().filter(c=>c.hot&&(daysSinceFollow(c)??-1)>3);}
  function renderVip(){const all=activeCustomers().filter(c=>String(c.vipNumber||'').trim()),filter=state.vipFilter||'all',todayList=all.filter(c=>c.registered===today),unfollowed=all.filter(c=>!c.lastFollow||c.lastFollow<today),list=filter==='today'?todayList:filter==='unfollowed'?unfollowed:all;const tabs=[['all','全部 VIP',all.length],['today','今日新增',todayList.length],['unfollowed','待跟进',unfollowed.length]];$('#viewContainer').innerHTML=heading('VIP 管理','VIP 是客户标签与编号，不单独成群；号码仍在同一份客户主档中维护，不创建第二套客户资料',btn('设置 VIP','plus','new-vip','primary'))+`<div class="business-summary"><div class="business-kpi"><span>VIP 客户</span><strong>${all.length}</strong></div><div class="business-kpi"><span>今日新增</span><strong>${todayList.length}</strong></div><div class="business-kpi"><span>待跟进</span><strong>${unfollowed.length}</strong></div><div class="business-kpi"><span>已登记编号</span><strong>${new Set(all.map(c=>String(c.vipNumber).trim()).filter(Boolean)).size}</strong></div></div><div class="subnav">${tabs.map(([key,label,count])=>`<button class="${filter===key?'active':''}" data-vip-filter="${key}">${label} ${count}</button>`).join('')}</div>${simpleCustomerTable(list,'vip')}`;}
  function renderHot(){const all=activeCustomers().filter(c=>c.hot),business=businessSummaryIndex(),hasDeposit=c=>customerBusinessSummary(c,business).deposit;const filter=state.hotFilter||'all';const list=(filter==='stale'?staleHotCustomers():filter==='today'?all.filter(c=>c.registered===today):filter==='not-joined'?all.filter(c=>!['已进群','在群'].includes(c.status)):filter==='not-deposit'?all.filter(c=>!hasDeposit(c)):all);const tabs=[['all','全部热聊'],['today','今日新增'],['stale','超过3天未跟进'],['not-joined','未进群'],['not-deposit','未入金']];$('#viewContainer').innerHTML=heading('热聊管理','独立追踪重点沟通客户与转化进展',btn('标记热聊客户','plus','new-hot','primary'))+`<div class="business-summary"><div class="business-kpi"><span>当前热聊</span><strong>${all.length}</strong></div><div class="business-kpi"><span>超过3天未跟进</span><strong>${staleHotCustomers().length}</strong></div><div class="business-kpi"><span>已进群</span><strong>${all.filter(c=>['已进群','在群'].includes(c.status)).length}</strong></div><div class="business-kpi"><span>已入金</span><strong>${all.filter(hasDeposit).length}</strong></div></div><div class="subnav">${tabs.map(([key,label])=>`<button class="${filter===key?'active':''}" data-hot-filter="${key}">${label}</button>`).join('')}</div>${simpleCustomerTable(list,'hot')}`;}
  function customerPickerHtml(id,customers,selectedId='',label='选择客户'){const sorted=customers.slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-CN')),selected=sorted.find(c=>sameId(c.id,selectedId)),display=c=>`${c.name||'未命名'} · ${c.rawPhone||c.phone||'无号码'} · ${c.source||'未分类'}${c.page?` · ${c.page}`:''}`;return `<label class="filter-field"><span>${label}</span><input id="${id}Search" data-customer-picker="${id}" list="${id}Options" value="${selected?esc(display(selected)):''}" placeholder="输入姓名或号码搜索" autocomplete="off"><input id="${id}" type="hidden" value="${selected?esc(selected.id):''}"><datalist id="${id}Options">${sorted.map(c=>`<option value="${esc(display(c))}" data-id="${esc(c.id)}"></option>`).join('')}</datalist><small class="input-hint">可输入姓名、完整或部分号码，再从建议中选择。</small></label>`;}
  function syncCustomerPicker(input){const id=input.dataset.customerPicker,hidden=$(`#${id}`),options=[...document.querySelectorAll(`#${id}Options option`)];if(!hidden)return;const value=input.value.trim().toLocaleLowerCase(),exact=options.find(option=>option.value.toLocaleLowerCase()===value),matches=options.filter(option=>option.value.toLocaleLowerCase().includes(value));hidden.value=exact?.dataset.id||(value&&matches.length===1?matches[0].dataset.id:'');}
  function vipCustomerModal(){const available=activeCustomers();openModal('设置 VIP 编号',available.length?`选择客户并填写 VIP 编号 · ${available.length} 位客户`:'当前没有可设置的客户',available.length?`${customerPickerHtml('vipCustomer',available)}<label class="filter-field"><span>VIP 编号</span><input id="vipNumber" maxlength="64" placeholder="例如 VIP-001"></label><p class="input-hint">同一个 VIP 编号不能重复分配给不同客户；清空编号可从 VIP 类别移除。</p>`:'<div class="empty-state">客户库中还没有可设置的客户。</div>',`<button class="btn" data-action="close-modal">取消</button><button class="btn primary" data-action="confirm-new-vip" ${available.length?'':'disabled'}>保存 VIP 编号</button>`);}
  async function setCustomerVip(id,value){const customer=state.customers.find(item=>String(item.id)===String(id)&&!item.deleted);if(!customer){toast('找不到这位客户，请刷新后重试','x');return;}const vipNumber=String(value||'').trim().slice(0,64);if(vipNumber&&state.customers.some(item=>item.id!==customer.id&&!item.deleted&&String(item.vipNumber||'').trim().toLocaleLowerCase()===vipNumber.toLocaleLowerCase())){toast('这个 VIP 编号已属于其他客户','x');return;}if(String(customer.vipNumber||'').trim()===vipNumber){toast(vipNumber?'该客户已经是此 VIP 编号':'该客户当前没有 VIP 编号');return;}if(!await snapshotBeforeWrite(`${vipNumber?'设置':'移除'} VIP 编号前自动快照`))return;const before=customer.vipNumber,previousTouched=customer.touched,previousActivities=state.activities.slice();if(vipNumber)customer.vipNumber=vipNumber;else delete customer.vipNumber;customer.touched=true;persist();activity(`${vipNumber?'设置':'移除'} ${customer.name} 的 VIP 编号${vipNumber?`：${vipNumber}`:''}`);try{await flushStateWrites();}catch(error){if(before===undefined)delete customer.vipNumber;else customer.vipNumber=before;customer.touched=previousTouched;state.activities=previousActivities;persist();render();toast(`保存失败，VIP 状态已恢复：${error.message||'本机数据暂不可写'}`,'x');return;}closeModal();render();toast(vipNumber?`${customer.name} 已加入 VIP`:`${customer.name} 已移出 VIP`);}
  function hotCustomerModal(){const available=activeCustomers().filter(customer=>!customer.hot);openModal('标记热聊客户',available.length?`搜索并选择客户 · ${available.length} 位尚未标记`:'当前没有可标记的客户',available.length?`${customerPickerHtml('hotCustomer',available)}<p class="input-hint">已是热聊的客户不会重复加入。标记后会保留客户原有渠道、状态和跟进资料。</p>`:'<div class="empty-state"><div class="empty-icon">'+icons('message')+'</div><h2>没有待标记客户</h2><p>客户库中的客户都已标记为热聊，或尚未录入客户。</p></div>',`<button class="btn" data-action="close-modal">取消</button><button class="btn primary" data-action="confirm-new-hot" ${available.length?'':'disabled'}>标记为热聊</button>`);}
  async function setCustomerHot(id,hot){const customer=state.customers.find(item=>String(item.id)===String(id)&&!item.deleted);if(!customer){toast('找不到这位客户，请刷新后重试','x');return;}if(Boolean(customer.hot)===hot){toast(hot?'该客户已标记为热聊':'该客户已不是热聊客户');return;}const previous=customer.hot,previousTouched=customer.touched,previousActivities=state.activities.slice();customer.hot=hot;customer.touched=true;persist();activity(`${hot?'将':'取消'} ${customer.name} 的热聊标记`);try{await flushStateWrites();}catch(error){customer.hot=previous;customer.touched=previousTouched;state.activities=previousActivities;persist();toast(`保存失败，热聊状态已恢复：${error.message||'本机数据暂不可写'}`,'x');render();return;}closeModal();render();toast(`${hot?'已标记':'已取消'} ${customer.name}${hot?'为热聊':''}`);}
  async function setCustomerFavorite(id,favorite){const customer=state.customers.find(item=>String(item.id)===String(id)&&!item.deleted);if(!customer)return;const previous=Boolean(customer.favorite),previousTouched=customer.touched,previousActivities=state.activities.slice();customer.favorite=Boolean(favorite);customer.touched=true;persist();activity(`${customer.favorite?'标记':'取消'}重点关注客户：${customer.name}`);try{await flushStateWrites();}catch(error){customer.favorite=previous;customer.touched=previousTouched;state.activities=previousActivities;persist();render();toast('重点关注状态保存失败，已恢复','x');return;}render();if($('#customerDrawer')?.classList.contains('open'))showCustomer(customer);toast(customer.favorite?'已加入重点关注':'已取消重点关注');}
  // V5.0 §16/§19 字段锁定：写入失败时恢复原状态，不显示虚假的成功提示。
  async function setCustomerFieldLock(id,field){
    const customer=state.customers.find(item=>String(item.id)===String(id)&&!item.deleted);
    if(!customer)return;
    const engine=window.ZhikeFieldLocks;
    if(!engine||typeof engine.toggleLock!=='function'){toast('字段锁定模块未加载，请重新打开应用。','x');return;}
    const previous=Array.isArray(customer.manualLockedFields)?customer.manualLockedFields.slice():undefined;
    const previousTouched=customer.touched,previousActivities=state.activities.slice();
    const result=engine.toggleLock(customer,field);
    if(!result.changed){toast('该字段不支持锁定。','x');return;}
    customer.touched=true;
    persist();
    activity(`${result.locked?'锁定':'解锁'}客户字段：${customer.name||customer.id}`);
    try{await flushStateWrites();}
    catch(error){customer.manualLockedFields=previous;customer.touched=previousTouched;state.activities=previousActivities;persist();render();toast('字段锁定保存失败，已恢复原状态','x');return;}
    render();
    if($('#customerDrawer')?.classList.contains('open'))showCustomer(customer);
    toast(result.locked?'已锁定该字段，AI 与导入不会再改写':'已解锁该字段');
  }
  async function saveCustomerQualification(id){const customer=state.customers.find(item=>sameId(item.id,id)&&!item.deleted),value=$('#drawerQualification')?.value;if(!customer||!qualifications.includes(value)){toast('请选择有效的资质评级','x');return;}if((customer.qualification||'待评估')===value){toast('资质评级没有变化');return;}if(!await snapshotBeforeWrite('修改客户资质评级前自动快照'))return;const previous=customer.qualification||'待评估',beforeHistory=cloneStateData(customer.qualificationHistory||[]),previousUpdatedAt=customer.qualificationUpdatedAt,previousTouched=customer.touched,previousActivities=state.activities.slice();customer.qualification=value;customer.qualificationUpdatedAt=new Date().toISOString();customer.qualificationHistory=[...beforeHistory,{id:`Q${Date.now()}-${Math.random().toString(36).slice(2,7)}`,from:previous,to:value,at:customer.qualificationUpdatedAt,date:today}].slice(-50);customer.touched=true;persist();activity(`更新 ${customer.name} 的资质评级：${previous} → ${value}`);try{await flushStateWrites();}catch{customer.qualification=previous;customer.qualificationHistory=beforeHistory;if(previousUpdatedAt===undefined)delete customer.qualificationUpdatedAt;else customer.qualificationUpdatedAt=previousUpdatedAt;customer.touched=previousTouched;state.activities=previousActivities;persist();showCustomer(customer);toast('资质评级保存失败，已恢复原值','x');return;}showCustomer(customer);render();toast(`资质评级已更新为：${value}`);}
  const ticketRecords=window.ZhikeTicketRecords||{};
  const normalizeTicketRecord=record=>ticketRecords.normalizeTicketRecord?ticketRecords.normalizeTicketRecord(record):record;
  const expandTicketRecords=record=>ticketRecords.expandTicketRecord?ticketRecords.expandTicketRecord(record):[normalizeTicketRecord(record)];
  const effectiveTicketDate=record=>ticketRecords.effectiveTicketDate?ticketRecords.effectiveTicketDate(record):String(record?.date||'').slice(0,10);
  const businessKey=record=>String(record.customerId||String(record.phone||'').replace(/\D/g,'').replace(/^91(?=\d{10}$)/,''));
  const businessRecordSignature=(record,kind)=>{const clean=value=>String(value??'').trim().toLocaleLowerCase();if(kind==='ticket'&&ticketRecords.ticketRecordKey)return ticketRecords.ticketRecordKey(record);const customer=clean(record?.customerId||record?.customer||record?.phone),date=clean(String(record?.date||'').slice(0,10));if(kind==='deposit'){const base=[customer,date,clean(record?.amount),clean(record?.currency||'INR')],ref=clean(record?.externalRef||record?.tradeRef);return ref?[...base,'ref',ref].join('|'):base.join('|');}if(kind==='registration'){const base=[customer,date,clean(record?.status||'已报名'),clean(record?.source)],ref=clean(record?.externalRef||record?.tradeRef);return ref?[...base,'ref',ref].join('|'):[...base,clean(record?.note)].join('|');}if(kind==='followup')return [customer,date,clean(record?.method),clean(record?.result||record?.note),clean(record?.nextDate)].join('|');return [customer,date,clean(record?.product||'未指定'),clean(record?.direction||'')].join('|');};
  const ticketDirectionKey=value=>ticketRecords.normalizeDirection?ticketRecords.normalizeDirection(value):(()=>{const text=String(value??'').trim().toLocaleLowerCase();if(!text)return '关注';if(/^(买入|购买|购入|买|buy|b)$/.test(text))return '买入';if(/^(卖出|卖|sell|s)$/.test(text))return '卖出';if(/^(关注|观察|持有|watch|hold|h)$/.test(text))return '关注';return String(value??'').trim();})();
  const recordAmount=record=>Number(record.amount)||((Number(record.shares)||0)*(Number(record.price)||Number(record.buy_price)||0));
  function renderBusiness(kind){
    const isTicket=kind==='tickets',list=activeCustomers(),activeIds=new Set(list.map(customer=>String(customer.id))),activePhones=new Set(list.map(customer=>phoneForQuality(customer)).filter(Boolean));if(businessRecordsCache.revision!==state.dataRevision){businessRecordsCache={revision:state.dataRevision,tickets:state.tickets.flatMap(record=>expandTicketRecords(record)),deposits:state.deposits.slice()};}const allRecords=isTicket?businessRecordsCache.tickets:businessRecordsCache.deposits,records=allRecords.filter(record=>activeIds.has(String(record.customerId))||activePhones.has(phoneForQuality(record))),title=isTicket?'跟票管理':'入金管理',recordCount=records.length;
    const recordDate=record=>isTicket?effectiveTicketDate(record):String(record?.date||'').slice(0,10);const confirmed=records.filter(record=>record.status!=='待确认');const todayRows=confirmed.filter(r=>recordDate(r)===today);const weekStart=localDateOffset(-6);const weekRows=confirmed.filter(r=>recordDate(r)>=weekStart&&recordDate(r)<=today);const monthRows=confirmed.filter(r=>recordDate(r).slice(0,7)===today.slice(0,7));
    const distinct=rows=>new Set(rows.map(businessKey).filter(Boolean)).size;const labels=isTicket?['今日跟票客户','近7天跟票次数','本月跟票金额','待确认记录']:['今日入金客户','近7天入金金额','本月入金金额','入金客户数'];
    const vals=isTicket?[distinct(todayRows),weekRows.length,money(monthRows.reduce((sum,r)=>sum+recordAmount(r),0)),records.filter(r=>r.status==='待确认').length]:[distinct(todayRows),money(weekRows.reduce((sum,r)=>sum+recordAmount(r),0)),money(monthRows.reduce((sum,r)=>sum+recordAmount(r),0)),distinct(confirmed)];
    let rows=records.filter(r=>state.businessPeriod==='today'?recordDate(r)===today:state.businessPeriod==='week'?recordDate(r)>=weekStart&&recordDate(r)<=today:state.businessPeriod==='month'?recordDate(r).slice(0,7)===today.slice(0,7):state.businessPeriod==='pending'?r.status==='待确认':true);
    if(state.businessAssistant!=='全部')rows=rows.filter(r=>r.assistant===state.businessAssistant);
    if(state.businessChannel!=='全部')rows=rows.filter(r=>r.channel===state.businessChannel);
    const productFilter=isTicket?String(state.businessProductFilter||'').trim().toLocaleLowerCase():'',directionFilter=isTicket?String(state.businessDirectionFilter||'全部'):'全部';
    if(isTicket&&productFilter)rows=rows.filter(r=>String(r.product||'未指定').trim().toLocaleLowerCase()===productFilter);
    if(isTicket&&directionFilter!=='全部')rows=rows.filter(r=>ticketDirectionKey(r.direction)===directionFilter);
     const productOptions=isTicket?[...new Map(records.map(r=>String(r.product||'未指定').trim()).filter(Boolean).map(value=>[value.toLocaleLowerCase(),value])).values()].sort((a,b)=>a.localeCompare(b,'zh-CN')):[];
     const customersById=new Map(list.map(customer=>[String(customer.id),customer])),customersByPhone=new Map(list.filter(customer=>customer.phone).map(customer=>[String(customer.phone),customer]));
     const moduleQuery=String(state.businessSearch||'').trim().toLocaleLowerCase();
     rows=rows.map(r=>{const phone=phoneForQuality(r),customer=customersById.get(String(r.customerId))||customersByPhone.get(phone);return {...r,customer:r.customer||customer?.name||'未关联客户',phone:r.phone||customer?.rawPhone||'',assistant:r.assistant||customer?.assistant||'',channel:r.channel||customer?.channel||'',group:r.group||customer?.group||'—',customerId:r.customerId||customer?.id};}).filter(r=>!moduleQuery||matchesExportSearch([r.customer,r.phone,r.date,r.buyDate,r.sellDate,r.product,r.direction,r.amount,r.assistant,r.channel,r.group,r.status,r.note],moduleQuery));
      const filteredRecordCount=rows.length,filterActive=Boolean(state.businessPeriod!=='all'||state.businessAssistant!=='全部'||state.businessChannel!=='全部'||(isTicket&&(productFilter||directionFilter!=='全部'))||moduleQuery);
     rows=rows.slice(0,200);
    const body=rows.length?rows.map(r=>`<tr ${r.customerId?`data-customer="${esc(r.customerId)}"`:''}><td>${esc(r.customer||r.name)}</td><td class="phone-cell">${esc(r.phone||'')}</td>${isTicket?`<td>${esc(r.buyDate||'—')}</td><td>${esc(r.sellDate||'—')}</td><td>${esc(r.product||'—')}</td><td>${esc(r.direction||'—')}</td>`:`<td>${esc(r.date||today)}</td><td>${money(r.amount)}</td>`}<td>${esc(r.assistant||'')}</td><td>${esc(r.channel||'')}</td><td>${esc(r.group||'—')}</td><td><span class="status-tag ${r.status==='待确认'?'tag-amber':'tag-green'}">${esc(r.status||'已确认')}</span></td><td>${esc(r.note||'')}</td><td><button class="table-action danger-text" data-action="delete-business-record" data-kind="${isTicket?'ticket':'deposit'}" data-id="${esc(r.id)}">删除</button></td></tr>`).join(''):`<tr><td colspan="${isTicket?12:10}" style="text-align:center;padding:36px;color:#9aa4b1">暂无${isTicket?'跟票':'入金'}记录，可从客户档案新增</td></tr>`;
    const heads=(isTicket?['客户','号码','买入日期','卖出日期','产品/代码','方向','助理','来源渠道','群编号','状态','备注']:['客户','号码','入金日期','入金金额','助理','来源渠道','群编号','状态','备注']).concat('操作'),actions=`${isTicket?`<button class="btn" data-action="import-tickets">${icons('upload')}导入跟票</button><input id="ticketImportFile" type="file" accept=".csv,.tsv,.xlsx,.xls,.xlsm" hidden>`:''}${btn(isTicket?'新增跟票':'新增入金','plus',isTicket?'new-ticket':'new-deposit','primary')}`;
     $('#viewContainer').innerHTML=heading(title,isTicket?'跟票记录实时关联有效客户，支持 CSV 与 Excel 导入':'入金记录实时关联有效客户',actions)+`<div class="subnav"><button class="active">全部${isTicket?'跟票':'入金'}</button><button>今日</button><button>本周</button><button>本月</button><button>待确认</button><button>按助理</button><button>按来源</button></div><div class="business-summary">${labels.map((l,i)=>`<div class="business-kpi"><span>${l}</span><strong>${vals[i]}</strong></div>`).join('')}</div><div class="two-col-content"><section class="panel table-panel"><div class="table-toolbar"><div class="table-context"><strong>${isTicket?'跟票明细':'入金明细'}</strong><span>${filterActive?`筛选后 ${filteredRecordCount} / ${recordCount} 条`:`${recordCount} 条有效记录`}${filteredRecordCount>200?' · 当前列表显示前 200 条，导出可取全部':''}</span></div><div class="toolbar-controls"><label class="input-search">${icons('search')}<input data-search="module" value="${esc(state.businessSearch||'')}" placeholder="搜索客户、号码、助理"></label>${isTicket?`<select class="compact-select" data-business-product-filter aria-label="股票代码分类"><option value="">全部股票</option>${productOptions.map(value=>`<option value="${esc(value)}" ${productFilter===value.toLocaleLowerCase()?'selected':''}>${esc(value)}</option>`).join('')}</select><select class="compact-select" data-business-direction-filter aria-label="跟票方向"><option value="全部" ${directionFilter==='全部'?'selected':''}>全部方向</option><option value="买入" ${directionFilter==='买入'?'selected':''}>只看买入</option><option value="卖出" ${directionFilter==='卖出'?'selected':''}>只看卖出</option><option value="关注" ${directionFilter==='关注'?'selected':''}>只看关注</option></select>`:''}${btn('导出','download','export-filtered','small')}</div></div><div class="table-scroll" style="max-height:calc(100vh - 350px)"><table class="data-table"><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div></section><section class="panel compact-panel"><div class="panel-heading"><h2 class="panel-title">本地业务概况</h2></div><div class="funnel-content"><div class="funnel-row"><span style="width:80px;color:#748094;font-size:9px">客户总数</span><div class="bar-small" style="flex:1"><i style="width:100%"></i></div><b>${list.length}</b></div><div class="funnel-row"><span style="width:80px;color:#748094;font-size:9px">热聊客户</span><div class="bar-small" style="flex:1"><i style="width:${Math.max(0,counts().hot/Math.max(1,list.length)*100)}%"></i></div><b>${counts().hot}</b></div><div class="funnel-row"><span style="width:80px;color:#748094;font-size:9px">${isTicket?'跟票客户':'入金客户'}</span><div class="bar-small" style="flex:1"><i style="width:${Math.max(0,(isTicket?counts().ticket:counts().deposit)/Math.max(1,list.length)*100)}%"></i></div><b>${isTicket?counts().ticket:counts().deposit}</b></div><div class="notice-line">客户移入回收站后关联业务暂时隐藏；恢复客户后自动恢复显示。</div></div></section></div>`;
  }
  function filterRenderedTable(input){const panel=input.closest('.panel');const tbody=panel?.querySelector('.data-table tbody');if(!tbody)return;const rows=[...tbody.querySelectorAll('tr:not(.module-search-empty)')].filter(row=>!row.querySelector('.muted-cell'));if(!rows.length)return;const query=input.value.trim().toLocaleLowerCase();let visible=0;for(const row of rows){const match=!query||row.textContent.toLocaleLowerCase().includes(query);row.hidden=!match;if(match)visible++;}let empty=tbody.querySelector('.module-search-empty');if(!empty){empty.hidden=!query||visible>0;}else{empty=document.createElement('tr');empty.className='module-search-empty';empty.hidden=true;const cell=document.createElement('td');cell.className='muted-cell';cell.colSpan=Math.max(1,panel.querySelectorAll('.data-table thead th').length);cell.textContent='没有匹配的记录';empty.append(cell);tbody.append(empty);empty.hidden=!query||visible>0;}const count=panel.querySelector('.table-toolbar .table-context span');if(count){if(!count.dataset.searchBase)count.dataset.searchBase=count.textContent;count.textContent=query?`筛选后 ${visible} / ${rows.length} 条`:count.dataset.searchBase;}}
  let groupMembershipEventSyncAt=0,groupMembershipEventSyncPromise=null;
  async function refreshGroupMembershipEvents(force=false){
    if(typeof fetch!=='function'||!window.__LOCAL_DB__)return null;
    const now=Date.now();
    if(!force&&(now-groupMembershipEventSyncAt<3000||groupMembershipEventSyncPromise))return groupMembershipEventSyncPromise;
    groupMembershipEventSyncPromise=fetch('/api/ws/group-membership-events?limit=20000',{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error('群组进退事件同步失败');return response.json();}).then(result=>{state.wsGroupMembershipEvents=normalizeObjectRows(result?.events);groupMembershipEventSyncAt=Date.now();if(state.view==='groups')render();return state.wsGroupMembershipEvents;}).catch(error=>{console.warn('[groups] server membership event sync unavailable',error);groupMembershipEventSyncAt=Date.now();return null;}).finally(()=>{groupMembershipEventSyncPromise=null;});
    return groupMembershipEventSyncPromise;
  }
  function groupMembershipEventRows(){
    const rows=[],seen=new Set();
    for(const event of [...normalizeObjectRows(state.settings.groupMembershipEvents),...normalizeObjectRows(state.wsGroupMembershipEvents)]){
      const type=String(event?.type||event?.eventType||'').toLocaleLowerCase();
      if(!event||!['joined','left'].includes(type))continue;
      const key=String(event.id||event.idempotencyKey||`${event.customerId||''}\u0000${event.groupJid||event.subgroup||event.groupName||''}\u0000${type}\u0000${event.eventAt||event.at||event.date||''}`);
      if(seen.has(key))continue;
      seen.add(key);rows.push({...event,type});
    }
    return rows;
  }
  function groupSummaryRows(query='',sourceFilter='全部'){
     const groups=new Map(),summary=Object.create(null),emptyBusiness={tickets:new Set(),ticketRecordIds:new Set(),ticketPhones:new Set(),ticketRecordPhones:new Set(),depositCounts:new Set(),depositRecordIds:new Set(),depositPhones:new Set(),depositRecordPhones:new Set(),depositTotals:new Map(),depositPhoneTotals:new Map(),phoneOwners:new Map()};
    let business=emptyBusiness;try{business=businessSummaryIndex()||emptyBusiness;}catch(error){console.warn('[groups] business summary unavailable; rendering profile-only totals',error);}
     // Keep broad legacy source values for compatibility, but aggregate by the
     // concrete channel configured in Settings whenever it is available.
     const sourceOf=customer=>effectiveCustomerSource(customer);
    const ensure=source=>summary[source]||(summary[source]={groups:0,customers:0,joined:0,left:0,eventJoined:0,eventLeft:0,amount:0});
    // Legacy imports can contain malformed rows or hostile channel names. A
    // bad row is isolated and never prevents the rest of the page rendering.
    for(const customer of activeCustomers().filter(customer=>customer&&typeof customer==='object')){
      try{
      const source=sourceOf(customer),group=String(customer.group??'').trim(),status=String(customer.status??''),primaryAssistant=String(customer.assistant??'').trim()||'—',businessRow=customerBusinessSummary(customer,business)||{ticket:false,deposit:false,amount:0},sourceSummary=ensure(source),amount=Number.isFinite(Number(businessRow.amount))?Number(businessRow.amount):0;
      sourceSummary.customers++;if(['已进群','在群'].includes(status))sourceSummary.joined++;if(['已退群','临时退群'].includes(status))sourceSummary.left++;sourceSummary.amount+=amount;
      if(!group||group==='—')continue;
      const key=`${source}\u0000${group}`;let item=groups.get(key);
      if(!item){item={source,group,members:0,joined:0,left:0,eventJoined:0,eventLeft:0,hot:0,ticket:0,deposit:0,amount:0,assistants:new Map()};groups.set(key,item);sourceSummary.groups++;}
        item.members++;if(['已进群','在群'].includes(status))item.joined++;if(['已退群','临时退群'].includes(status))item.left++;if(Boolean(customer.hot))item.hot++;if(Boolean(businessRow.ticket))item.ticket++;if(Boolean(businessRow.deposit))item.deposit++;item.amount+=amount;item.assistants.set(primaryAssistant,(item.assistants.get(primaryAssistant)||0)+1);
      }catch(error){console.warn('[groups] skipped malformed customer row',error);}
    }
    for(const event of groupMembershipEventRows()){
      if(event.initial||(['pending','review','ignored'].includes(String(event.status||'').toLocaleLowerCase())))continue;
      const source=canonicalBusinessSource(event.source||event.channelName||event.channelId||event.sourceId)||'未分类',group=String(event.subgroup||event.groupName||event.groupJid||'—').trim()||'—',sourceSummary=ensure(source);
      if(event.type==='joined')sourceSummary.eventJoined++;else sourceSummary.eventLeft++;
      if(group==='—')continue;
      const key=`${source}\u0000${group}`;let item=groups.get(key);
      if(!item){item={source,group,members:0,joined:0,left:0,eventJoined:0,eventLeft:0,hot:0,ticket:0,deposit:0,amount:0,assistants:new Map()};groups.set(key,item);sourceSummary.groups++;}
      if(event.type==='joined')item.eventJoined++;else item.eventLeft++;
    }
    for(const configured of [...new Set([...sources,...groupFanSources])])ensure(configured);
    const q=String(query||'').toLocaleLowerCase(),rows=[...groups.values()].map(item=>({...item,source:String(item.source||'未分类'),group:String(item.group||''),assistant:[...item.assistants.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||'—'})).filter(row=>(sourceFilter==='全部'||row.source===sourceFilter)&&(!q||row.group.toLocaleLowerCase().includes(q))).sort((a,b)=>a.source.localeCompare(b.source,'zh-CN')||a.group.localeCompare(b.group,'zh-CN'));
    return {rows,summary,sourceTypes:Object.keys(summary).sort((a,b)=>a.localeCompare(b,'zh-CN')),totalGroups:groups.size};
  }
  function renderGroups(){
    void refreshGroupMembershipEvents();
    let sourceFilter=state.groupSource||'全部';
    const initial=groupSummaryRows(state.groupQuery||'',sourceFilter),sourceTypes=initial.sourceTypes;
    if(sourceFilter!=='全部'&&!sourceTypes.includes(sourceFilter)){sourceFilter='全部';state.groupSource='全部';}
    const {rows:all,summary,totalGroups}=sourceFilter===state.groupSource?initial:groupSummaryRows(state.groupQuery||'',sourceFilter),pageCount=Math.max(1,Math.ceil(all.length/state.perPage));
    state.page=Math.min(state.page,pageCount);const start=(state.page-1)*state.perPage,groups=all.slice(start,start+state.perPage);
    const rows=groups.map(item=>`<tr><td>${sourceTag(item.source)}</td><td><strong>${esc(item.group)}</strong></td><td>${item.members}</td><td>${item.joined}</td><td>${item.left}</td><td>${item.eventJoined}</td><td>${item.eventLeft}</td><td>${item.hot}</td><td>${item.ticket}</td><td>${item.deposit}</td><td>${money(item.amount)}</td><td>${esc(item.assistant)}</td><td><button class="table-action" data-action="group-filter" data-source="${esc(item.source)}" data-group="${esc(item.group)}">查看成员</button></td></tr>`).join('');
    const summaryCards=sourceTypes.map(source=>{const item=summary[source]||{groups:0,customers:0,joined:0,left:0,eventJoined:0,eventLeft:0,amount:0};return `<div class="business-kpi"><span>${esc(source)}群组</span><strong>${item.groups}</strong><small>${item.customers} 位客户 · 当前在群 ${item.joined} · 当前退群 ${item.left}</small></div><div class="business-kpi"><span>${esc(source)}进退群事件</span><strong>进 ${item.eventJoined} / 退 ${item.eventLeft}</strong><small>按状态事件账本累计，渠道与子类型分开</small></div><div class="business-kpi"><span>${esc(source)}入金</span><strong>${money(item.amount)}</strong><small>按客户档案实时汇总</small></div>`;}).join('');
    $('#viewContainer').innerHTML=heading('群组管理','按系统设置中的具体渠道与子类型独立统计；新增、重命名和删除会同步',btn('导出群组','download','export-filtered'))+`<div class="business-summary">${summaryCards||'<div class="business-kpi"><span>暂无渠道数据</span><strong>0</strong></div>'}</div><div class="subnav"><button data-group-source="全部" class="${sourceFilter==='全部'?'active':''}">全部渠道</button>${sourceTypes.map(type=>`<button data-group-source="${esc(type)}" class="${sourceFilter===type?'active':''}">${esc(type)}</button>`).join('')}</div><section class="panel table-panel"><div class="table-toolbar"><div class="table-context"><strong>${sourceFilter==='全部'?'全部渠道':sourceFilter}群组表现</strong><span>显示 ${all.length?start+1:0}–${Math.min(start+state.perPage,all.length)} 条，共 ${all.length} 个匹配群组</span></div><label class="input-search">${icons('search')}<input data-search="group" value="${esc(state.groupQuery||'')}" placeholder="搜索群编号"></label></div><div class="table-scroll"><table class="data-table"><thead><tr>${['渠道','群编号','客户数','当前在群','当前已退','累计进群','累计退群','热聊','跟票','入金人数','入金金额','主要助理','操作'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows||'<tr><td colspan="13" class="muted-cell">没有匹配的群组</td></tr>'}</tbody></table></div><div class="table-footer"><span>全部共 ${totalGroups} 个群组 · 当前显示 ${all.length} 个</span><div class="pagination"><button class="page-btn" data-page="${Math.max(1,state.page-1)}">‹</button><span>${state.page} / ${pageCount}</span><button class="page-btn" data-page="${Math.min(pageCount,state.page+1)}">›</button><select class="compact-select page-size"><option ${state.perPage===10?'selected':''}>10</option><option ${state.perPage===20?'selected':''}>20</option><option ${state.perPage===50?'selected':''}>50</option></select></div></div></section>`;
  }

  // V5.0 §20 渠道 / 助理 / 群组统计：所有 CRM 数字按客户唯一编号去重；
  // 群组成员按群分别统计（同一客户可分别计入）；待确认绝不当作已退群。
  function renderCrmStatisticsHtml(list){
    const engine=window.ZhikeCrmStatistics;
    if(!engine||typeof engine.computeStatistics!=='function')return '<section class="panel" style="margin-top:14px"><div class="panel-heading"><h2 class="panel-title">客户运营统计</h2></div><p class="panel-note">统计模块未加载，请重新打开应用。</p></section>';
    const stats=engine.computeStatistics(list);
    const kpis=[['唯一客户',stats.uniqueCustomers],['当前在群',stats.inGroup],['已确认退群',stats.left],['待确认',stats.pending],['已完成 AI 分析',stats.analysed],['资料待补齐',stats.incomplete],['待跟进',stats.due],['近 30 天新发现',stats.newCustomers]];
    const row=(label,count,total,action)=>`<div class="funnel-row"><span style="width:110px;color:var(--ds-muted);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(label)}">${esc(label)}</span><div class="bar-small" style="flex:1"><i style="width:${count?Math.max(4,count/Math.max(1,total)*100):0}%"></i></div><b style="color:var(--ds-text);width:36px;text-align:right;font-variant-numeric:tabular-nums">${count}</b>${action?`<button class="table-action" data-analytics-filter="${esc(action)}">明细</button>`:''}</div>`;
    const groupMax=Math.max(1,...stats.groups.map(item=>item.members));
    return `<section class="panel" style="margin-top:14px" data-crm-statistics><div class="panel-heading"><h2 class="panel-title">客户运营统计</h2><span class="panel-note">${esc(stats.notes.crm)}</span></div><div class="business-summary">${kpis.map(([label,value])=>`<div class="business-kpi"><span>${esc(label)}</span><strong>${value}</strong></div>`).join('')}</div><div class="two-col-content"><section class="panel"><div class="panel-heading"><h2 class="panel-title">渠道唯一客户数量</h2><span class="panel-note">未分类 ${stats.unclassifiedChannel} 位</span></div><div class="funnel-content">${stats.channels.length?stats.channels.map(item=>row(item.label,item.value,stats.uniqueCustomers,`source:${item.label}`)).join(''):'<p class="panel-note">尚无带渠道的客户。</p>'}</div></section><section class="panel"><div class="panel-heading"><h2 class="panel-title">助理负责客户数量</h2><span class="panel-note">未分配 ${stats.unassigned} 位</span></div><div class="funnel-content">${stats.assistants.length?stats.assistants.map(item=>row(item.label,item.value,stats.uniqueCustomers,`assistant:${item.label}`)).join(''):'<p class="panel-note">尚未分配助理。</p>'}</div></section></div>${stats.groups.length?`<div class="panel-heading" style="margin-top:12px"><h2 class="panel-title">群组成员数量</h2><span class="panel-note">${esc(stats.notes.groups)}</span></div><div class="funnel-content">${stats.groups.slice(0,20).map(group=>row(group.groupName,group.members,groupMax)).join('')}</div>`:''}<p class="rule-hint">${esc(stats.notes.pending)} ${esc(stats.notes.period)}</p></section>`;
  }
  function renderAnalytics(){const n=counts(),list=activeCustomers(),statusRows=statusSourceSummary(list),sourceCounts=statusRows.map(row=>[row.source,list.filter(customer=>effectiveCustomerSource(customer)===row.source).length]).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'zh-CN'));$('#viewContainer').innerHTML=heading('统计分析','本地实时统计 · 点击分类可查看对应客户明细',btn('导出分析报告','download','export-filtered'))+`<div class="subnav"><button class="active">客户概览</button><button data-action="go-hot">热聊分析</button><button data-action="go-tickets">跟票分析</button><button data-action="go-deposits">入金分析</button><button data-action="go-groups">群组分析</button></div><div class="business-summary"><div class="business-kpi"><span>客户总数</span><strong>${n.total}</strong></div><div class="business-kpi"><span>进群率</span><strong>${Math.round(n.joined/Math.max(1,n.total)*100)}%</strong></div><div class="business-kpi"><span>热聊率</span><strong>${Math.round(n.hot/Math.max(1,n.total)*100)}%</strong></div><div class="business-kpi"><span>VIP 客户</span><strong>${n.vip}</strong></div><div class="business-kpi"><span>入金转化率</span><strong>${Math.round(n.deposit/Math.max(1,n.total)*100)}%</strong></div></div><section class="panel" style="margin-top:14px"><div class="panel-heading"><h2 class="panel-title">进退群统计</h2><span class="panel-note">按系统设置中的具体渠道分开</span></div>${renderStatusSummary(list)}</section><div class="two-col-content"><section class="panel"><div class="panel-heading"><h2 class="panel-title">渠道分布</h2><span class="panel-note">选择渠道查看客户</span></div><div class="funnel-content">${sourceCounts.map(([source,count])=>`<div class="funnel-row"><span style="width:95px;color:#697587;font-size:9px">${esc(source)}</span><div class="bar-small" style="flex:1"><i style="width:${count?Math.max(4,count/Math.max(1,n.total)*100):0}%"></i></div><b style="font-size:9px;color:#536074;width:25px;text-align:right">${count}</b><button class="table-action" data-source="${esc(source)}">明细</button></div>`).join('')}</div></section><section class="panel"><div class="panel-heading"><h2 class="panel-title">客户状态与业务概况</h2><span class="panel-note">按有效客户总数比较，各项可重叠</span></div><div class="funnel-content">${[['客户总数',n.total],['已进群',n.joined],['热聊客户',n.hot],['VIP 客户',n.vip],['跟票客户',n.ticket],['入金客户',n.deposit]].map(([label,value])=>`<div class="funnel-row"><div class="funnel-bar-wrap"><div class="funnel-bar" style="${value?`width:${Math.max(12,value/Math.max(1,n.total)*100)}%`:'background:none!important;color:var(--ds-text)!important'}">${label}</div></div><strong class="funnel-num">${value}</strong></div>`).join('')}</div></section></div><section class="panel" style="margin-top:14px"><div class="panel-heading"><h2 class="panel-title">分类统计</h2><span class="panel-note">点击数字打开明细</span></div><div class="segment-summary">${sourceCounts.map(([source,count])=>[source,count,`source:${source}`]).concat([['未分配',n.unassigned,'assistant:未分配'],['缺少群号',n.missingGroup,'group:missing'],['热聊',n.hot,'hot:true'],['VIP',n.vip,'vip:true'],['跟票',n.ticket,'ticket:true'],['入金',n.deposit,'deposit:true'],['已逾期',n.overdue,'follow:overdue']]).map(([label,value,key])=>`<button class="summary-tile" data-analytics-filter="${esc(key)}"><span>${esc(label)}</span><strong>${value}</strong><small>查看</small></button>`).join('')}</div></section>${typeof renderCrmStatisticsHtml==='function'?renderCrmStatisticsHtml(list):''}`;}
  function assistantSuggestionRows(){const cohorts=new Map();for(const c of activeCustomers()){if(!c.page||!c.assistant||c.assistant==='未分配')continue;const key=`${c.source}\u0000${c.page}`;if(!cohorts.has(key))cohorts.set(key,new Map());const counts=cohorts.get(key);counts.set(c.assistant,(counts.get(c.assistant)||0)+1);}const suggestions=[];for(const customer of activeCustomers().filter(c=>c.assistant==='未分配'&&c.page)){const key=`${customer.source}\u0000${customer.page}`,counts=cohorts.get(key);if(!counts)continue;const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));const total=[...counts.values()].reduce((sum,n)=>sum+n,0);if(total<5||!ranked.length||ranked[0][1]/total<0.7)continue;suggestions.push({customer,assistant:ranked[0][0],matched:total,votes:ranked[0][1],share:ranked[0][1]/total});}return suggestions;}
  function renderAssistantSuggestions(){const all=assistantSuggestionRows();const pages=[...new Set(all.map(row=>row.customer.page))].sort((a,b)=>a.localeCompare(b,'zh-CN'));const pageFilter=state.assistantSuggestionPageFilter||'全部来源页面';const rows=pageFilter==='全部来源页面'?all:all.filter(row=>row.customer.page===pageFilter);const pageSize=50;const pageCount=Math.max(1,Math.ceil(rows.length/pageSize));state.assistantSuggestionPage=Math.min(state.assistantSuggestionPage||1,pageCount);const start=(state.assistantSuggestionPage-1)*pageSize;const visible=rows.slice(start,start+pageSize);const pageOptions=['全部来源页面',...pages].map(page=>`<option value="${esc(page)}" ${page===pageFilter?'selected':''}>${esc(page)}</option>`).join('');$('#viewContainer').innerHTML=governanceHeading('助理分配建议','按来源页面筛选，所有建议在写入前保持可核对。','智能分配策略',btn('返回自动化','chevron-left','automation-overview'),[['高置信建议',all.length,'满足历史样本门槛','accent'],['当前筛选',rows.length,'匹配当前页面'],['分页',state.assistantSuggestionPage+'/'+pageCount,'每页 50 条']])+`<div class="notice-line">仅展示至少 5 条历史样本且首选助理占比达到 70% 的建议。不会自动分配，确认前不会修改客户资料。</div><div class="governance-signal-grid governance-policy-grid"><div class="business-kpi"><span>高置信建议</span><strong>${all.length}</strong></div><div class="business-kpi"><span>当前筛选</span><strong>${rows.length}</strong></div><div class="business-kpi"><span>历史样本门槛</span><strong>5 条</strong></div><div class="business-kpi"><span>建议占比门槛</span><strong>70%</strong></div></div><section class="panel table-panel"><div class="table-toolbar"><div class="table-context"><strong>按来源页面推荐</strong><span>显示 ${rows.length?start+1:0}–${Math.min(start+pageSize,rows.length)} 条，共 ${rows.length} 条</span></div><div class="toolbar-controls"><label class="filter-field"><span>来源页面</span><select data-assistant-page>${pageOptions}</select></label><button class="btn small primary" data-action="apply-all-assistant-suggestions" ${rows.length?'':'disabled'}>确认应用当前筛选建议 (${rows.length})</button></div></div><div class="table-scroll"><table class="data-table"><thead><tr><th>客户</th><th>号码</th><th>来源页面</th><th>推荐助理</th><th>历史依据</th><th>操作</th></tr></thead><tbody>${visible.map(({customer,assistant,matched,votes,share})=>`<tr><td>${esc(customer.name)}</td><td class="phone-cell">${esc(customer.rawPhone||'')}</td><td>${esc(customer.page)}</td><td><span class="status-tag tag-blue">${esc(assistant)}</span></td><td>${votes}/${matched} 条历史 · ${Math.round(share*100)}%</td><td><button class="table-action" data-action="apply-assistant-suggestion" data-id="${esc(customer.id)}">确认分配</button></td></tr>`).join('')||'<tr><td colspan="6" class="muted-cell">当前来源页面没有达到门槛的建议</td></tr>'}</tbody></table></div><div class="table-footer"><span>每页 ${pageSize} 条</span><div class="pagination"><button class="page-btn" data-action="assistant-suggestion-page" data-page="${Math.max(1,state.assistantSuggestionPage-1)}" ${state.assistantSuggestionPage===1?'disabled':''}>‹</button><span>${state.assistantSuggestionPage} / ${pageCount}</span><button class="page-btn" data-action="assistant-suggestion-page" data-page="${Math.min(pageCount,state.assistantSuggestionPage+1)}" ${state.assistantSuggestionPage===pageCount?'disabled':''}>›</button></div></div></section>`;}
  async function applyAssistantSuggestions(ids){if(state.settings.assistantSuggestions===false){toast('助理分配建议已暂停');return;}const pageFilter=state.assistantSuggestionPageFilter||'全部来源页面';const suggestions=assistantSuggestionRows().filter(row=>(!ids||ids.includes(String(row.customer.id)))&&(ids||pageFilter==='全部来源页面'||row.customer.page===pageFilter));if(!suggestions.length){toast('当前筛选没有可应用的高置信建议');return;}const detail=ids?`${suggestions[0].customer.name} → ${suggestions[0].assistant}`:`当前筛选中的 ${suggestions.length} 位客户`;if(!confirm(`确认应用${detail}？分配结果将记录在本机，可在客户资料中修改。`))return;if(!await snapshotBeforeWrite('应用助理分配建议前自动快照'))return;const targetIds=new Set(suggestions.map(row=>String(row.customer.id)));const current=assistantSuggestionRows().filter(row=>targetIds.has(String(row.customer.id))&&(ids||pageFilter==='全部来源页面'||row.customer.page===pageFilter));if(!current.length){toast('建议条件已变化，没有应用任何分配');return;}const previous=current.map(row=>({customer:row.customer,assistant:row.customer.assistant,touched:row.customer.touched}));const previousActivities=state.activities.slice();for(const row of current){row.customer.assistant=row.assistant;row.customer.touched=true;}const detailLines=current.slice(0,10).map(row=>`${row.customer.name}→${row.assistant}`);const suffix=current.length>detailLines.length?`，另 ${current.length-detailLines.length} 位`:' ';activity(`人工确认助理分配 ${current.length} 条：${detailLines.join('；')}${suffix}`.trim());try{await flushStateWrites();}catch{for(const row of previous){row.customer.assistant=row.assistant;row.customer.touched=row.touched;}state.activities=previousActivities;persist();toast('本机数据库写入失败，已撤销本次分配','x');render();return;}render();toast(`已应用并保存 ${current.length} 条建议`);}
  function renderAutomation(){const rules=[
    ['normalize','号码标准化','录入和导入时统一号码格式，作为数据校验基础',true,false],
    ['channel','渠道分类识别','按系统设置中的渠道选项对录入资料进行归类',true,false],
    ['duplicateGuard','重复号码保护','导入仅新增号码，已存在客户不会被覆盖',true,false],
    ['dueReminder','逾期任务提醒','按计划日期汇总到客户中心与今日工作台',true,false],
    ['preWriteSnapshot','写入前自动快照','批量导入、迁移和恢复前保留可回退数据',true,false],
    ['autoInitialFollow','快速录入后创建次日跟进','仅影响快速录入新增客户；可在录入页单独关闭',state.settings.autoInitialFollow!==false,true],
    ['staleHotReminder','热聊未跟进提醒','在自动化发现区提示超过 3 天未跟进的热聊客户',state.settings.staleHotReminder!==false,true],
    ['assistantSuggestions','助理分配建议','按来源页面历史给出建议，必须人工确认才会写入',state.settings.assistantSuggestions!==false,true],
  ];
    const enabledCount=rules.filter(rule=>rule[3]).length;
    const ruleRows=rules.map(([key,name,desc,on,configurable])=>`<div class="suggestion automation-rule-row"><div class="suggestion-icon blue">${icons('spark')}</div><div class="suggestion-copy"><strong>${name}</strong><p>${desc}</p></div>${configurable?`<button class="switch ${on?'on':''}" data-rule="${key}" aria-label="${on?'关闭':'启用'}${name}" aria-pressed="${on}" title="${on?'当前启用':'当前关闭'}"></button>`:'<span class="status-tag tag-green automation-rule-state">系统规则</span>'}</div>`).join('');
    const discoveries=`${suggestion('clock','red',`${counts().overdue} 位客户已逾期`,'根据登记日期自动汇总。','查看明细','go-followups')}${suggestion('users','blue',`${counts().unassigned} 位客户未分配助理`,'根据负责人字段为空的记录识别。','查看客户','unassigned')}${suggestion('shield','',`${counts().missingGroup} 位客户缺少群编号`,'不会自动填入，需人工确认。','数据治理','go-quality')}${state.settings.staleHotReminder!==false?suggestion('clock','orange',`${staleHotCustomers().length} 位热聊客户超过 3 天未跟进`,'使用最后跟进日期识别，只提醒、不自动修改客户资料。','查看名单','go-hot-stale'):''}${state.settings.assistantSuggestions!==false&&assistantSuggestionRows().length?suggestion('users','blue',`${assistantSuggestionRows().length} 条高置信助理建议`,'至少 5 条同页面历史样本且首选占比达到 70%，应用前需确认。','查看建议','go-assistant-suggestions'):''}`;
    $('#viewContainer').innerHTML=governanceHeading('本地自动化','在本机统一管理识别、保护、提醒和人工确认规则。','自动化控制中心',btn('查看执行记录','history','go-activity'),[['启用规则',enabledCount,'共 '+rules.length+' 条','accent'],['系统规则',rules.filter(rule=>!rule[4]).length,'固定保护'],['逾期待办',counts().overdue,'实时计算','warning'],['执行环境','本机','SQLite']])+`<div class="notice-line">自动化在本机执行；可配置项按开关状态生效。</div><div class="two-col-content"><section class="panel"><div class="panel-heading"><h2 class="panel-title">自动化规则</h2><span class="status-tag tag-green">${enabledCount} 条启用 · ${rules.filter(rule=>!rule[4]).length} 条系统规则</span></div><div class="automation-rules">${ruleRows}</div></section><section class="panel"><div class="panel-heading"><h2 class="panel-title">今日本地发现</h2><span class="panel-note">提醒仅影响此处建议，不会隐藏客户记录</span></div><div class="suggestion-list">${discoveries}</div></section></div>`;}
  function phoneForQuality(customer){const clean=value=>{const digits=String(value||'').replace(/\D/g,'');return digits.length===12&&digits.startsWith('91')?digits.slice(2):digits;};const primary=clean(customer.phone);return primary.length===10?primary:clean(customer.rawPhone)||primary;}
  function qualityScan(){if(qualityScanCache.revision===state.dataRevision&&qualityScanCache.value)return qualityScanCache.value;const scan=window.ZhikeIdentityConflicts?.scanIdentityConflicts?.(activeCustomers())||null;const fallback=(()=>{const groups=new Map(),vipGroups=new Map(),list=activeCustomers();for(const customer of list){const phone=phoneForQuality(customer);if(phone.length===10){if(!groups.has(phone))groups.set(phone,[]);groups.get(phone).push(customer);}const vip=vipKey(customer.vipNumber||customer.vipId||customer.vipCode);if(vip){if(!vipGroups.has(vip))vipGroups.set(vip,[]);vipGroups.get(vip).push(customer);}}const duplicates=[...groups.values()].filter(group=>group.length>1).flat(),vipDuplicates=[...vipGroups.values()].filter(group=>group.length>1).flat(),invalid=list.filter(c=>phoneForQuality(c).length!==10);return{duplicates,vipDuplicates,invalid,identityConflicts:[],identityConflictCustomers:[],summary:{duplicatePhoneGroups:0,duplicateVipGroups:0,identityConflicts:0,invalidPhones:0,customers:list.length,pendingConfirmation:0}};})();const value=scan?{duplicates:scan.duplicates,vipDuplicates:scan.vipDuplicates,invalid:scan.invalid,identityConflicts:scan.identityConflicts,identityConflictCustomers:scan.identityConflictCustomers,summary:scan.summary}:fallback;qualityScanCache={revision:state.dataRevision,value};return value;}
  function duplicateCustomerPlan(){const groups=new Map(),businessIds=new Set([...state.tickets,...state.deposits,...state.followups,...state.registrations].map(row=>String(row.customerId)));for(const customer of activeCustomers()){const phone=phoneForQuality(customer);if(phone.length!==10)continue;if(!groups.has(phone))groups.set(phone,[]);groups.get(phone).push(customer);}const survivors=[],duplicates=[];for(const [phone,group] of groups){if(group.length<2)continue;const score=customer=>['name','source','page','assistant','status','phase','qualification','group','note','lastFollow','due'].reduce((sum,key)=>sum+(customer[key]&&customer[key]!=='—'&&customer[key]!=='未分配'?1:0),0)+(customer.touched?3:0)+(customer.favorite?2:0)+(businessIds.has(String(customer.id))?4:0)+(customer.hot?1:0);const ranked=group.slice().sort((a,b)=>score(b)-score(a)||String(a.registered||'').localeCompare(String(b.registered||''))||String(a.id).localeCompare(String(b.id))),survivor=ranked[0];survivors.push({phone,survivor,removed:ranked.slice(1)});duplicates.push(...ranked.slice(1));}return {survivors,duplicates};}
  function deduplicatePreview(){const plan=duplicateCustomerPlan();if(!plan.duplicates.length){toast('当前没有可删除的重复号码');return;}const preview=plan.survivors.slice(0,12).map(item=>`<div class="batch-preview-name"><strong>${esc(item.phone)}</strong> · 保留 ${esc(item.survivor.name)} · 移除 ${item.removed.map(c=>esc(c.name)).join('、')}</div>`).join('');openModal('删除重复值',`按标准化手机号码去重 · ${plan.survivors.length} 组`,`${`<div class="batch-preview-summary"><div><span>重复号码</span><strong>${plan.survivors.length}</strong></div><div><span>保留客户</span><strong>${plan.survivors.length}</strong></div><div><span>移入回收站</span><strong>${plan.duplicates.length}</strong></div></div>`}<div class="notice-line">自动保留资料更完整、有业务关联或已人工修改的记录。其余重复值仅移入回收站，不会永久删除。</div><div class="batch-preview-list">${preview}${plan.survivors.length>12?`<span>另有 ${plan.survivors.length-12} 组未在预览中展开</span>`:''}</div>`,`<button class="btn" data-action="close-modal">取消</button><button class="btn primary" data-action="apply-deduplicate-customers">确认删除重复值</button>`);}
  async function applyDeduplicateCustomers(){const plan=duplicateCustomerPlan();if(!plan.duplicates.length){closeModal();toast('重复数据已发生变化，当前无需处理');return;}if(!await snapshotBeforeWrite('删除重复值前自动快照'))return;const now=new Date().toISOString(),previousActivities=state.activities.slice(),previousRows=plan.duplicates.map(customer=>({customer,deleted:customer.deleted,deletedAt:customer.deletedAt,duplicateOf:customer.duplicateOf}));for(const customer of plan.duplicates){customer.deleted=true;customer.deletedAt=now;customer.duplicateOf=plan.survivors.find(item=>item.removed.includes(customer))?.survivor.id||'';}persist();activity(`删除重复值：${plan.survivors.length} 组，${plan.duplicates.length} 位客户移入回收站`);try{await flushStateWrites();}catch{for(const item of previousRows){item.customer.deleted=item.deleted;if(item.deletedAt===undefined)delete item.customer.deletedAt;else item.customer.deletedAt=item.deletedAt;if(item.duplicateOf===undefined)delete item.customer.duplicateOf;else item.customer.duplicateOf=item.duplicateOf;}state.activities=previousActivities;persist();toast('本机数据库保存失败，已恢复全部重复记录','x');return;}closeModal();render();toast(`已删除 ${plan.duplicates.length} 条重复值，可在回收站恢复`);}
  function pendingImportIssues(){return state.importIssues.filter(x=>!x.resolved&&!x.ignored);}
  function historicalDateMigrationCandidates(){return activeCustomers().filter(customer=>{const registered=normalizeImportedDate(customer.registered),due=normalizeImportedDate(customer.due);return registered&&due&&registered===due&&!customer.lastFollow&&!customer.registration;});}
  async function migrateHistoricalDates(mode='clear'){
    const candidates=historicalDateMigrationCandidates();
    if(!candidates.length){toast('没有发现登记日期与下次跟进日期混用的历史记录');return;}
    const label=mode==='next'?'将下次跟进改为登记日期次日':'清空下次跟进日期';
    if(!confirm(`检测到 ${candidates.length} 位客户的登记日期与下次跟进日期相同，可能来自旧版本字段混用。\n\n${label}？本次只处理这些疑似历史记录，其他客户不变。`))return;
    if(!await snapshotBeforeWrite('历史日期字段迁移前自动快照'))return;
    const before=candidates.map(customer=>({customer,due:customer.due,touched:customer.touched})),previousActivities=state.activities.slice(),previousMigrationAt=state.settings.historicalDateMigrationAt;
    for(const item of before){item.customer.due=mode==='next'?localDateOffset(1,new Date(`${item.customer.registered}T12:00:00`)):'—';item.customer.touched=true;}
    state.settings.historicalDateMigrationAt=new Date().toISOString();
    activity(`历史日期迁移：${label} ${candidates.length} 位客户`);persist();
    try{await flushStateWrites();}catch{for(const item of before){item.customer.due=item.due;item.customer.touched=item.touched;}if(previousMigrationAt===undefined)delete state.settings.historicalDateMigrationAt;else state.settings.historicalDateMigrationAt=previousMigrationAt;state.activities=previousActivities;persist();toast('历史日期迁移保存失败，已恢复原值','x');return;}
    render();toast(`已完成历史日期迁移：${candidates.length} 位客户`);
  }
  function importIssueModal(issue){const v=issue.values||{};const select=(key,label,options,value,optional=false)=>`<label class="filter-field"><span>${label}</span><select id="issue-${key}">${optional?'<option value="">不指定</option>':''}${options.map(option=>`<option value="${esc(option)}" ${option===value?'selected':''}>${esc(option)}</option>`).join('')}</select></label>`;const field=(key,label,type='text')=>`<label class="filter-field"><span>${label}</span><input id="issue-${key}" type="${type}" value="${esc(v[key]||'')}" placeholder="${label}"></label>`;const channelCandidates=Array.isArray(v.channelCandidates)?v.channelCandidates.filter(Boolean):[],channelReview=/^渠道无法/.test(String(issue.reason||'')),sourceOptions=[...new Set([...channelCandidates,...sources])],source=channelReview?(channelCandidates.length===1?channelCandidates[0]:''):(sources.includes(v.source)?v.source:(/群粉/.test(`${v.source||''} ${v.page||''}`)?'群粉':'单导'));const pagesForIssue=[...new Set([...pages,v.page||''].filter(Boolean))];openModal('复核导入行',`${esc(issue.file)} · 第 ${issue.row} 行 · ${esc(issue.reason)}`,`<div class="notice-line">修正后会按“渠道 + 可选页面”保存，页面可以用于群粉或其他渠道。</div>${channelCandidates.length?`<div class="notice-line">自动候选渠道：${channelCandidates.map(value=>esc(value)).join('、')}；请确认后再重试。</div>`:channelReview?'<div class="notice-line error-line">未能可靠识别渠道，请选择正确渠道；不会默认写入单导。</div>':''}<div class="filter-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">${field('name','客户姓名')}${field('phone','手机号码','tel')}${field('vipNumber','VIP编号')}${select('source','渠道',sourceOptions,source,channelReview)}${select('page','页面分类',pagesForIssue,v.page||'',true)}${select('assistant','跟进助理',assistants,v.assistant||'未分配')}${select('status','进群状态',statuses,v.status||(isGroupFanSource(source)?'在群':'未进群'))}${select('phase','客户阶段',phases,v.phase||'新客户')}${field('group','群编号')}${field('registered','登记日期','date')}${field('nextFollow','下次跟进','date')}<label class="filter-field" style="grid-column:1/-1"><span>备注</span><input id="issue-note" value="${esc(v.note||'')}"></label></div><div class="timeline"><h3>原始 CSV 行</h3><div class="notice-line">${esc(issue.raw)}</div></div>`,`<button class="btn" data-action="close-modal">取消</button><button class="btn danger" data-action="ignore-import-issue" data-id="${esc(issue.id)}">确认忽略</button><button class="btn primary" data-action="retry-import-issue" data-id="${esc(issue.id)}">修正并重试</button>`);}
  async function retryImportIssue(id){
    const issue=state.importIssues.find(x=>String(x.id)===String(id));if(!issue)return;
     const values=Object.fromEntries(['name','phone','vipNumber','source','page','assistant','status','phase','group','registered','nextFollow','note'].map(k=>[k,$(`#issue-${k}`)?.value.trim()||'']));
    const phone=linkedPhone(values.phone);if(phone.length!==10){toast('请先修正为有效的 10 位标准号码','x');return;}
    if(knownIntakePhones().has(phone)){toast('该号码已存在，请核对客户资料后处理此行','x');return;}
     const vipNumber=String(values.vipNumber||'').trim().slice(0,64);if(vipNumber&&knownIntakeVipNumbers().has(vipKey(vipNumber))){toast('该 VIP 编号已存在，请核对 VIP 管理中的归属','x');return;}
    const beforeCustomers=state.customers.slice(),beforeIssue=structuredClone(issue),beforeSources=sources.slice(),beforePages=pages.slice();
     const channelReview=/^渠道无法/.test(String(issue.reason||''));if(channelReview&&!values.source){toast('请先选择正确渠道后再重试','x');return;}const source=values.source||'单导';if(!sources.includes(source))sources.push(source);if(values.page&&!pages.includes(values.page))pages.push(values.page);
     const customer={id:`C${Date.now()}-${Math.random().toString(36).slice(2,7)}`,name:values.name||'未命名客户',rawPhone:values.phone,phone,source,page:values.page,channel:source,assistant:values.assistant||'未分配',status:values.status||'未进群',phase:values.phase||'新客户',vipNumber,hot:false,investor:false,group:values.group||'—',ticket:false,deposit:false,amount:0,registered:normalizeImportedDate(values.registered)||today,lastFollow:'',due:normalizeImportedDate(values.nextFollow)||(state.settings.autoInitialFollow===false?'—':localDateOffset(1)),note:values.note||'',deleted:false,touched:false};
    state.customers.unshift(customer);intakePhoneIndex=null;issue.originalValues=issue.originalValues||structuredClone(issue.values||{});issue.values=values;issue.resolved=true;issue.resolvedAt=new Date().toISOString();issue.resolvedCustomerId=customer.id;activity(`复核导入行并新增客户 ${customer.name}`);
    try{await flushStateWrites();closeModal();render();toast('已修正并导入客户');}
    catch(error){state.customers=beforeCustomers;Object.assign(issue,beforeIssue);sources.splice(0,sources.length,...beforeSources);pages.splice(0,pages.length,...beforePages);intakePhoneIndex=null;persist();render();toast(error.message||'修正导入行保存失败，已恢复原数据','x');}
  }
  async function ignoreImportIssue(id,skipConfirm=false){const issue=state.importIssues.find(x=>String(x.id)===String(id));if(!issue)return;if(!skipConfirm&&!confirm('确认忽略该行？原始内容仍会保留，可在已处理记录中撤销。'))return;const before=structuredClone(issue),beforeActivities=state.activities.slice();issue.ignored=true;issue.ignoredAt=new Date().toISOString();activity(`确认忽略导入待复核行：${issue.file} 第 ${issue.row} 行`);try{await flushStateWrites();closeModal();render();toast('已标记忽略，原始记录仍保留');}catch(error){Object.assign(issue,before);state.activities=beforeActivities;persist();render();toast(error.message||'忽略导入行保存失败，已恢复','x');}}
  function renderQuality(){const n=counts();const scan=qualityScan();const pendingDuplicates=scan.duplicates.filter(c=>!state.qualityDecisions[String(c.id)]?.duplicate);const pendingVipDuplicates=scan.vipDuplicates.filter(c=>!state.qualityDecisions[String(c.id)]?.['vip-duplicates']);const pendingInvalid=scan.invalid.filter(c=>!state.qualityDecisions[String(c.id)]?.invalid);if(state.qualityView==='duplicates'||state.qualityView==='vip-duplicates'||state.qualityView==='invalid'){const type=state.qualityView;const isVip=type==='vip-duplicates',isPhone=type==='duplicates',all=isVip?scan.vipDuplicates:isPhone?scan.duplicates:scan.invalid,pending=isVip?pendingVipDuplicates:isPhone?pendingDuplicates:pendingInvalid,list=state.qualityShowReviewed?all:pending;const rows=list.map(c=>{const reviewed=Boolean(state.qualityDecisions[String(c.id)]?.[type]);const key=isVip?vipKey(c.vipNumber||c.vipId||c.vipCode):phoneForQuality(c);const related=(isVip?scan.vipDuplicates:scan.duplicates).filter(x=>(isVip?vipKey(x.vipNumber||x.vipId||x.vipCode):phoneForQuality(x))===key).length;return `<tr data-customer="${esc(c.id)}"><td>${esc(c.name)}</td><td class="phone-cell">${esc(c.rawPhone||'')}</td><td>${esc(isVip?(c.vipNumber||c.vipId||c.vipCode||'—'):(phoneForQuality(c)||'—'))}</td><td>${isVip?`${related} 位客户共享 VIP 编号`:isPhone?`${related} 条共享号码`:'号码位数异常'}</td><td>${reviewed?'<span class="status-tag tag-green">已复核保留</span>':'<span class="status-tag tag-amber">待复核</span>'}</td><td>${isPhone||isVip?`<button class="table-action" data-action="edit-customer" data-id="${esc(c.id)}">编辑资料</button>`:''}${type==='invalid'?`<button class="table-action" data-action="edit-customer" data-id="${esc(c.id)}">编辑号码</button>`:''}<button class="table-action" data-action="${reviewed?'undo-quality-review':'review-quality'}" data-id="${esc(c.id)}" data-type="${type}">${reviewed?'撤销复核':isVip?'确认保留并人工处理':'确认保留'}</button></td></tr>`}).join('');const title=isVip?'重复 VIP 编号复核':isPhone?'重复号码复核':'异常号码复核';const hint=isVip?'同一个 VIP 编号只能归属一位客户。请编辑资料或移除重复编号后再确认保留。':isPhone?'共享同一标准号码的客户会并列展示。逐条确认后记录仍保留，可随时撤销复核。':'号码长度不符合本地规则的记录会保留原值；可进入编辑修正，或确认该号码为特殊情况。';$('#viewContainer').innerHTML=governanceHeading(title,'仅标记复核状态，不自动合并、删除或改写客户资料。','数据复核工作区',btn('返回治理','chevron-left','quality-overview'),[['当前名单',list.length,state.qualityShowReviewed?'包含已复核':'仅待复核','accent'],['全部记录',all.length,'当前问题类型'],['处理方式','人工复核','可随时撤销']])+`<div class="notice-line">${hint}</div><section class="panel table-panel"><div class="table-toolbar"><div class="table-context"><strong>${list.length} 条${state.qualityShowReviewed?'记录':'待复核'}</strong><span>总计 ${all.length} 条</span></div><button class="btn small" data-action="toggle-quality-reviewed">${state.qualityShowReviewed?'仅看待复核':'显示已复核'}</button></div><div class="table-scroll"><table class="data-table"><thead><tr><th>客户</th><th>原始号码</th><th>${isVip?'VIP 编号':'标准号码'}</th><th>检查结果</th><th>处理状态</th><th>操作</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="muted-cell">当前没有待复核记录</td></tr>'}</tbody></table></div></section>`;return;}const pending=pendingImportIssues();const processed=state.importIssues.filter(x=>x.resolved||x.ignored);const sorted=[...pending,...processed];const rows=sorted.slice(0,100).map(x=>{const status=x.resolved?'<span class="status-tag tag-green">已导入</span>':x.ignored?'<span class="status-tag">已忽略</span>':'<span class="status-tag tag-amber">待复核</span>';const v=x.values||{};const actions=x.resolved?`<button class="table-action" data-action="show-import-customer" data-id="${esc(x.resolvedCustomerId||'')}">查看客户</button>`:x.ignored?`<button class="table-action" data-action="restore-import-issue" data-id="${esc(x.id)}">撤销忽略</button>`:`<button class="table-action" data-action="edit-import-issue" data-id="${esc(x.id)}">修正/重试</button><button class="table-action" data-action="ignore-import-issue" data-id="${esc(x.id)}">忽略</button>`;return `<tr><td>${esc(x.file)}</td><td>${x.row}</td><td>${status}</td><td>${esc(x.reason)}</td><td>${esc(v.name||'')} · ${esc(v.phone||'')}</td><td>${esc(v.channel||'未识别')}</td><td>${actions}</td></tr>`}).join('');const issueCount=pending.length;const dateMigrationCandidates=historicalDateMigrationCandidates();const summaryRows=[['缺少群编号',n.missingGroup,'群编号为空或未识别','missing-group'],['未分配助理',n.unassigned,'未设置跟进负责人','unassigned'],['号码重复',pendingDuplicates.length,'共享标准号码的客户记录','quality-duplicates'],['VIP编号重复',pendingVipDuplicates.length,'同一个 VIP 编号被多个客户使用','quality-vip-duplicates'],['号码异常',pendingInvalid.length,'号码缺失或标准号码长度不是 10 位','quality-invalid'],['导入待复核',issueCount,'异常或重复的 CSV 行，可逐条修正、重试或忽略','export-import-issues'],['历史日期待迁移',dateMigrationCandidates.length,'登记日期与下次跟进日期相同且没有跟进记录','historical-date-migration'],['资料待完善',n.missingGroup+n.unassigned,'关键客户字段缺失','incomplete']];$('#viewContainer').innerHTML=governanceHeading('数据治理','集中处理重复、异常和资料缺失；修复、忽略与恢复都保留审计记录。','数据健康中枢',btn('重新检查','history','quality-scan'),[['待复核',pendingDuplicates.length+pendingVipDuplicates.length+pendingInvalid.length+issueCount,'需要人工处理','warning'],['已处理导入',processed.length,'保留审计记录'],['资料缺口',n.missingGroup+n.unassigned,'群号或负责人'],['历史日期',dateMigrationCandidates.length,'待迁移检查']])+`<div class="governance-signal-grid">${[['号码重复',pendingDuplicates.length],['VIP编号重复',pendingVipDuplicates.length],['号码异常',pendingInvalid.length],['身份冲突',(scan.identityConflicts||[]).length],['导入待复核',issueCount],['已处理导入行',processed.length]].map(([label,value])=>`<div class="business-kpi"><span>${label}</span><strong>${value}</strong><small>条记录</small></div>`).join('')}</div><section class="panel"><div class="panel-heading"><h2 class="panel-title">待处理问题</h2><span class="panel-note">导入行可单条修正后重试；历史日期迁移只处理疑似旧字段混用记录</span></div><table class="task-table"><thead><tr><th>问题类型</th><th>数量</th><th>检查规则</th><th>操作</th></tr></thead><tbody>${summaryRows.map(([l,v,d,a])=>`<tr><td><strong>${l}</strong></td><td>${v}</td><td>${d}</td><td><button class="table-action" data-action="${a}">查看名单 ${icons('chevron-right')}</button></td></tr>`).join('')}</tbody></table></section>${(scan.identityConflicts||[]).length?`<section class="panel table-panel governance-stacked-panel"><div class="panel-heading"><h2 class="panel-title">身份冲突待确认</h2><span class="panel-note">同一个 WhatsApp 身份关联到多条客户记录；不会自动合并，请人工确认后再处理。</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>WhatsApp 身份</th><th>客户</th><th>号码</th><th>操作</th></tr></thead><tbody>${scan.identityConflicts.slice(0,50).map(group=>group.customers.map((c,index)=>`<tr><td>${index===0?esc(group.identity):''}</td><td>${esc(c.name||'未命名客户')}</td><td>${esc(c.rawPhone||c.phone||'—')}</td><td><button class="table-action" data-customer="${esc(c.id)}">查看客户</button></td></tr>`).join('')).join('')}</tbody></table></div></section>`:''}${state.importIssues.length?`<section class="panel table-panel governance-stacked-panel"><div class="panel-heading"><h2 class="panel-title">CSV 导入行审计</h2><span class="panel-note">显示前 ${Math.min(100,state.importIssues.length)} 条 · ${issueCount} 条待复核 · ${processed.length} 条已处理</span><button class="btn small" data-action="export-import-issues">导出完整审计 CSV</button></div><div class="table-scroll"><table class="data-table"><thead><tr><th>来源文件</th><th>行号</th><th>状态</th><th>原问题</th><th>姓名 · 号码</th><th>渠道</th><th>操作</th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="muted-cell">没有导入记录</td></tr>'}</tbody></table></div><div class="table-footer"><button class="table-action" data-action="clear-import-issues">清理已处理记录 (${processed.length})</button></div></section>`:''}`;}
  function renderData(){const n=counts();$('#viewContainer').innerHTML=governanceHeading('数据中心','统一管理 6.0 本机数据的导入、导出、快照与恢复。','本机数据枢纽',btn('立即备份','cloud-down','backup','primary'),[['客户记录',n.total,'当前工作区','accent'],['存储引擎','本机 SQLite','未执行即时检测'],['离线范围','客户与业务','WS 与主动 AI 需联网'],['恢复保护','自动快照','写入前创建']])+`<div class="governance-signal-grid governance-data-state"><div class="business-kpi"><span>本地客户</span><strong>${n.total}</strong></div><div class="business-kpi"><span>本机存储状态</span><strong class="governance-status-value compact">未执行即时检测</strong><small>本机 SQLite 存储；写入状态以顶部提示为准</small></div><div class="business-kpi"><span>最近快照</span><strong id="recentSnapshot" class="governance-status-value compact">读取中…</strong></div><div class="business-kpi"><span>使用范围</span><strong class="governance-status-value compact">本机业务可离线</strong><small>WS 前台和主动 AI 请求需要联网</small></div></div><div class="segment-summary governance-action-grid"><button class="summary-tile" data-action="import-csv"><span>导入客户 CSV / Excel</span><strong>＋</strong><small>智能识别</small></button><button class="summary-tile" data-action="export-all"><span>导出全部客户</span><strong>↓</strong><small>CSV 文件</small></button><button class="summary-tile" data-action="backup"><span>创建完整备份</span><strong>＋</strong><small>6.0 工作区</small></button><button class="summary-tile" data-action="download-template"><span>下载导入模板</span><strong>↓</strong><small>标准字段</small></button></div><div class="two-col-content"><section class="panel"><div class="panel-heading"><h2 class="panel-title">智能文件导入</h2></div><div class="funnel-content"><p class="governance-copy">CSV 与 Excel 文件全部在本机识别；字段顺序、渠道、状态和登记日期按每行判断，预览确认后才写入 6.0 数据库。</p><button class="btn" data-action="import-csv">${icons('upload')}选择 CSV / Excel 文件</button></div></section><section class="panel"><div class="panel-heading"><h2 class="panel-title">本地备份与恢复</h2></div><div class="funnel-content"><p class="governance-copy">备份只包含当前 6.0 工作区，可带到其他电脑恢复；恢复前会自动建立当前数据快照。</p><button class="btn primary" data-action="backup">${icons('cloud-down')}创建 JSON 备份</button><button class="btn governance-secondary-action" data-action="import-backup">${icons('upload')}从备份恢复</button><input type="file" id="importFile" accept=".csv,.tsv,.xlsx,.xls,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" hidden><input type="file" id="backupFile" accept=".json,application/json" hidden></div></section></div>`;loadSnapshotPanel();}
  function renderActivity(){const logs=state.activities.slice(0,30);$('#viewContainer').innerHTML=governanceHeading('操作记录','本地数据变更与自动化执行均在此留痕，便于追溯。','审计时间线',btn('导出记录','download','export-activity'),[['最近记录',logs.length,'当前显示上限 30 条','accent'],['记录来源','本机工作台','不依赖网络'],['审计状态','持续记录','按发生时间排序']])+`<section class="panel table-panel"><div class="table-toolbar"><div class="table-context"><strong>最近操作</strong><span>${logs.length} 条真实记录</span></div><label class="input-search">${icons('search')}<input data-activity-search placeholder="搜索操作内容"></label></div><table class="task-table"><thead><tr><th>操作内容</th><th>操作类型</th><th>操作时间</th><th>来源</th></tr></thead><tbody>${logs.map(a=>`<tr data-activity-row><td><div class="activity-item governance-activity-item"><i class="activity-dot"></i><div class="activity-text">${esc(a.text)}</div></div></td><td><span class="status-tag tag-blue">本地操作</span></td><td>${esc(a.time)}</td><td>本机工作台</td></tr>`).join('')||'<tr><td colspan="4" class="muted-cell">暂无操作记录</td></tr>'}</tbody></table></section>`;}
  function renderRecycle(){const list=state.customers.filter(c=>c.deleted);const pageCount=Math.max(1,Math.ceil(list.length/state.perPage));state.page=Math.min(state.page,pageCount);const start=(state.page-1)*state.perPage,visible=list.slice(start,start+state.perPage);$('#viewContainer').innerHTML=governanceHeading('回收站','已移除客户仍保留在本机，可核对后恢复或永久清理。','可恢复数据区',btn('清空回收站','x','empty-recycle','danger'),[['已删除客户',list.length,'可随时恢复','warning'],['当前页',state.page,'共 '+pageCount+' 页'],['数据状态','隔离保留','不参与业务统计']])+`<section class="panel table-panel"><div class="table-toolbar"><div class="table-context"><strong>已删除客户</strong><span>${list.length} 条</span></div></div><div class="table-scroll"><table class="data-table"><thead><tr>${['客户','原始号码','渠道','页面','跟进助理','进群状态','阶段','登记日期','操作'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${visible.length?visible.map(c=>`<tr><td>${esc(c.name)}</td><td class="phone-cell">${esc(c.rawPhone)}</td><td>${sourceTag(c.source)}</td><td>${esc(c.page||'—')}</td><td>${esc(c.assistant)}</td><td>${statusTag(c.status)}</td><td>${phaseTag(c.phase)}</td><td>${esc(c.registered)}</td><td><button class="table-action" data-action="restore-customer" data-id="${esc(c.id)}">恢复</button></td></tr>`).join(''):`<tr><td colspan="9" class="muted-cell governance-table-empty">回收站为空</td></tr>`}</tbody></table></div><div class="table-footer"><span>显示 ${list.length?start+1:0}–${Math.min(start+state.perPage,list.length)} 条，共 ${list.length} 条</span><div class="pagination"><button class="page-btn" data-page="${Math.max(1,state.page-1)}">‹</button><span>${state.page} / ${pageCount}</span><button class="page-btn" data-page="${Math.min(pageCount,state.page+1)}">›</button></div></div></section>`;}
  async function emptyRecycleWithSnapshot(){
    const recycled=state.customers.filter(customer=>customer.deleted);
    if(!recycled.length){toast('回收站已经为空');return;}
    const ids=new Set(recycled.map(customer=>selectionKey(customer.id)));
    const related={tickets:state.tickets.filter(row=>ids.has(selectionKey(row.customerId))).length,deposits:state.deposits.filter(row=>ids.has(selectionKey(row.customerId))).length,followups:state.followups.filter(row=>ids.has(selectionKey(row.customerId))).length,registrations:state.registrations.filter(row=>ids.has(selectionKey(row.customerId))).length};
    const relatedTotal=related.tickets+related.deposits+related.followups+related.registrations,detail=relatedTotal?`\n同时清除关联记录：跟票 ${related.tickets} 条、入金 ${related.deposits} 条、跟进 ${related.followups} 条、报名 ${related.registrations} 条。`:'';
    if(!confirm(`永久清除回收站中的 ${recycled.length} 位客户？${detail}\n此操作无法撤销，但会先创建本机快照。`))return;
    if(!await snapshotBeforeWrite('清空回收站前自动快照'))return;
    const before={customers:state.customers,tickets:state.tickets,deposits:state.deposits,followups:state.followups,registrations:state.registrations,activities:state.activities.slice()};
    state.customers=state.customers.filter(customer=>!ids.has(selectionKey(customer.id)));
    state.tickets=state.tickets.filter(row=>!ids.has(selectionKey(row.customerId)));
    state.deposits=state.deposits.filter(row=>!ids.has(selectionKey(row.customerId)));
    state.followups=state.followups.filter(row=>!ids.has(selectionKey(row.customerId)));
    state.registrations=state.registrations.filter(row=>!ids.has(selectionKey(row.customerId)));
    activity(`永久清空回收站，移除 ${recycled.length} 位客户及 ${relatedTotal} 条关联记录`);
    try{await flushStateWrites();}catch{Object.assign(state,before);persist();render();toast('清空保存失败，已恢复客户和所有关联记录','x');return;}
    render();toast(`已清空 ${recycled.length} 位客户及 ${relatedTotal} 条关联记录`);
  }
  async function sha256Text(value){const bytes=new TextEncoder().encode(String(value));const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
  async function passwordHash(value){return sha256Text(value);}
  function clearAllDataModal(){
    if(destructiveWriteBusy){toast('清空操作正在执行，请稍候');return;}
    const total=state.customers.length+state.tickets.length+state.deposits.length+state.followups.length+state.registrations.length+state.batchOperations.length+state.phoneRegistry.length+state.importIssues.length+(state.settings.operatingTasks?.length||0)+(state.settings.intakeBatches?.length||0)+(String(state.settings.intakeDraft?.text||'').trim()?1:0);
    if(!total){toast('本机业务全库数据已经为空');return;}
    if(!state.settings.clearDataPasswordHash){toast('请先在“系统设置 → 安全与备份”中设置清空密码','x');securitySettingsModal();return;}
    openModal('清空本机全库数据','此操作会先创建快照，密码验证通过后才会执行。',`<div class="notice-line">将清空 ${total} 条本机业务数据，包括客户、跟票、入金、跟进、报名、批量操作、手机号登记、任务中心和导入审计记录；快速录入草稿也会清空，系统设置、WS 登录账号与 WS 会话备份保留。操作完成后仍可从数据中心恢复清空前快照。</div><label class="filter-field"><span>清空密码</span><input id="clearDataVerify" type="password" maxlength="64" autocomplete="current-password" placeholder="输入系统设置中的清空密码"></label>`,`<button class="btn" data-action="close-modal">取消</button><button class="btn danger" data-action="confirm-clear-all-data">验证并清空</button>`);
    $('#clearDataVerify')?.focus();
  }
  async function clearAllDataWithSnapshot(password){
    if(destructiveWriteBusy){toast('清空操作正在执行，请稍候');return;}
    const total=state.customers.length+state.tickets.length+state.deposits.length+state.followups.length+state.registrations.length+state.batchOperations.length+state.phoneRegistry.length+state.importIssues.length+(state.settings.operatingTasks?.length||0)+(state.settings.intakeBatches?.length||0)+(String(state.settings.intakeDraft?.text||'').trim()?1:0);
    if(!total){toast('本机业务全库数据已经为空');return;}
    if(!state.settings.clearDataPasswordHash){toast('请先在“系统设置 → 安全与备份”中设置清空密码','x');securitySettingsModal();return;}
    if(!String(password||'')){toast('请输入清空密码','x');return;}
    if(await passwordHash(password)!==state.settings.clearDataPasswordHash){toast('密码错误，未执行清空','x');return;}
    if(!confirm('密码验证通过。确定继续清空全库数据？'))return;
    if(!await snapshotBeforeWrite('清空全库前自动快照'))return;
    const before={customers:state.customers,tickets:state.tickets,deposits:state.deposits,followups:state.followups,registrations:state.registrations,batchOperations:state.batchOperations,phoneRegistry:state.phoneRegistry,activities:state.activities,savedViews:state.savedViews,importIssues:state.importIssues,qualityDecisions:state.qualityDecisions,operatingTasks:state.settings.operatingTasks,intakeText:state.intakeText,parsed:state.parsed,pendingCsv:state.pendingCsv,qualityView:state.qualityView,intakeBatches:state.settings.intakeBatches,intakeDraft:state.settings.intakeDraft,intakeDefaults:state.settings.intakeDefaults,lastBatchUndo:state.lastBatchUndo,pendingBatch:state.pendingBatch,pendingExtendedBatch:state.pendingExtendedBatch,selected:new SelectionSet(state.selected)};
    destructiveWriteBusy=true;
    try{
      state.customers=[];state.tickets=[];state.deposits=[];state.followups=[];state.registrations=[];state.batchOperations=[];state.phoneRegistry=[];state.activities=[];state.importIssues=[];state.qualityDecisions={};state.savedViews=normalizeSavedViews([]);state.settings.operatingTasks=[];state.settings.intakeBatches=[];state.settings.intakeDraft={text:'',defaults:intakeDefaults()};state.settings.intakeDefaults=intakeDefaults();state.intakeText='';state.parsed=[];state.pendingCsv=null;state.qualityView='overview';state.lastBatchUndo=null;state.pendingBatch=null;state.pendingExtendedBatch=null;state.selected.clear();
      state.activities.unshift({text:'清空本机全库数据',time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),color:'green'});
      persist();
      await flushStateWrites();
      render();toast('本机全库数据已清空');
    }catch{
      Object.assign(state,before);state.settings.operatingTasks=before.operatingTasks;state.settings.intakeBatches=before.intakeBatches;state.settings.intakeDraft=before.intakeDraft;state.settings.intakeDefaults=before.intakeDefaults;state.intakeText=before.intakeText;state.parsed=before.parsed;state.selected=new SelectionSet(before.selected);persist();render();toast('清空保存失败，已恢复清空前的全部数据','x');
    }finally{
      destructiveWriteBusy=false;
    }
  }
  function notificationModal(){const n=counts(),stale=state.settings.staleHotReminder===false?[]:staleHotCustomers();const items=[];if(n.overdue)items.push(`<button class="notice-row" data-action="go-followups"><strong>${n.overdue} 位客户已逾期</strong><span>打开客户中心处理</span></button>`);if(n.due)items.push(`<button class="notice-row" data-action="go-followups"><strong>${n.due} 位客户今天待跟进</strong><span>查看今日计划</span></button>`);if(stale.length)items.push(`<button class="notice-row" data-action="go-hot-stale"><strong>${stale.length} 位热聊客户近期未跟进</strong><span>查看提醒名单</span></button>`);const quality=qualityScan(),pending=pendingImportIssues().length+quality.duplicates.length+quality.vipDuplicates.length+quality.invalid.length;if(pending)items.push(`<button class="notice-row" data-action="go-quality"><strong>${pending} 项数据待复核</strong><span>打开数据治理</span></button>`);const backup=backupHealth();if(backup.needed)items.push(`<button class="notice-row" data-action="go-data"><strong>${backup.label}</strong><span>前往数据中心创建可迁移备份</span></button>`);openModal('本地提醒','按当前客户数据即时计算，不联网、不生成虚假通知',items.join('')||'<div class="empty-state">当前没有待处理提醒</div>','<button class="btn" data-action="close-modal">关闭</button>');}
  function renderSettings(){const opts=[['渠道',`当前 ${sources.length} 项，可新增自定义渠道`],['群粉类型',`当前 ${groupFanSources.length} 项；有客户数据时自动显示在群组管理`],['跟进助理',`当前 ${assistants.length} 项，可新增自定义助理`],['页面分类',`当前 ${pages.length} 项，可用于任意渠道`],['群编号',`当前 ${groupIds.length} 项，录入时自动识别`],['客户状态',`当前 ${statuses.length} 项，管理进群、退群等状态`],['客户阶段',`当前 ${phases.length} 个阶段，可自定义名称`],['安全与备份','设置关闭快照与本机快照保留数量']];$('#viewContainer').innerHTML=governanceHeading('系统设置','统一维护识别规则、业务选项、界面偏好和本机数据保护。','工作台控制面板','',[['业务选项',opts.length,'所有页面实时同步','accent'],['存储模式','本机 SQLite','统一数据源'],['自动快照',state.settings.autoCloseSnapshot===false?'已暂停':'已启用','可在安全设置调整'],['快照保留',Math.min(100,Math.max(1,Number(state.settings.snapshotRetention)||20)),'最近记录']])+`<div class="two-col-content"><section class="panel"><div class="panel-heading"><h2 class="panel-title">业务选项</h2><span class="panel-note">选项仅保存在本机工作区</span></div><table class="task-table"><tbody>${opts.map(([name,description])=>`<tr><td class="settings-key-cell"><strong>${name}</strong></td><td>${description}</td><td><button class="table-action" data-action="edit-setting" data-setting="${esc(name)}">管理 ${icons('chevron-right')}</button></td></tr>`).join('')}</tbody></table></section><section class="panel"><div class="panel-heading"><h2 class="panel-title">本机数据服务</h2><span class="panel-note">${document.documentElement.dataset.desktopHost==='true'?'SQLite sidecar 已由桌面应用托管':'本机模式'}</span></div><div class="funnel-content"><div class="local-note">${icons('database')}所有客户、业务、WS、AI 和跟进数据均写入本机 SQLite。</div><p class="panel-note governance-copy">数据目录位于 Windows 用户应用数据目录，应用关闭前会完成待写入队列；可在数据中心创建备份并迁移到新电脑。</p><div class="automation-switch"><span>网络依赖</span><span class="status-tag tag-green">不需要</span></div><div class="automation-switch"><span>服务监听</span><span class="status-tag tag-blue">仅本机</span></div><button class="btn primary" data-action="go-data">打开数据中心</button></div></section><section class="panel"><div class="panel-heading"><h2 class="panel-title">隐私与安全</h2></div><div class="funnel-content"><div class="local-note">${icons('shield')}离线运行 · 服务仅监听本机</div><div class="automation-switch"><span>客户资料保存</span><span class="status-tag tag-green">本机数据库</span></div><div class="automation-switch"><span>批量写入前快照</span><span class="status-tag tag-green">固定保护</span></div><div class="automation-switch"><span>关闭时自动快照</span><span class="status-tag ${state.settings.autoCloseSnapshot===false?'tag-gray':'tag-green'}">${state.settings.autoCloseSnapshot===false?'已暂停':'已启用'}</span></div><div class="automation-switch"><span>快照保留</span><span class="status-tag tag-blue">最近 ${Math.min(100,Math.max(1,Number(state.settings.snapshotRetention)||20))} 个</span></div><button class="btn small" data-action="edit-setting" data-setting="安全与备份">调整安全与备份</button></div></section></div>`;}
  function optionListModal(key){const item=optionCatalog[key];if(!item)return;const usage=value=>state.customers.filter(customer=>({sources:customer.source,groupFanSources:customer.source,assistants:customer.assistant,pages:customer.page,groupIds:customer.group,statuses:customer.status,phases:customer.phase}[key])===value).length,canRemove=item.values.length>1||key==='groupFanSources';openModal(`管理${item.label}`,'重命名或删除会同步更新客户、业务记录、录入默认项和筛选条件；保存失败会整体还原。',`<div class="preview-table-wrap" style="max-height:300px"><table class="preview-table"><thead><tr><th>${item.label}</th><th>使用中</th><th>操作</th></tr></thead><tbody>${item.values.map(value=>`<tr><td>${esc(value)}</td><td>${usage(value)} 位客户</td><td><button class="table-action" data-option-edit="${key}" data-option-value="${esc(value)}">重命名</button> <button class="table-action danger-text" data-option-remove="${key}" data-option-value="${esc(value)}" ${canRemove?'':'disabled'}>删除</button></td></tr>`).join('')||`<tr><td colspan="3" class="muted-cell">暂无选项，请添加或恢复默认项</td></tr>`}</tbody></table></div><div class="filter-grid" style="grid-template-columns:minmax(0,1fr) auto;margin-top:12px"><label class="filter-field"><span>新增${item.label}</span><input id="optionValue" maxlength="48" placeholder="输入名称"></label><button class="btn primary" data-action="add-option" data-option-key="${key}" style="align-self:end">添加</button></div>`,`<button class="btn" data-action="reset-options" data-option-key="${key}">恢复此类默认项</button><button class="btn" data-action="close-modal">完成</button>`);}
   async function renameOption(key,oldValue){const item=optionCatalog[key];if(!item||!item.values.includes(oldValue))return;const answer=await requestText(`修改${item.label}名称`,'名称会同步更新所有关联资料、业务记录和筛选。',oldValue,{label:item.label,maxLength:48});if(answer===null)return;const value=answer.trim().slice(0,48);if(!value){toast('名称不能为空','x');return;}if(value.toLocaleLowerCase()!==oldValue.toLocaleLowerCase()&&item.values.some(option=>option.toLocaleLowerCase()===value.toLocaleLowerCase())){toast('此名称已存在','x');return;}if(value===oldValue){toast('名称没有变化');return;}if(!await snapshotBeforeWrite(`修改${item.label}选项前自动快照`))return;const before=cloneStateData(statePayload()),beforeOptions=Object.fromEntries(Object.entries(optionCatalog).map(([name,entry])=>[name,[...entry.values]]));item.values.splice(item.values.indexOf(oldValue),1,value);if(key==='sources'){const groupFanIndex=groupFanSources.indexOf(oldValue);if(groupFanIndex>=0)groupFanSources.splice(groupFanIndex,1,value);}if(key==='groupFanSources'){const sourceIndex=sources.indexOf(oldValue);if(sourceIndex>=0)sources.splice(sourceIndex,1,value);else if(!sources.includes(value))sources.push(value);}if(key==='sources'||key==='groupFanSources')renameSourceIdentity(oldValue,value);replaceOptionReferences(key,oldValue,value);if((key==='sources'||key==='groupFanSources')&&oldValue&&value)state.channelAliases[oldValue]=value;persistOptionLists(key,oldValue,value);activity(`重命名${item.label}选项：${oldValue} → ${value}`);try{await flushStateWrites();}catch{applySharedData(before);for(const [name,values] of Object.entries(beforeOptions))optionCatalog[name].values.splice(0,optionCatalog[name].values.length,...values);persistOptionLists();toast('选项修改未能保存，已整体还原','x');return;}optionListModal(key);render();toast(`已同步更新${item.label}及所有关联数据：${value}`);}
   async function removeOption(key,value){const item=optionCatalog[key];if(!item||!item.values.includes(value)||(item.values.length<=1&&key!=='groupFanSources'))return;const field={sources:'source',groupFanSources:'source',assistants:'assistant',pages:'page',groupIds:'group',statuses:'status',phases:'phase'}[key],usage=state.customers.filter(customer=>customer[field]===value).length,fallback=optionFallback(key,value);if(!confirm(`确认删除“${value}”？${usage?`\n当前关联 ${usage} 位客户，将统一调整为“${fallback||'空白'}”。`:''}\n跟票、入金、报名、默认录入与筛选中的关联值也会同步更新。`))return;if(!await snapshotBeforeWrite(`删除${item.label}选项前自动快照`))return;const before=cloneStateData(statePayload()),beforeOptions=Object.fromEntries(Object.entries(optionCatalog).map(([name,entry])=>[name,[...entry.values]])),beforeDeleted=structuredClone(state.settings.deletedOptionValues||{}),index=item.values.indexOf(value);item.values.splice(index,1);if(key==='groupFanSources'||key==='sources'){const sourceIndex=sources.indexOf(value);if(sourceIndex>=0)sources.splice(sourceIndex,1);const groupIndex=groupFanSources.indexOf(value);if(groupIndex>=0)groupFanSources.splice(groupIndex,1);for(const optionKey of ['sources','groupFanSources']){state.settings.deletedOptionValues??={};state.settings.deletedOptionValues[optionKey]=[...new Set([...(state.settings.deletedOptionValues[optionKey]||[]),value])];}disableSourceIdentity(value,fallback);}else{state.settings.deletedOptionValues??={};state.settings.deletedOptionValues[key]=[...new Set([...(state.settings.deletedOptionValues[key]||[]),value])];}replaceOptionReferences(key,value,fallback);if((key==='sources'||key==='groupFanSources')&&value&&fallback)state.channelAliases[value]=fallback;persistOptionLists(key,value,fallback);activity(`删除${item.label}选项：${value}${usage?`，${usage} 位客户同步调整为 ${fallback||'空白'}`:''}`);try{await flushStateWrites();}catch{applySharedData(before);for(const [name,values] of Object.entries(beforeOptions))optionCatalog[name].values.splice(0,optionCatalog[name].values.length,...values);state.settings.deletedOptionValues=beforeDeleted;persistOptionLists();toast('选项删除未能保存，已整体还原','x');return;}optionListModal(key);render();toast(`已删除“${value}”，相关页面与记录已同步`);}
   async function resetOptionList(key){const item=optionCatalog[key];if(!item)return;if(!confirm(`将“${item.label}”恢复为随应用提供的默认选项？当前客户资料不会改变，用户自定义选项会移除。`))return;if(!await snapshotBeforeWrite(`恢复${item.label}默认选项前自动快照`))return;const before=[...item.values],previousActivities=state.activities.slice(),beforeDeleted=structuredClone(state.settings.deletedOptionValues||{});item.values.splice(0,item.values.length,...defaultOptionLists[key]);if(state.settings.deletedOptionValues)delete state.settings.deletedOptionValues[key];if(key==='sources'||key==='groupFanSources'){delete state.settings.deletedOptionValues?.sources;delete state.settings.deletedOptionValues?.groupFanSources;for(const value of defaultOptionLists[key])if(!sources.includes(value))sources.push(value);for(const value of defaultOptionLists[key])if(!groupFanSources.includes(value)&&value==='群粉')groupFanSources.push(value);}persistOptionLists();activity(`恢复${item.label}默认选项`);try{await flushStateWrites();}catch{item.values.splice(0,item.values.length,...before);state.activities=previousActivities;state.settings.deletedOptionValues=beforeDeleted;persistOptionLists();toast('恢复默认选项未能保存，已还原','x');return;}optionListModal(key);render();toast(`${item.label}已恢复默认选项`);}
   async function addOption(key){const item=optionCatalog[key],input=$('#optionValue'),raw=input?.value.trim();if(!item||!raw){toast('请输入要新增的选项');return;}const value=key==='groupIds'?raw.toUpperCase():raw;if(item.values.some(option=>option.toLocaleLowerCase()===value.toLocaleLowerCase())){toast('此选项已存在');return;}if(!await snapshotBeforeWrite(`新增${item.label}选项前自动快照`))return;const previousActivities=state.activities.slice();item.values.push(value);persistOptionLists();activity(`新增${item.label}选项：${value}`);try{await flushStateWrites();}catch{item.values.pop();state.activities=previousActivities;persistOptionLists();toast('选项新增未能保存，已还原','x');return;}optionListModal(key);render();toast(`已新增选项：${value}`);}
  function securitySettingsModal(){openModal('安全与备份','工作区随应用文件夹迁移；自动快照只保存在本机。',`<div class="filter-grid" style="grid-template-columns:1fr"><label class="filter-field"><span>本机快照保留数量</span><select id="snapshotRetention">${[10,20,30,50,100].map(value=>`<option value="${value}" ${Number(state.settings.snapshotRetention||20)===value?'selected':''}>最近 ${value} 个</option>`).join('')}</select></label><label class="column-choice"><input id="autoCloseSnapshot" type="checkbox" ${state.settings.autoCloseSnapshot===false?'':'checked'}><span>正常关闭应用时创建快照</span></label>${state.settings.clearDataPasswordHash?'<label class="filter-field"><span>当前清空密码</span><input id="clearDataOldPassword" type="password" maxlength="64" autocomplete="current-password" placeholder="修改密码时必须验证"></label>':''}<label class="filter-field"><span>${state.settings.clearDataPasswordHash?'新的清空密码':'设置清空全库密码'}</span><input id="clearDataPassword" type="password" maxlength="64" autocomplete="new-password" placeholder="${state.settings.clearDataPasswordHash?'留空表示不修改':'至少 6 位'}"></label><label class="filter-field"><span>再次输入新密码</span><input id="clearDataPasswordConfirm" type="password" maxlength="64" autocomplete="new-password" placeholder="请再输入一次"></label></div><div class="notice-line">修改清空密码必须先验证当前密码。密码只在本机保存不可逆摘要，不保存明文；恢复快照前也会自动保护当前数据。</div>`,`<button class="btn" data-action="close-modal">取消</button><button class="btn primary" data-action="save-security-settings">保存设置</button>`);}
  async function saveSecuritySettings(){const password=$('#clearDataPassword')?.value||'',confirmation=$('#clearDataPasswordConfirm')?.value||'',oldPassword=$('#clearDataOldPassword')?.value||'',before=structuredClone(state.settings),beforeActivities=state.activities.slice();if(password||confirmation){if(state.settings.clearDataPasswordHash&&await passwordHash(oldPassword)!==state.settings.clearDataPasswordHash){toast('当前清空密码不正确，未修改密码','x');return;}if(password.length<6){toast('清空密码至少 6 位','x');return;}if(password!==confirmation){toast('两次输入的新密码不一致','x');return;}state.settings.clearDataPasswordHash=await passwordHash(password);}state.settings.snapshotRetention=Math.min(100,Math.max(10,Number($('#snapshotRetention').value)||20));state.settings.autoCloseSnapshot=$('#autoCloseSnapshot').checked;activity(`更新本机快照与清空密码保护${password?'，已验证并更新密码':''}`);try{await flushStateWrites();closeModal();render();toast('安全与备份设置已保存');}catch(error){state.settings=before;state.activities=beforeActivities;persist();render();toast(error.message||'安全与备份设置保存失败，已恢复原设置','x');}}
  async function loadSnapshotPanel(){if(!window.__LOCAL_DB__||state.view!=='data')return;try{const result=await fetch('/api/snapshots').then(r=>{if(!r.ok)throw new Error();return r.json();});if(state.view!=='data')return;const snapshots=result.snapshots||[],latest=snapshots[0];const recent=$('#recentSnapshot');if(recent)recent.textContent=latest?new Date(latest.createdAt).toLocaleString():'尚无快照';const rows=snapshots.map(s=>`<tr><td>${esc(new Date(s.createdAt).toLocaleString())}</td><td>${esc(s.reason)}</td><td>${Number(s.customers)||0}</td><td>${Number(s.phoneRegistry)||0}</td><td>${Number(s.registrations)||0}</td><td>${Number(s.businessRecords)||0}</td><td><button class="table-action" data-action="restore-local-snapshot" data-id="${s.id}">恢复此快照</button></td></tr>`).join('');$('#snapshotPanel')?.remove();$('#viewContainer').insertAdjacentHTML('beforeend',`<section id="snapshotPanel" class="panel table-panel governance-stacked-panel"><div class="panel-heading"><h2 class="panel-title">本机自动快照</h2><span class="panel-note">最多保留最近 ${Math.min(100,Math.max(1,Number(state.settings.snapshotRetention)||20))} 个 · ${snapshots.length} 个可用</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>创建时间</th><th>快照原因</th><th>客户数</th><th>手机号登记</th><th>报名</th><th>跟票/入金</th><th>操作</th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="muted-cell">尚无快照，批量导入或恢复前会自动创建</td></tr>'}</tbody></table></div></section>`);}catch{if(state.view==='data'){$('#recentSnapshot').textContent='读取失败';$('#viewContainer').insertAdjacentHTML('beforeend','<div class="notice-line">暂时无法读取本机快照列表。</div>');}}}
  async function restoreLocalSnapshot(id){if(!confirm('将用此快照替换当前工作区？恢复前会自动保存当前数据为新快照。'))return;try{await flushStateWrites();const response=await fetch(`/api/snapshots/${encodeURIComponent(id)}/restore`,{method:'POST',headers:{'X-State-Version':stateVersion}});const result=await response.json();if(!response.ok)throw new Error(result.error||'快照恢复失败');const loaded=await fetch('/api/state').then(r=>r.json());applySharedData(loaded);stateVersion=String(loaded.version||result.version||'');lastCommittedState=cloneStateData(statePayload());activity(`从本机快照恢复 ${result.customers} 位客户`);await flushStateWrites();lastCommittedState=cloneStateData(statePayload());closeModal();render();toast(`快照恢复完成：${result.customers} 位客户`);}catch(error){toast(error.message||'快照恢复失败','x');}}

  function business6ModuleContext(){
    const view=state.view,supported=['groups','vip','tickets','registrations','deposits','analytics'];
    if(!supported.includes(view))return null;
    const customers=activeCustomers();
    if(view==='groups'){
      const rows=customers.filter(customer=>isGroupFanSource(effectiveCustomerSource(customer))),joined=rows.filter(customer=>['已进群','在群'].includes(customer.status)).length,left=rows.filter(customer=>['已退群','临时退群'].includes(customer.status)).length,channels=new Set(rows.map(customer=>effectiveCustomerSource(customer)).filter(Boolean)).size;
      return {eyebrow:'CHANNEL MEMBERSHIP LENS',title:'群组与渠道运营面',note:'按系统设置中的具体渠道动态拆分进群、退群与当前在群，不再把所有群粉合并。',metrics:[['群组客户',rows.length],['当前在群',joined],['已退群',left],['渠道分类',channels]],rule:'渠道设置、导入识别与进退群事件共用同一套分类；删除或重命名会同步更新关联记录。'};
    }
    if(view==='vip'){
      const rows=customers.filter(customer=>String(customer.vipNumber||'').trim());
      return {eyebrow:'PRIORITY CUSTOMER LENS',title:'VIP 客户关系面',note:'VIP 编号是客户主档的优先级标识，不复制客户，也不形成第二套资料。',metrics:[['VIP 客户',rows.length],['今日登记',rows.filter(customer=>customer.registered===today).length],['待跟进',rows.filter(customer=>!customer.lastFollow||customer.lastFollow<today).length],['唯一编号',new Set(rows.map(customer=>String(customer.vipNumber).trim())).size]],rule:'VIP 编号保持唯一并与号码主档联动；移出 VIP 只清除标识，不删除客户或历史业务。'};
    }
    if(view==='tickets'){
      const rows=state.tickets.flatMap(record=>expandTicketRecords(record)),customerCount=new Set(rows.map(record=>String(record.customerId||linkedPhone(record.phone))).filter(Boolean)).size;
      return {eyebrow:'POSITION ACTIVITY LEDGER',title:'跟票交易记录面',note:'同一客户、不同股票、买入与卖出按独立业务记录保存并可回到客户主档。',metrics:[['跟票记录',rows.length],['关联客户',customerCount],['待确认',rows.filter(record=>record.status==='待确认').length],['股票分类',new Set(rows.map(record=>String(record.product||'').trim()).filter(Boolean)).size]],rule:'客户主档不合并交易记录；产品、方向和交易日期共同决定业务唯一性。'};
    }
    if(view==='registrations'){
      const rows=state.registrations.filter(record=>record.status==='已报名');
      return {eyebrow:'REGISTRATION CONVERSION LEDGER',title:'报名转化记录面',note:'只有明确选择“已报名”的独立记录才进入报名统计，并持续关联原客户。',metrics:[['报名记录',rows.length],['报名客户',new Set(rows.map(record=>String(record.customerId))).size],['今日报名',rows.filter(record=>String(record.date||record.createdAt||'').slice(0,10)===today).length],['来源数量',new Set(rows.map(record=>String(record.source||'').trim()).filter(Boolean)).size]],rule:'报名记录与客户资料分离保存；删除记录后会按剩余记录重新计算客户报名状态。'};
    }
    if(view==='deposits'){
      const rows=state.deposits,customerCount=new Set(rows.map(record=>String(record.customerId||linkedPhone(record.phone))).filter(Boolean)).size;
      return {eyebrow:'CAPITAL CONVERSION LEDGER',title:'入金资金记录面',note:'每笔入金独立保存金额、币种和日期，客户主档仅汇总关联结果。',metrics:[['入金记录',rows.length],['入金客户',customerCount],['累计金额',money(rows.reduce((sum,record)=>sum+recordAmount(record),0))],['待确认',rows.filter(record=>record.status==='待确认').length]],rule:'入金不与跟票或客户登记混写；编辑和删除后客户汇总金额会同步重算。'};
    }
    const n=counts();
    return {eyebrow:'LIVE BUSINESS INTELLIGENCE',title:'业务下钻驾驶舱',note:'全部指标由当前客户主档与独立业务记录实时计算，点击分类即可进入对应明细。',metrics:[['客户总量',n.total],['进群率',`${Math.round(n.joined/Math.max(1,n.total)*100)}%`],['跟票转化',`${Math.round(n.ticket/Math.max(1,n.total)*100)}%`],['入金转化',`${Math.round(n.deposit/Math.max(1,n.total)*100)}%`]],rule:'统计沿用原有口径，不制造演示值；渠道、客户、群组与业务指标均可回溯到真实记录。'};
  }
  function enhanceBusiness6ModuleShell(){
    const container=$('#viewContainer'),context=business6ModuleContext();
    if(!container)return;
    delete container.dataset.business6;
    $('#business6CommandDeck')?.remove();
    if(!context)return;
    container.dataset.business6=state.view;
    const headingNode=container.querySelector('.page-heading');
    if(!headingNode)return;
    const metrics=context.metrics.map(([label,value])=>`<div class="business6-signal"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
    headingNode.insertAdjacentHTML('afterend',`<section class="business6-command-deck" id="business6CommandDeck" aria-label="${esc(context.title)}"><div class="business6-command-copy"><span class="business6-eyebrow">${esc(context.eyebrow)}</span><strong>${esc(context.title)}</strong><p>${esc(context.note)}</p></div><div class="business6-signal-grid">${metrics}</div><details class="business6-rule"><summary>业务口径</summary><p>${esc(context.rule)}</p></details></section>`);
  }

  function render(){
    document.documentElement.dataset.view=state.view||'home';
    normalizeStateIdentifiers();
    const normalizedViews=normalizeSavedViews(state.savedViews);if(JSON.stringify(normalizedViews)!==JSON.stringify(state.savedViews)){state.savedViews=normalizedViews;persist();}
    updateCounts();
    switch(state.view){case'home':renderHome();break;case'gpt':window.ZhikeGPT?.render?.();break;case'registrations':renderRegistrations();break;case'customers':renderCustomers();break;case'segments':renderSegments();break;case'intake':renderIntake();break;case'operations':case'stage-board':window.ZhikeOperationsUI?.render?.(true);break;case'followups':renderFollowups();break;case'hot':renderHot();break;case'vip':renderVip();break;case'tickets':case'deposits':renderBusiness(state.view);break;case'groups':try{renderGroups();}catch(error){console.error('[groups] render failed',error);$('#viewContainer').innerHTML=heading('群组管理','页面数据存在异常，已保护其他模块。')+'<div class="notice-line error-line">群组数据暂时无法展示，请先检查数据中心的异常记录后重试。</div>';}break;case'analytics':renderAnalytics();break;case'automation':state.automationView==='assistant-suggestions'&&state.settings.assistantSuggestions!==false?renderAssistantSuggestions():renderAutomation();break;case'quality':renderQuality();break;case'data':renderData();loadSnapshotPanel();break;case'activity':renderActivity();break;case'recycle':renderRecycle();break;case'settings':renderSettings();break;case'phone-registry':window.zhikePhoneRegistry?.render();break;default:renderHome();}
    enhanceBusiness6ModuleShell();
    if(state.view==='home'&&!activeCustomers().length){const panel=[...$('#viewContainer').querySelectorAll('.panel')].find(item=>item.textContent.includes('最近动态'));if(panel){const list=panel.querySelector('.activity-list');if(list)list.innerHTML='<div class="empty-state"><p>录入客户或导入业务数据后，最近动态会显示在这里。</p><button class="btn small" data-action="go-data">导入数据</button></div>';}}
    document.querySelectorAll('.trend-svg').forEach(svg=>{svg.setAttribute('role','img');svg.setAttribute('aria-label','近七日新增客户与跟进记录趋势图');});
    if(state.view==='home'&&!$('#viewContainer .home-reference-command')){const business=businessSummaryIndex(),profiles=activeCustomers().map(customer=>crmProfile(customer,business)),command=[['S/A 重点客户',profiles.filter(profile=>['S','A'].includes(profile.grade)).length],['首次联系待完成',profiles.filter(profile=>profile.nextAction==='完成首次联系').length],['需要推进跟票',profiles.filter(profile=>profile.nextAction.includes('推动跟票')).length],['沉睡/流失唤醒',profiles.filter(profile=>profile.stage.includes('唤醒')).length]];$('#viewContainer .page-heading')?.insertAdjacentHTML('afterend',`<section class="crm-command-strip"><div class="crm-command-title"><strong>CRM 今日指挥台</strong><span>按客户价值与下一步动作实时计算</span></div>${command.map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</section>`);}
    if(state.view==='analytics'){const business=businessSummaryIndex(),profiles=activeCustomers().map(customer=>crmProfile(customer,business)),stages=['新线索','持续跟进','已进群培育','重点培育','跟票转化','已成交','沉睡唤醒','流失唤醒'];$('#crmPipelinePanel')?.remove();$('#viewContainer').insertAdjacentHTML('beforeend',`<section id="crmPipelinePanel" class="panel crm-pipeline-panel" style="margin-top:14px"><div class="panel-heading"><h2 class="panel-title">CRM 生命周期与客户质量</h2><span class="panel-note">评分、阶段和下一步动作均由现有业务数据实时计算</span></div><div class="crm-grade-grid">${['S','A','B','C','D'].map(grade=>`<div><span>${grade} 级客户</span><strong>${profiles.filter(profile=>profile.grade===grade).length}</strong></div>`).join('')}</div><div class="crm-stage-grid">${stages.map(stage=>`<div><span>${stage}</span><strong>${profiles.filter(profile=>profile.stage===stage).length}</strong></div>`).join('')}</div></section>`);}
    if(state.view==='settings'){const note=$$('#viewContainer p.panel-note').find(p=>p.textContent.includes('本版本数据保存在'));if(note)note.textContent='客户资料保存在 Windows 用户应用数据目录。换电脑请在数据中心导出完整 JSON 备份，再到新电脑恢复。';$('#settingsCompletePanel')?.remove();$('#viewContainer').insertAdjacentHTML('beforeend',`<section id="settingsCompletePanel" class="panel settings-complete-panel"><div class="panel-heading"><h2 class="panel-title">界面、效率与数据生命周期</h2><span class="panel-note">所有设置写入本机配置</span></div><div class="settings-actions"><label class="filter-field"><span>默认每页条数</span><select id="defaultPerPage"><option value="10" ${state.perPage===10?'selected':''}>10</option><option value="20" ${state.perPage===20?'selected':''}>20</option><option value="50" ${state.perPage===50?'selected':''}>50</option></select></label><label class="filter-field"><span>界面主题</span><select id="appearanceTheme"><option value="light" ${effectiveTheme()!=='dark'?'selected':''}>明亮科技</option><option value="dark" ${effectiveTheme()==='dark'?'selected':''}>深色科技</option></select></label><label class="filter-field"><span>界面密度</span><select id="appearanceDensity"><option value="comfortable" ${state.settings.density!=='compact'?'selected':''}>舒适</option><option value="compact" ${state.settings.density==='compact'?'selected':''}>紧凑</option></select></label><button class="btn small" data-action="save-preferences">保存界面偏好</button><button class="btn danger small" data-action="clear-all-data">${icons('trash')}一键清空全库数据</button></div></section>`);}
    if(state.view==='tickets'||state.view==='deposits'){const periods=['all','today','week','month','pending'];$$('#viewContainer .subnav button').slice(0,5).forEach((button,index)=>{button.dataset.businessPeriod=periods[index];button.classList.toggle('active',state.businessPeriod===periods[index]);});}
  }

  function renderRegistrations(){
    const activeList=activeCustomers(),customerMap=new Map(activeList.map(customer=>[String(customer.id),customer]));
    const allRows=state.registrations.filter(item=>item.status==='已报名'&&customerMap.has(String(item.customerId))).sort((a,b)=>String(b.date||b.createdAt).localeCompare(String(a.date||a.createdAt)));
    const unique=new Set(allRows.map(item=>String(item.customerId))),query=String(state.registrationSearch||'').trim().toLocaleLowerCase(),source=state.registrationSource||'全部',owner=state.registrationOwner||'全部';
    const filteredRows=allRows.filter(row=>{const customer=customerMap.get(String(row.customerId)),assigned=String(row.owner||customer?.assistant||'未分配'),searchText=[customer?.name,customer?.phone,customer?.rawPhone,row.source,row.owner,customer?.assistant,row.note].filter(Boolean).join(' ').toLocaleLowerCase();return (source==='全部'||String(row.source||'')===source)&&(owner==='全部'||assigned===owner)&&(!query||searchText.includes(query));});
    const pageSize=state.perPage||10,pageCount=Math.max(1,Math.ceil(filteredRows.length/pageSize));state.registrationPage=Math.min(Math.max(1,state.registrationPage||1),pageCount);const start=(state.registrationPage-1)*pageSize,visibleRows=filteredRows.slice(start,start+pageSize);
    const sourceOptions=[...new Set(allRows.map(row=>String(row.source||'')).filter(Boolean))];
    const headerFilters=`<div class="toolbar-controls registration-header-filters"><label class="input-search">${icons('search')}<input data-registration-search value="${esc(state.registrationSearch||'')}" placeholder="搜索客户、来源、负责人、备注"></label><select data-registration-filter="source"><option value="全部" ${source==='全部'?'selected':''}>全部来源</option>${sourceOptions.map(value=>`<option value="${esc(value)}" ${source===value?'selected':''}>${esc(value)}</option>`).join('')}</select><select data-registration-filter="owner"><option value="全部" ${owner==='全部'?'selected':''}>全部负责人</option>${assistants.map(value=>`<option value="${esc(value)}" ${owner===value?'selected':''}>${esc(value)}</option>`).join('')}</select></div>`;
    const rows=visibleRows.map(row=>{const customer=customerMap.get(String(row.customerId)),assigned=row.owner||customer?.assistant||'未分配';return `<tr data-registration-row data-source="${esc(row.source||'')}" data-owner="${esc(assigned)}" data-customer="${esc(row.customerId)}"><td>${esc(String(row.date||row.createdAt||'').slice(0,16).replace('T',' '))}</td><td>${esc(customer?.name||'未关联客户')}</td><td>${esc(customer?.rawPhone||customer?.phone||'—')}</td><td>${esc(row.source||'—')}</td><td>${esc(assigned)}</td><td>${esc(row.note||'—')}</td><td><button class="table-action" data-customer="${esc(row.customerId)}">客户档案</button><button class="table-action danger-text" data-action="delete-registration-record" data-id="${esc(row.id)}">删除</button></td></tr>`;}).join('')||'<tr><td colspan="7" class="muted-cell">当前筛选没有报名记录</td></tr>';
    const pending=allRows.filter(row=>{const customer=customerMap.get(String(row.customerId));return customer&&(!customer.lastFollow||customer.lastFollow<String(row.date).slice(0,10));}).length;
    $('#viewContainer').innerHTML=heading('报名转化管理','报名状态默认为空；只有明确选择“已报名”才计入统计',`${headerFilters}${btn('新增报名','plus','new-registration','primary')}${btn('导出全部报名','download','export-registrations')}`)+`<div class="business-summary"><div class="business-kpi"><span>已报名客户</span><strong>${unique.size}</strong></div><div class="business-kpi"><span>报名记录</span><strong>${allRows.length}</strong></div><div class="business-kpi"><span>今日报名</span><strong>${allRows.filter(r=>String(r.date).slice(0,10)===today).length}</strong></div><div class="business-kpi"><span>待跟进报名</span><strong>${pending}</strong></div></div><section class="panel table-panel"><div class="table-toolbar"><div class="table-context"><strong>报名记录</strong><span>当前筛选 ${filteredRows.length} 条 · 仅渲染第 ${filteredRows.length?start+1:0}–${Math.min(start+pageSize,filteredRows.length)} 条</span></div></div><div class="table-scroll"><table class="data-table"><thead><tr><th>报名时间</th><th>客户</th><th>号码</th><th>来源</th><th>负责人</th><th>备注</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div><div class="table-footer"><span>全部报名记录 ${allRows.length} 条</span><div class="pagination"><button class="page-btn" data-action="registration-page" data-page="${Math.max(1,state.registrationPage-1)}" ${state.registrationPage===1?'disabled':''}>‹</button><span>${state.registrationPage} / ${pageCount}</span><button class="page-btn" data-action="registration-page" data-page="${Math.min(pageCount,state.registrationPage+1)}" ${state.registrationPage===pageCount?'disabled':''}>›</button></div></div></section>`;
  }

  function registrationModal(){const customers=activeCustomers();openModal('新增报名记录','报名信息将独立保存并关联客户档案',`<div class="filter-grid">${customerPickerHtml('registrationCustomer',customers,'','客户')}<label class="filter-field"><span>报名状态</span><select id="registrationStatus"><option value="">未选择（不计统计）</option><option value="已报名">已报名</option></select></label><label class="filter-field"><span>报名时间</span><input id="registrationDate" type="datetime-local" value="${new Date().toISOString().slice(0,16)}"></label><label class="filter-field"><span>报名来源</span><input id="registrationSource" placeholder="活动、页面或渠道"></label><label class="filter-field"><span>负责人</span><select id="registrationOwner">${assistants.map(v=>`<option>${esc(v)}</option>`).join('')}</select></label><label class="filter-field" style="grid-column:1/-1"><span>备注</span><textarea id="registrationNote" rows="3"></textarea></label></div>`,`<button class="btn" data-action="close-modal">取消</button><button class="btn primary" data-action="save-registration">保存报名</button>`);}
  let modalReturnFocus=null;
  function openModal(title,subtitle,body,footer=''){modalReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;$('#modal').innerHTML=`<div class="modal-header"><div><h2>${title}</h2><p>${subtitle}</p></div><button class="modal-close" data-action="close-modal" aria-label="关闭对话框">${icons('x')}</button></div><div class="modal-body">${body}</div>${footer?`<div class="modal-footer">${footer}</div>`:''}`;$('#modalBackdrop').classList.remove('hidden');$('#modal .modal-close')?.focus();}
  function requestText(title,subtitle='',initial='',options={}){return new Promise(resolve=>{const type=options.type||'text',multiline=Boolean(options.multiline),inputId=`zhikeTextRequest-${Date.now().toString(36)}`;const field=multiline?`<textarea id="${inputId}" rows="5" maxlength="${Number(options.maxLength)||500}">${esc(initial)}</textarea>`:`<input id="${inputId}" type="${esc(type)}" maxlength="${Number(options.maxLength)||200}" value="${esc(initial)}" placeholder="${esc(options.placeholder||'请输入内容')}">`;openModal(title,subtitle,`<label class="filter-field"><span>${esc(options.label||'内容')}</span>${field}</label>`,`<button class="btn" data-text-cancel>取消</button><button class="btn primary" data-text-submit>确定</button>`);const modal=$('#modal'),input=$(`#${inputId}`);let finished=false;const finish=value=>{if(finished)return;finished=true;input?.removeEventListener('keydown',onKey);closeModal();resolve(value);};const onKey=event=>{if(event.key==='Escape'){event.preventDefault();finish(null);}else if(event.key==='Enter'&&!multiline&&(event.ctrlKey||event.metaKey||event.key==='Enter')){event.preventDefault();finish(input?.value??'');}};modal.querySelector('[data-text-cancel]')?.addEventListener('click',()=>finish(null));modal.querySelector('[data-text-submit]')?.addEventListener('click',()=>finish(input?.value??''));input?.addEventListener('keydown',onKey);requestAnimationFrame(()=>{input?.focus();if(typeof input?.setSelectionRange==='function')input.setSelectionRange(input.value.length,input.value.length);});});}
  function globalSearchResults(query){const q=String(query||'').trim().toLocaleLowerCase(),digits=q.replace(/\D/g,'');if(q.length<2&&digits.length<2)return [];const best=[];for(const customer of state.customers){if(customer.deleted)continue;const values=[customer.name,customer.phone,customer.rawPhone,customer.group,customer.vipNumber,customer.channel,customer.assistant,customer.note].map(value=>String(value||'').toLocaleLowerCase());let rank=0;if(values[0]===q)rank+=100;if(values[1]===digits||values[2].replace(/\D/g,'')===digits)rank+=95;if(values[0].startsWith(q))rank+=60;if(values[1].startsWith(digits)&&digits)rank+=55;if(values.some(value=>value.includes(q)))rank+=25;if(digits&&values[2].replace(/\D/g,'').includes(digits))rank+=25;if(!rank)continue;let index=best.findIndex(item=>rank>item.score||(rank===item.score&&String(customer.name).localeCompare(String(item.customer.name),'zh-CN')<0));if(index<0)index=best.length;best.splice(index,0,{customer,score:rank});if(best.length>20)best.pop();}return best.map(item=>item.customer);}
  function globalSearchResultsHtml(query){const q=String(query||'').trim(),results=globalSearchResults(q);if(q.length<2)return '<div class="global-search-empty">输入至少 2 个字符开始搜索</div>';if(!results.length)return '<div class="global-search-empty">没有找到匹配客户</div>';return `<div class="global-search-meta">显示最相关的 ${results.length} 条结果</div><div class="global-search-results">${results.map(customer=>`<button class="global-search-result" data-action="open-search-customer" data-id="${esc(customer.id)}">${customerAvatarHtml(customer)}<div><strong>${esc(customerName(customer))}</strong><span>${esc(customer.rawPhone)} · ${esc(customer.source)} · ${esc(customer.channel||'未识别')}</span></div><em>${customer.vipNumber?`VIP ${esc(customer.vipNumber)}`:esc(customer.group||'—')}</em></button>`).join('')}</div>`;}
  function globalSearchModal(query=''){openModal('全局客户搜索','姓名、号码、群编号、渠道、助理和备注联合匹配',`<label class="global-search-modal-input">${icons('search')}<input id="globalSearchInput" value="${esc(query)}" placeholder="输入姓名、号码、群编号等" autocomplete="off"></label><div id="globalSearchResults">${globalSearchResultsHtml(query)}</div>`,`<button class="btn" data-action="close-modal">关闭</button><button class="btn primary" data-action="open-search-list">在客户中心查看全部</button>`);const input=$('#globalSearchInput');input?.focus();if(input){input.setSelectionRange(input.value.length,input.value.length);}}
  function customerColumnsModal(mode){const visible=visibleCustomerColumns(mode);const choices=customerColumnDefs.filter(([, ,locked])=>!locked);openModal('客户表格列设置',`${mode==='customer'?'客户中心':'分类视图'}单独保存显示方案；客户、选择和操作列固定显示。`,`<div class="column-settings">${choices.map(([key,label])=>`<label class="column-choice"><input type="checkbox" data-column-option value="${key}" ${visible.has(key)?'checked':''}><span>${label}</span></label>`).join('')}</div><div class="column-settings-note">取消勾选可隐藏字段；筛选和导出仍使用完整客户资料。</div>`,`<button class="btn" data-action="columns-reset">恢复默认列</button><button class="btn primary" data-action="columns-apply" data-mode="${mode}">应用设置</button>`);}
  function shortcutHelpModal(){const rows=[['Ctrl + K','全局搜索客户'],['Ctrl + N','新增一位客户'],['Ctrl + Shift + I','打开快速录入'],['Ctrl + Shift + B','立即创建完整备份'],['Esc','关闭弹窗或客户详情']];openModal('快捷键与使用帮助','客户与业务资料可离线使用；WS 前台和主动 AI 请求需要联网',`<div class="shortcut-list">${rows.map(([keys,label])=>`<div><kbd>${keys}</kbd><span>${label}</span></div>`).join('')}</div><div class="notice-line"><strong>最短首次使用</strong><br>1. 已有资料先创建完整备份；新工作区先录入一位客户，再立即备份。<br>2. 在 WS 工作台打开官方页面，由本人扫码或登录。<br>3. 在 GPT 运营助手中自行配置服务和 API Key；只有主动提交时才会请求外部服务。</div><div class="notice-line">自动会话发现、后台采集和自动 AI 处理当前保持关闭。失败时先按页面提示重试；仍未恢复则退出全部知客窗口后重新打开。不要手工删除 workspace.sqlite 或 .workbench.lock。</div>`,`<button class="btn" data-action="close-modal">知道了</button>`);}
  function closeModal(){$('#modalBackdrop').classList.add('hidden');const target=modalReturnFocus;modalReturnFocus=null;if(target?.isConnected)target.focus();}
  function customerTimeline(customer){
    const phones=new Set(customerPhoneKeys(customer));const related=(record)=>record.customerId!=null?String(record.customerId)===String(customer.id):phones.has(linkedPhone(record.phone));
    const statusEvents=(Array.isArray(customer.statusHistory)?customer.statusHistory:[]).filter(event=>event&&['joined','left'].includes(event.type)&&event.date&&event.to).map(event=>({date:event.date,at:event.at||event.date,label:`${event.initial?'初始状态基线':'进退群状态变更'} · ${event.source||customer.source||'未分类'}`,detail:`${event.from||'新增资料'} → ${event.to}`,time:event.at&&Number.isFinite(Date.parse(event.at))?new Date(event.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):''}));
    const events=[...state.followups.filter(related).map(x=>({date:x.date,at:x.date,label:`跟进 · ${x.method||'未注明方式'}`,detail:x.result||x.note||'',next:x.nextDate})),...state.tickets.filter(related).map(x=>({date:x.date,at:x.date,label:'跟票记录',detail:`${x.product||'产品未注明'} · ${x.direction||'未注明方向'}${x.shares?` · ${x.shares} 股`:''}`})),...state.deposits.filter(related).map(x=>({date:x.date,at:x.date,label:'入金记录',detail:`${money(x.amount)} ${x.currency||''}`})),...state.registrations.filter(related).map(x=>({date:x.date,at:x.createdAt||x.date,label:'报名记录',detail:`${x.status||'已报名'} · ${x.source||'来源未注明'}${x.note?` · ${x.note}`:''}`})),...statusEvents].sort((a,b)=>String(b.at||b.date||'').localeCompare(String(a.at||a.date||''))).slice(0,12);
    return events.map(x=>`<div class="timeline-row"><strong>${esc(x.label)}</strong><br>${esc(x.detail||'—')}<br><span class="panel-note">${esc(x.date||'未记录日期')}${x.time?` · ${esc(x.time)}`:''}${x.next?` · 下次跟进日期 ${esc(x.next)}`:''}</span></div>`).join('')||`<div class="timeline-row">${esc(customer.note||'暂无跟进或业务记录')}<br><span class="panel-note">客户登记于 ${esc(customer.registered)}</span></div>`;
  }
  function renderCustomerHotProfileSummary(customer){
    if(!customer?.hot)return '';
    const investorValue=customer.investor===true?'是':customer.investor===false?'否':'';
    const values=[['客户年龄',customer.age],['性别',customer.gender],['职业及工作情况',customer.occupation||customer.workContext],['是否为股民',investorValue],['股龄 / 投资经验',customer.investmentYears],['当前持仓情况',customer.holdings],['投资习惯及偏好',customer.investmentHabits||customer.investmentPreferences],['家庭状况',customer.familyContext],['生活兴趣',customer.lifeInterests],['未来规划',customer.futurePlans]];
    const known=values.filter(([,value])=>value!==undefined&&value!==null&&String(value).trim()!=='').length;
    const missing=values.filter(([,value])=>value===undefined||value===null||String(value).trim()==='').slice(0,4).map(([label])=>label).join('、')||'核心资料已基本完整';
    return `<section class="customer-360-section zk-surface customer-hot-profile-summary"><div class="customer-360-section-title"><strong>热聊客户资料</strong><span>已补齐 ${known}/${values.length} 项 · 自然聊天逐步了解</span></div><div class="detail-grid">${values.map(([label,value])=>`<div class="detail-field"><span>${esc(label)}</span><strong>${esc(Array.isArray(value)?value.join('、'):value||'待了解')}</strong></div>`).join('')}</div><div class="customer-360-note"><span>待了解</span><p>${esc(missing)}</p><button class="link-button" data-action="go-ws">打开 WS 工作台继续分析 →</button></div></section>`;
  }
  function closeCustomerDrawer(){const drawer=document.querySelector('#customerDrawer');if(!drawer)return;drawer.classList.remove('open');delete drawer.dataset.customerId;}
  function showCustomer(customer){
    const customerId=String(customer?.id??'');
    if(!customer||!customerId.trim()){closeCustomerDrawer();return;}
    const crm=crmProfile(customer),favorite=Boolean(customer.favorite),id=esc(customerId);
    let drawer=document.querySelector('#customerDrawer');
    if(!drawer){
      drawer=document.createElement('aside');
      drawer.id='customerDrawer';
      drawer.className='details-drawer customer-drawer';
      document.body.appendChild(drawer);
    }
    delete drawer.dataset.customerId;
    drawer.dataset.customerId=customerId;
    const fields=[
      ['手机号码',customer.rawPhone||customer.phone||'—'],['标准号码',customer.phone||'—'],
      ['身份标识',customer.identity||customer.identityId||'—'],['客户类型',customer.source||'—'],
      ['来源渠道',customer.channel||customer.source||'—'],['页面分类',customer.page||'—'],
      ['跟进助理',customer.assistant||'未分配'],['进群状态',customer.status||'—'],
      ['客户阶段',customer.phase||'—'],['群编号',customer.group||'—'],['VIP 编号',customer.vipNumber||'—'],
      ['客户登记日期',customer.registered||'—'],['是否股民',customer.investor===true?'是':customer.investor===false?'否':'未记录'],
    ];
    const edit=`<button class="link-button" data-action="edit-customer" data-id="${id}">编辑资料</button>`;
    const qualification=`<div class="detail-field detail-field-editable">
      <span>资质评级</span><div class="qualification-editor"><select id="drawerQualification" aria-label="资质评级">${qualifications.map(value=>`<option ${value===(customer.qualification||'待评估')?'selected':''}>${esc(value)}</option>`).join('')}</select><button class="table-action" data-action="save-customer-qualification" data-id="${id}">保存</button></div>
    </div>`;
    const note=customer.note?`<div class="customer-360-note"><span>客户备注</span><p>${esc(customer.note)}</p></div>`:'';
    drawer.innerHTML=`<div class="drawer-head customer-360-head">
        <h2>客户 360° 档案</h2>
        <div class="drawer-head-actions">
          <button class="favorite-button drawer-favorite ${favorite?'active':''}" data-action="toggle-favorite" data-id="${id}" title="${favorite?'取消重点关注':'加入重点关注'}" aria-label="${favorite?'取消重点关注':'加入重点关注'}" aria-pressed="${favorite}">★</button>
          <button class="modal-close" data-action="close-customer-drawer" aria-label="关闭客户档案">${icons('x')}</button>
        </div>
      </div>
      ${customerIdentityHtml(customer,true)}
      ${customerDetailCard('基础资料','user',`<div class="detail-grid">${customerDetailFields(fields,'drawer')}${qualification}</div>${note}`,edit,true)}
      ${customerDetailCard('投资资料','chart',`<div class="detail-grid">${customerDetailFields((typeof customerInvestmentRows==='function'?customerInvestmentRows(customer):[]),'drawer')}</div>`,'',true)}
      ${customerDetailCard('热聊资料','message',`<div class="detail-grid">${customerDetailFields(customerHotFields(customer),'drawer')}</div>`,'',true)}
      ${customerDetailCard('业务概览','wallet',`<div class="detail-grid">${customerDetailFields(customerBusinessFields(customer),'drawer')}</div>`,'',true)}
      ${customerDetailCard('群组关系','users-group',groupMembershipRows(customer),'',true)}
      ${customerDetailCard('渠道与在群','users-group',`<div class="detail-grid">${customerDetailFields((typeof customerAttributionRows==='function'?customerAttributionRows(customer):[]),'drawer')}</div>`,'',true)}
      ${customerDetailCard('资料完整度','layers',customerCompletenessHtml(customer),'',true)}
      ${customerDetailCard('字段锁定','shield',customerFieldLockHtml(customer),'',true)}
      ${customerDetailCard('CRM 指挥信息','chart',`<div class="crm-command"><div><span>CRM 评分</span><strong>${crm.score}</strong><small>${crm.grade} 级客户</small><div class="crm-score-track"><i style="width:${crm.score}%"></i></div></div><div><span>生命周期</span><strong>${esc(crm.stage)}</strong><small>累计跟进 ${crm.followCount} 次</small></div><div class="crm-next"><span>下一步建议</span><strong>${esc(crm.nextAction)}</strong><small>按客户状态与业务记录计算</small></div></div>`,`<span>${esc(crm.grade)} 级 · ${esc(crm.sla)}</span>`,true)}
      ${customerDetailCard('跟进时间线','history',`<div class="detail-grid">${customerDetailFields(customerFollowFields(customer,crm),'drawer')}</div><div class="timeline customer-360-timeline">${customerTimeline(customer)}</div>`,'<span>最近 12 条</span>',true)}
      ${customerDetailCard('阅读统计','check',customerReadingSummary(),'',true)}
      ${customerDetailCard('AI 摘要','spark',customerAiSummary(customer),'',true)}
      <div class="drawer-actions customer-360-actions">
        <button class="btn" data-action="follow" data-id="${id}">登记跟进</button>
        <button class="btn" data-action="new-customer-ticket" data-id="${id}">新增跟票</button>
        <button class="btn" data-action="new-customer-deposit" data-id="${id}">新增入金</button>
        <button class="btn primary" data-action="edit-customer" data-id="${id}">编辑资料</button>
      </div>`;
    drawer.classList.add('open');
    void loadCustomerGovernancePanel(customerId);
    document.dispatchEvent(new CustomEvent('zhike:customer-drawer-opened',{detail:{customerId}}));
  }
  function editCustomerModal(customer){const field=(id,label,items,value)=>{const choices=[...new Set([...(items||[]),...(value&&!items.includes(value)?[value]:[])])];return `<label class="filter-field"><span>${label}</span><select id="${id}">${choices.map(x=>`<option ${x===value?'selected':''}>${esc(x)}</option>`).join('')}</select></label>`;};const pagesForEdit=[...new Set([...pages,...(customer.page?[customer.page]:[])])];openModal('编辑客户资料','人工修改字段会在后续导入时受到保护',`<div class="filter-grid" style="grid-template-columns:repeat(2,1fr)"><label class="filter-field"><span>客户姓名</span><input id="editName" value="${esc(customer.name)}"></label><label class="filter-field"><span>原始号码</span><input id="editPhone" value="${esc(customer.rawPhone)}"></label>${field('editSource','渠道',sources,customer.source)}${field('editPage','页面（可不选）',pagesForEdit,customer.page)}${field('editAssistant','跟进助理',assistants,customer.assistant)}${field('editStatus','进群状态',statuses,customer.status)}${field('editPhase','客户阶段',phases,customer.phase)}${field('editQualification','资质评级',qualifications,customer.qualification||'待评估')}<label class="filter-field"><span>群编号</span><input id="editGroup" value="${esc(customer.group==='—'?'':customer.group)}"></label><label class="filter-field"><span>VIP 编号（可选）</span><input id="editVipNumber" maxlength="64" value="${esc(customer.vipNumber||'')}"></label><label class="filter-field" style="grid-column:1/-1"><span>备注</span><input id="editNote" value="${esc(customer.note)}"></label></div>`,`<button class="btn" data-action="close-modal">取消</button><button class="btn primary" data-action="save-customer" data-id="${customer.id}">保存修改</button>`);}
  function followModal(customer){const suggestedDays=smartFollowDays(customer);openModal('登记跟进',`${esc(customer.name)} · ${esc(customer.rawPhone)}`,`<div class="filter-grid" style="grid-template-columns:repeat(2,1fr)"><label class="filter-field"><span>跟进时间</span><input id="followDate" type="datetime-local" value="${new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16)}"></label><label class="filter-field"><span>跟进方式</span><select id="followMethod"><option>电话</option><option>WhatsApp</option><option>Telegram</option><option>群内沟通</option><option>其他</option></select></label><label class="filter-field"><span>报名状态</span><select id="followRegistration"><option value="">请选择</option><option value="未报名">未报名</option><option value="已报名">已报名</option></select></label><label class="filter-field" style="grid-column:1/-1"><span>跟进结果与备注</span><textarea id="followNote" class="intake-textarea" style="height:90px" placeholder="记录本次沟通结果"></textarea></label><label class="filter-field" style="grid-column:1/-1"><span>下次跟进日期 · 智能建议 ${suggestedDays} 天后</span><input id="nextFollow" type="date" value="${localDateOffset(suggestedDays)}"></label></div>`,`<button class="btn" data-action="close-modal">取消</button><button class="btn primary" data-action="save-follow" data-id="${customer.id}">保存跟进</button>`);}
  function businessModal(type,customerId=''){const ticket=type==='ticket';openModal(ticket?'新增跟票':'新增入金',ticket?'买入和卖出会按方向分别保存日期，可登记同一客户同一股票的不同交易记录':'记录将保存到本机，并关联客户档案',`<div class="filter-grid" style="grid-template-columns:repeat(2,1fr)">${customerPickerHtml('businessCustomer',activeCustomers(),customerId,'客户') }<label class="filter-field"><span>${ticket?'交易日期（按买入/卖出分别保存）':'入金日期'}</span><input id="businessDate" type="date" value="${today}"></label>${ticket?`<label class="filter-field"><span>产品/代码</span><input id="businessProduct" placeholder="代码或产品名称"></label><label class="filter-field"><span>方向</span><select id="businessDirection"><option>买入</option><option>卖出</option><option>关注</option></select></label>`:`<label class="filter-field"><span>入金金额</span><input id="businessAmount" type="number" min="0" placeholder="金额"></label><label class="filter-field"><span>币种</span><select id="businessCurrency"><option>INR</option><option>USD</option><option>CNY</option></select></label>`}<label class="filter-field" style="grid-column:1/-1"><span>备注</span><input id="businessNote" placeholder="可选"></label></div>`,`<button class="btn" data-action="close-modal">取消</button><button class="btn primary" data-action="save-business" data-type="${type}">保存记录</button>`);}
  function ticketImportColumnMap(headers,sampleRows=[]){const normalized=headers.map(value=>String(value??'').trim().toLocaleLowerCase()),find=(aliases,exclude)=>{const wanted=aliases.map(value=>String(value).toLocaleLowerCase());let index=normalized.findIndex((header)=>wanted.includes(header)&&!(exclude&&exclude.test(header)));if(index>=0)return index;return normalized.findIndex(header=>wanted.some(alias=>alias.length>1&&header.includes(alias))&&!(exclude&&exclude.test(header)));},date=(pattern,exclude)=>normalized.findIndex(header=>pattern.test(header)&&!(exclude&&exclude.test(header)));const mapping=window.ZhikeSmartImport?.inferHeaderMapping?.(headers,sampleRows,{fields:[['phone','', ['客户号码','手机号码','手机号','电话','号码','phone','mobile']],['name','',['客户姓名','客户名称','姓名','联系人','name']],['product','',['产品','产品代码','股票','股票代码','证券代码','代码','product','symbol','stock']],['direction','',['方向','买卖方向','买卖','操作','direction','side','action']],['followDate','',['跟票日期','业务日期','交易日期','成交日期','跟票时间','业务时间','交易时间','followdate','businessdate','transactiondate']],['buyDate','',['买入日期','购买日期','买入时间','buydate','purchase_date']],['sellDate','',['卖出日期','出售日期','卖出时间','selldate','sale_date']],['businessNote','',['业务备注','交易备注','跟票备注','备注','说明','note']],['status','',['状态','status']]]})||{};const excluded=/登记|注册|入群|添加|报名|跟进|下次/;if(mapping.followDate==null)mapping.followDate=date(/^(?:跟票|业务|交易|成交)(?:日期|时间)$/i,excluded);if(mapping.followDate==null)mapping.followDate=date(/^(?:date|businessdate|transactiondate|followdate)$/i,excluded);if(mapping.phone==null)mapping.phone=find(['客户号码','手机号码','手机号','电话','号码','phone','mobile'],/日期|时间/);if(mapping.name==null)mapping.name=find(['客户姓名','客户名称','姓名','联系人','name']);if(mapping.product==null)mapping.product=find(['产品','产品代码','股票','股票代码','证券代码','代码','product','symbol','stock']);if(mapping.direction==null)mapping.direction=find(['方向','买卖方向','买卖','操作','direction','side','action']);if(mapping.buyDate==null)mapping.buyDate=date(/^(?:买入|购买)(?:日期|时间)$|^(?:buydate|buy_date|purchase_date)$/i);if(mapping.sellDate==null)mapping.sellDate=date(/^(?:卖出|出售)(?:日期|时间)$|^(?:selldate|sell_date|sale_date)$/i);if(mapping.businessNote==null)mapping.businessNote=find(['业务备注','交易备注','跟票备注','备注','说明','note']);if(mapping.status==null)mapping.status=find(['状态','status']);return mapping;}
  async function importTicketFile(file){if(!file)return;const today='';let rollback=null;try{if(file.size>24*1024*1024)throw new Error('跟票文件超过 24 MB 上限');let tables=[];if(/\.xlsx?$|\.xlsm$/i.test(file.name)){if(!window.zhikeAI?.parseExcel)throw new Error('当前环境无法解析 Excel，请改用 CSV');const parsed=await window.zhikeAI.parseExcel({bytes:await file.arrayBuffer()});tables=(parsed.tables||[]).map(table=>({name:table.name,rows:table.rows||[]}));}else{const text=(await decodeCsvFile(file)).replace(/^\ufeff/,''),rows=parseCsv(text,detectCsvDelimiter(text));tables=[{name:file.name,rows}];}for(const table of tables){const detected=window.ZhikeSmartImport?.detectHeaderRow?.(table.rows||[]);if(detected?.index>0)table.rows=table.rows.slice(detected.index);}const customers=activeCustomers(),byPhone=new Map(customers.map(c=>[phoneForQuality(c),c]).filter(([phone])=>phone.length===10)),byNameGroups=new Map(customers.reduce((map,c)=>{const name=String(c.name||'').trim().toLocaleLowerCase();if(name){const list=map.get(name)||[];list.push(c);map.set(name,list);}return map;},new Map)),known=new Set(state.tickets.map(r=>businessRecordSignature(r,'ticket'))),valid=[],issues=[];for(const table of tables){if(table.rows.length<2)continue;const headers=table.rows[0].map(value=>String(value||'').trim()),mapping=ticketImportColumnMap(headers,table.rows.slice(1,21)),phoneIndex=mapping.phone??-1,nameIndex=mapping.name??-1,dateIndex=mapping.followDate??-1,buyDateIndex=mapping.buyDate??-1,sellDateIndex=mapping.sellDate??-1,productIndex=mapping.product??-1,directionIndex=mapping.direction??-1,noteIndex=mapping.businessNote??-1,statusIndex=mapping.status??-1;if(phoneIndex<0&&nameIndex<0){issues.push(`${table.name}：未找到客户号码或姓名列`);continue;}for(let rowNumber=1;rowNumber<table.rows.length;rowNumber++){const row=table.rows[rowNumber],phone=phoneIndex>=0?linkedPhone(row[phoneIndex]):'',name=nameIndex>=0?String(row[nameIndex]||'').trim().toLocaleLowerCase():'',nameMatches=byNameGroups.get(name)||[],customer=byPhone.get(phone)||(nameMatches.length===1?nameMatches[0]:null);if(!customer){issues.push(`${table.name} 第 ${rowNumber+1} 行：${nameMatches.length>1?'姓名匹配到多个客户，请补充号码':'未匹配客户'}`);continue;}const direction=ticketDirectionKey(directionIndex>=0?row[directionIndex]:'关注'),genericDate=normalizeImportedDate(dateIndex>=0?row[dateIndex]:''),buyDate=normalizeImportedDate(buyDateIndex>=0?row[buyDateIndex]:'')||(direction==='买入'?genericDate:''),sellDate=normalizeImportedDate(sellDateIndex>=0?row[sellDateIndex]:'')||(direction==='卖出'?genericDate:''),date=direction==='买入'?(buyDate||genericDate):direction==='卖出'?(sellDate||genericDate):(genericDate||buyDate||sellDate)||today,product=String(productIndex>=0?row[productIndex]:'').trim()||'未指定',signature=businessRecordSignature({customerId:customer.id,date,buyDate,sellDate,product,direction,note:String(noteIndex>=0?row[noteIndex]:'').trim()},'ticket');if(known.has(signature)){issues.push(`${table.name} 第 ${rowNumber+1} 行：跟票记录已存在`);continue;}const record=normalizeTicketRecord({id:`TI${Date.now()}-${valid.length}-${Math.random().toString(36).slice(2,6)}`,customerId:customer.id,customer:customer.name,phone:customer.rawPhone||customer.phone,date,buyDate,sellDate,product,direction,assistant:customer.assistant,channel:customer.channel||customer.source,group:customer.group,status:String(statusIndex>=0?row[statusIndex]:'').trim()||'已确认',note:String(noteIndex>=0?row[noteIndex]:'').trim().slice(0,2000)});known.add(businessRecordSignature(record,'ticket'));valid.push(record);}}if(!valid.length)throw new Error(issues[0]||'文件中没有可导入的跟票记录');if(!confirm(`跟票导入预览\n\n可导入：${valid.length} 条\n跳过/待检查：${issues.length} 条\n\n已按号码/姓名匹配客户，并区分买入、卖出与业务日期。继续？`))return;if(!await snapshotBeforeWrite('跟票文件导入前自动快照'))return;const customerJournal=new Map(),beforeTickets=state.tickets.slice(),beforeActivities=state.activities.slice(),beforeBatchOperations=state.batchOperations.slice();rollback={tickets:beforeTickets,activities:beforeActivities,batchOperations:beforeBatchOperations,customers:customerJournal};state.tickets=valid.concat(state.tickets);for(const record of valid){const customer=state.customers.find(c=>sameId(c.id,record.customerId));if(customer){if(!customerJournal.has(String(customer.id)))customerJournal.set(String(customer.id),{customer,ticket:customer.ticket,hot:customer.hot,phase:customer.phase});customer.ticket=true;advanceCrm(customer,'ticket');}}activity(`导入跟票 ${valid.length} 条，跳过 ${issues.length} 条`);try{await flushStateWrites();}catch(error){state.tickets=beforeTickets;state.activities=beforeActivities;state.batchOperations=beforeBatchOperations;for(const item of customerJournal.values()){item.customer.ticket=item.ticket;item.customer.hot=item.hot;item.customer.phase=item.phase;}rollback=null;persist();throw error;}render();toast(`已导入 ${valid.length} 条跟票记录${issues.length?`，跳过 ${issues.length} 条`:''}`);}catch(error){if(rollback){state.tickets=rollback.tickets;state.activities=rollback.activities;state.batchOperations=rollback.batchOperations;for(const item of rollback.customers.values()){item.customer.ticket=item.ticket;item.customer.hot=item.hot;item.customer.phase=item.phase;}rollback=null;persist();}toast(error.message||'跟票导入失败','x');}}
  function syncCustomerBusinessFlags(customerId){const customer=state.customers.find(c=>sameId(c.id,customerId));if(!customer)return;customer.ticket=state.tickets.some(r=>sameId(r.customerId,customer.id));const deposits=state.deposits.filter(r=>sameId(r.customerId,customer.id));customer.deposit=deposits.length>0;customer.amount=deposits.reduce((sum,r)=>sum+recordAmount(r),0);}
  async function deleteBusinessRecord(kind,id){const list=kind==='ticket'?state.tickets:state.deposits,index=list.findIndex(record=>sameId(record.id,id));if(index<0)return;const record=list[index],label=kind==='ticket'?'跟票':'入金',customer=state.customers.find(c=>sameId(c.id,record.customerId)),beforeCustomer=customer?cloneStateData(customer):null,beforeActivities=state.activities.slice();if(!confirm(`删除这条${label}记录？\n删除前会自动创建快照。`))return;if(!await snapshotBeforeWrite(`删除${label}记录前自动快照`))return;list.splice(index,1);syncCustomerBusinessFlags(record.customerId);persist();activity(`删除${label}记录：${record.customer||record.phone||record.id}`);try{await flushStateWrites();}catch{list.splice(index,0,record);if(customer&&beforeCustomer)Object.assign(customer,beforeCustomer);state.activities=beforeActivities;persist();toast('删除失败，记录已恢复','x');return;}render();toast(`${label}记录已删除`);}
  function editBusinessRecord(kind,id){const list=kind==='ticket'?state.tickets:state.deposits,record=list.find(item=>sameId(item.id,id));if(!record)return;const ticket=kind==='ticket',normalized=ticket?normalizeTicketRecord(record):record;openModal(ticket?'编辑跟票':'编辑入金','修改后会自动创建快照并校验完全重复记录',`<div class="filter-grid" style="grid-template-columns:repeat(2,1fr)"><label class="filter-field"><span>${ticket?'交易日期（按方向保存）':'日期'}</span><input id="editBusinessDate" type="date" value="${esc(String(effectiveTicketDate(normalized)||normalized.date||'').slice(0,10))}"></label>${ticket?`<label class="filter-field"><span>产品/代码</span><input id="editBusinessProduct" value="${esc(normalized.product||'未指定')}"></label><label class="filter-field"><span>方向</span><select id="editBusinessDirection"><option ${normalized.direction==='买入'?'selected':''}>买入</option><option ${normalized.direction==='卖出'?'selected':''}>卖出</option><option ${normalized.direction==='关注'?'selected':''}>关注</option></select></label>`:`<label class="filter-field"><span>金额</span><input id="editBusinessAmount" type="number" min="0" value="${esc(record.amount||0)}"></label><label class="filter-field"><span>币种</span><select id="editBusinessCurrency"><option ${record.currency==='INR'?'selected':''}>INR</option><option ${record.currency==='USD'?'selected':''}>USD</option><option ${record.currency==='CNY'?'selected':''}>CNY</option></select></label>`}<label class="filter-field" style="grid-column:1/-1"><span>备注</span><input id="editBusinessNote" value="${esc(record.note||'')}"></label></div>`,`<button class="btn" data-action="close-modal">取消</button><button class="btn primary" data-action="save-business-edit" data-kind="${kind}" data-id="${esc(record.id)}">保存修改</button>`);}
  async function saveBusinessEdit(kind,id){const list=kind==='ticket'?state.tickets:state.deposits,record=list.find(item=>sameId(item.id,id));if(!record)return;const inputDate=$('#editBusinessDate').value,next=kind==='ticket'?(()=>{const direction=$('#editBusinessDirection').value,previousDirection=normalizeTicketRecord(record).direction,base={...record,date:inputDate,note:$('#editBusinessNote').value.trim(),product:$('#editBusinessProduct').value.trim()||'未指定',direction};if(direction!==previousDirection||direction==='关注'){base.buyDate='';base.sellDate='';}if(direction==='买入')base.buyDate=inputDate;else if(direction==='卖出')base.sellDate=inputDate;else base.date=inputDate;return normalizeTicketRecord(base);})():{...record,date:inputDate,note:$('#editBusinessNote').value.trim()};if(!/^\d{4}-\d{2}-\d{2}$/.test(inputDate||'')){toast('请选择有效日期','x');return;}if(kind==='deposit'){next.amount=Number($('#editBusinessAmount').value);next.currency=$('#editBusinessCurrency').value;if(!Number.isFinite(next.amount)||next.amount<=0){toast('请输入有效入金金额','x');return;}}if(list.some(item=>!sameId(item.id,id)&&businessRecordSignature(item,kind)===businessRecordSignature(next,kind))){toast(`完全相同的${kind==='ticket'?'跟票':'入金'}记录已存在，未保存修改`,'x');return;}if(!await snapshotBeforeWrite(`编辑${kind==='ticket'?'跟票':'入金'}记录前自动快照`))return;const before=cloneStateData(record),customer=kind==='deposit'?state.customers.find(c=>sameId(c.id,record.customerId)):null,beforeCustomer=customer?cloneStateData(customer):null,beforeActivities=state.activities.slice();Object.assign(record,next);if(customer){customer.amount=(Number(customer.amount)||0)-Number(before.amount||0)+Number(record.amount||0);}persist();activity(`修改${kind==='ticket'?'跟票':'入金'}记录：${record.customer||record.phone||record.id}`);try{await flushStateWrites();}catch{Object.assign(record,before);if(customer&&beforeCustomer)Object.assign(customer,beforeCustomer);state.activities=beforeActivities;persist();toast('保存失败，业务记录已恢复','x');render();return;}closeModal();render();toast('业务记录已保存');}
  async function deleteRegistrationRecord(id){const index=state.registrations.findIndex(record=>sameId(record.id,id));if(index<0)return;const record=state.registrations[index],customer=state.customers.find(c=>sameId(c.id,record.customerId)),beforeCustomer=customer?cloneStateData(customer):null,beforeActivities=state.activities.slice();if(!confirm(`删除 ${customer?.name||'该客户'} 的这条报名记录？\n删除前会自动创建快照。`))return;if(!await snapshotBeforeWrite('删除报名记录前自动快照'))return;state.registrations.splice(index,1);if(customer&&!state.registrations.some(item=>sameId(item.customerId,customer.id)&&item.status==='已报名'))customer.registration='';persist();activity(`删除报名记录：${customer?.name||record.customerId}`);try{await flushStateWrites();}catch{state.registrations.splice(index,0,record);if(customer&&beforeCustomer)Object.assign(customer,beforeCustomer);state.activities=beforeActivities;persist();toast('删除失败，报名记录已恢复','x');return;}render();toast('报名记录已删除');}
  function batchModal(type){if(!state.selected.size){toast('请先选择客户');return;}const label={assistant:'分配助理',status:'修改进群状态',follow:'批量排期',hot:'标记热聊',qualification:'批量修改评级',registration:'批量报名状态',phase:'批量客户阶段',tag:'批量添加标签'}[type];let field='';if(type==='assistant')field=`<label class="filter-field"><span>选择助理</span><select id="batchValue">${assistants.map(x=>`<option>${x}</option>`).join('')}</select></label>`;if(type==='status')field=`<label class="filter-field"><span>选择状态</span><select id="batchValue">${statuses.map(x=>`<option>${x}</option>`).join('')}</select></label>`;if(type==='follow')field=`<label class="filter-field"><span>跟进日期</span><input id="batchValue" type="date" value="${localDateOffset(1)}"></label>`;if(type==='hot')field=`<label class="filter-field"><span>热聊状态</span><select id="batchValue"><option value="true">标记为热聊</option><option value="false">取消热聊</option></select></label>`;if(type==='qualification')field=`<label class="filter-field"><span>目标评级</span><select id="batchValue">${qualifications.map(x=>`<option>${x}</option>`).join('')}</select></label>`;if(type==='registration')field=`<label class="filter-field"><span>报名状态</span><select id="batchValue"><option value="已报名">已报名</option><option value="未报名">清空报名状态</option></select></label>`;if(type==='phase')field=`<label class="filter-field"><span>客户阶段</span><select id="batchValue">${phases.map(x=>`<option>${x}</option>`).join('')}</select></label>`;if(type==='tag')field=`<label class="filter-field"><span>添加标签</span><input id="batchValue" maxlength="30" placeholder="输入标签"></label>`;openModal(label,'先预览影响范围，再执行修改',`${field}<div class="notice-line">已选择 ${state.selected.size} 位客户。下一步不会立即写入数据。</div>`,`<button class="btn" data-action="close-modal">取消</button><button class="btn primary" data-action="preview-batch" data-type="${type}">预览变更</button>`);}
  function batchFieldValue(customer,type){if(type==='assistant')return customer.assistant||'未分配';if(type==='status')return customer.status||'未记录';if(type==='follow')return customer.due||'未安排';if(type==='qualification')return customer.qualification||'未评级';if(type==='registration')return customer.registration||'未报名';if(type==='phase')return customer.phase||'未设置';if(type==='tag')return (customer.tags||[]).join('、')||'无标签';return customer.hot?'热聊':'非热聊';}
  function batchNextValue(type,value){return type==='hot'?(value==='true'?'热聊':'非热聊'):value;}
  function previewBatch(type){const value=$('#batchValue')?.value;if(!value){toast('请选择要修改的值','x');return;}const selected=state.customers.filter(customer=>!customer.deleted&&state.selected.has(customer.id)),next=batchNextValue(type,value),changed=selected.filter(customer=>batchFieldValue(customer,type)!==next),unchanged=selected.length-changed.length,label={assistant:'分配助理',status:'修改进群状态',follow:'批量排期',hot:'调整热聊'}[type];state.pendingBatch={type,value,ids:selected.map(customer=>customer.id)};const distribution=new Map();for(const customer of selected){const current=batchFieldValue(customer,type);distribution.set(current,(distribution.get(current)||0)+1);}const before=[...distribution.entries()].sort((a,b)=>b[1]-a[1]);const names=changed.slice(0,8).map(customer=>`<span class="batch-preview-name">${esc(customer.name)} · ${esc(batchFieldValue(customer,type))} → ${esc(next)}</span>`).join('');openModal(`确认${label}`,'仅修改真正发生变化的记录',`<div class="batch-preview-summary"><div><span>已选择</span><strong>${selected.length}</strong></div><div><span>将变更</span><strong>${changed.length}</strong></div><div><span>保持不变</span><strong>${unchanged}</strong></div></div><div class="batch-preview-target"><span>目标值</span><strong>${esc(next)}</strong></div><div class="batch-preview-distribution"><strong>当前分布</strong>${before.map(([current,count])=>`<span>${esc(current)} <b>${count}</b></span>`).join('')}</div><div class="batch-preview-list"><strong>变更预览${changed.length>8?`（前 8 位，共 ${changed.length} 位）`:''}</strong>${names||'<span class="muted-cell">没有记录需要修改</span>'}</div>${type==='status'&&changed.length?'<div class="notice-line">状态历史只记录实际进群/退群变化；相同状态不会重复计数。</div>':''}`,`<button class="btn" data-action="batch-${type}">返回调整</button><button class="btn primary" data-action="apply-batch" data-type="${type}" ${changed.length?'':'disabled'}>确认并执行</button>`);}
  function download(name,content,type='text/plain;charset=utf-8'){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function csvCell(value){const text=String(value??'');const safe=/^[\t\r\n ]*[=+\-@]/.test(text)?`'${text}`:text;return `"${safe.replace(/"/g,'""')}"`;}
  function exportCustomers(list,name='customers.csv'){const cols=['name','rawPhone','phone','source','page','assistant','status','phase','qualification','hot','vipNumber','investor','group','ticket','deposit','amount','registered','lastFollow','due','note'];const labels=['客户姓名','原始号码','标准号码','渠道','页面分类','跟进助理','进群状态','客户阶段','资质评级','热聊','VIP编号','是否股民','群编号','跟票','入金','入金金额','登记时间','最后跟进','下次跟进日期','备注'];const business=businessSummaryIndex();const csv=[labels.join(','),...list.map(customer=>{const summary=customerBusinessSummary(customer,business);const values={...customer,qualification:customer.qualification||'待评估',ticket:summary.ticket?'是':'否',deposit:summary.deposit?'是':'否',amount:summary.amount};return cols.map(key=>csvCell(values[key])).join(',');})].join('\r\n');download(name,'\ufeff'+csv,'text/csv;charset=utf-8');toast(`已导出 ${list.length} 条客户记录`,'download');}
  function exportCsvRows(name,headers,rows,label='条记录'){const csv=[headers.map(csvCell).join(','),...rows.map(row=>row.map(csvCell).join(','))].join('\r\n');download(name,'\ufeff'+csv,'text/csv;charset=utf-8');toast(`已导出 ${rows.length} ${label}`,'download');}
  function currentModuleSearch(){return ($('#viewContainer [data-search="module"]')?.value||'').trim().toLocaleLowerCase();}
  function matchesExportSearch(values,query){return !query||values.some(value=>String(value??'').toLocaleLowerCase().includes(query));}
  function exportSimpleCustomerList(list,name){const query=currentModuleSearch();const rows=list.filter(c=>matchesExportSearch([c.name,c.rawPhone,c.source,c.channel,c.assistant,c.phase,c.due,c.note],query));exportCsvRows(name,['客户','号码','数据归属','来源渠道','跟进助理','客户阶段','计划日期','跟进内容'],rows.map(c=>[c.name,c.rawPhone,c.source,c.channel,c.assistant,c.phase,c.due,c.note]),'位客户');}
  function exportFollowups(){const tab=state.followTab||'open';if(tab==='done'){const events=[...state.followups].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));const rows=events.map(event=>{const customer=state.customers.find(c=>String(c.id)===String(event.customerId));return [customer?.name||event.customer||'客户记录',customer?.rawPhone||event.phone||'',event.date||'',event.method||'',event.result||event.note||'',event.nextDate||''];});exportCsvRows('已完成跟进.csv',['客户','号码','跟进时间','方式','结果与备注','下次跟进日期'],rows);return;}const seven=localDateOffset(7);const list=activeCustomers().filter(c=>tab==='none'?(!c.due||c.due==='—'):isValidDateKey(c.due)&&(tab==='overdue'?c.due<today:tab==='today'?c.due===today:tab==='week'?c.due>today&&c.due<=seven:c.due<=today)).sort((a,b)=>(a.due||'').localeCompare(b.due||''));exportSimpleCustomerList(list,`跟进${{open:'待处理',overdue:'已逾期',today:'今日',week:'未来7天',none:'未安排'}[tab]||'清单'}.csv`);}
  function exportHotCustomers(){const all=activeCustomers().filter(c=>c.hot),business=businessSummaryIndex();const filter=state.hotFilter||'all';const list=filter==='stale'?staleHotCustomers():filter==='today'?all.filter(c=>c.registered===today):filter==='not-joined'?all.filter(c=>!['已进群','在群'].includes(c.status)):filter==='not-deposit'?all.filter(c=>!customerBusinessSummary(c,business).deposit):all;exportSimpleCustomerList(list,'热聊客户.csv');}
  function exportVipCustomers(){const filter=state.vipFilter||'all',all=activeCustomers().filter(c=>String(c.vipNumber||'').trim()),list=filter==='today'?all.filter(c=>c.registered===today):filter==='unfollowed'?all.filter(c=>!c.lastFollow||c.lastFollow<today):all,query=currentModuleSearch(),rows=list.filter(c=>matchesExportSearch([c.name,c.vipNumber,c.rawPhone,c.phone,c.source,c.channel,c.assistant,c.phase,c.registered,c.due,c.note],query));exportCsvRows('VIP客户.csv',['客户','VIP编号','号码','渠道','来源渠道','跟进助理','客户阶段','登记日期','下次跟进','备注'],rows.map(c=>[c.name,c.vipNumber,c.rawPhone||c.phone,c.source,c.channel,c.assistant,c.phase,c.registered,c.due,c.note]),'位客户');}
  function exportBusinessRecords(kind){const ticket=kind==='tickets';const activeIds=new Set(activeCustomers().map(c=>String(c.id))),activePhones=new Set(activeCustomers().map(c=>phoneForQuality(c)).filter(Boolean)),records=(ticket?state.tickets:state.deposits).filter(r=>activeIds.has(String(r.customerId))||activePhones.has(phoneForQuality(r)));const weekStart=localDateOffset(-6),recordDate=r=>ticket?effectiveTicketDate(r):String(r.date||'').slice(0,10);let rows=records.filter(r=>state.businessPeriod==='today'?recordDate(r)===today:state.businessPeriod==='week'?recordDate(r)>=weekStart&&recordDate(r)<=today:state.businessPeriod==='month'?recordDate(r).slice(0,7)===today.slice(0,7):state.businessPeriod==='pending'?r.status==='待确认':true);if(state.businessAssistant!=='全部')rows=rows.filter(r=>r.assistant===state.businessAssistant);if(state.businessChannel!=='全部')rows=rows.filter(r=>r.channel===state.businessChannel);if(ticket&&String(state.businessProductFilter||'').trim())rows=rows.filter(r=>String(r.product||'未指定').trim().toLocaleLowerCase()===String(state.businessProductFilter).trim().toLocaleLowerCase());if(ticket&&String(state.businessDirectionFilter||'全部')!=='全部')rows=rows.filter(r=>ticketDirectionKey(r.direction)===String(state.businessDirectionFilter));rows=rows.map(r=>{r=ticket?normalizeTicketRecord(r):r;const customer=state.customers.find(c=>String(c.id)===String(r.customerId))||state.customers.find(c=>c.phone&&String(r.phone||'').replace(/\D/g,'').replace(/^91(?=\d{10}$)/,'')===c.phone);return {...r,customer:r.customer||customer?.name||'未关联客户',phone:r.phone||customer?.rawPhone||'',assistant:r.assistant||customer?.assistant||'',channel:r.channel||customer?.channel||'',group:r.group||customer?.group||'—'};});const query=currentModuleSearch();rows=rows.filter(r=>matchesExportSearch([r.customer,r.phone,r.date,r.buyDate,r.sellDate,r.product,r.direction,r.amount,r.assistant,r.channel,r.group,r.status,r.note],query));const headers=ticket?['客户','号码','买入日期','卖出日期','产品/代码','方向','助理','来源渠道','群编号','状态','备注']:['客户','号码','入金日期','入金金额','币种','助理','来源渠道','群编号','状态','备注'];exportCsvRows(ticket?'跟票明细.csv':'入金明细.csv',headers,rows.map(r=>ticket?[r.customer,r.phone,r.buyDate||'',r.sellDate||'',r.product||'—',r.direction||'—',r.assistant,r.channel,r.group,r.status||'已确认',r.note||'']:[r.customer,r.phone,r.date||today,recordAmount(r),r.currency||'',r.assistant,r.channel,r.group,r.status||'已确认',r.note||'']));}
  function exportGroupSummary(){const groups=groupSummaryRows(state.groupQuery||'',state.groupSource||'全部').rows;exportCsvRows('单导与群粉群组汇总.csv',['客户类型','群编号','客户数','在群','已退群','热聊人数','跟票人数','入金人数','入金金额','主要助理'],groups.map(r=>[r.source,r.group,r.members,r.joined,r.left,r.hot,r.ticket,r.deposit,r.amount,r.assistant]),'个群组');}
  function exportAnalyticsReport(){const n=counts(),list=activeCustomers(),daily=todayStatusCounts(list),current=currentSourceStatusCounts(list);const rows=[['客户总数',n.total,''],['单导客户',n.single,''],['群粉客户',n.group,''],['当前总进群客户',n.joined,`${Math.round(n.joined/Math.max(1,n.total)*100)}%`],['当前总退群客户',n.left,`${Math.round(n.left/Math.max(1,n.total)*100)}%`],['单导 · 当前总进群',current.singleJoined,''],['单导 · 当前总退群',current.singleLeft,''],['群粉 · 当前总进群',current.groupJoined,''],['群粉 · 当前总退群',current.groupLeft,''],['单导 · 今日进群',daily.singleJoined,''],['单导 · 今日退群',daily.singleLeft,''],['群粉 · 今日进群',daily.groupJoined,''],['群粉 · 今日退群',daily.groupLeft,''],['热聊客户',n.hot,`${Math.round(n.hot/Math.max(1,n.total)*100)}%`],['VIP 客户',n.vip,`${Math.round(n.vip/Math.max(1,n.total)*100)}%`],['跟票客户',n.ticket,''],['入金客户',n.deposit,`${Math.round(n.deposit/Math.max(1,n.total)*100)}%`],['已逾期客户',n.overdue,''],...sources.map(source=>[`渠道：${source}`,list.filter(customer=>customer.source===source).length,''])];exportCsvRows('客户统计分析.csv',['统计项目','数量','占比'],rows,'项统计');}
  function exportStatusHistory(){const customers=state.customers,rows=[];for(const customer of customers)for(const event of Array.isArray(customer.statusHistory)?customer.statusHistory:[]){if(!event||!['joined','left'].includes(event.type))continue;rows.push([customer.id,customer.name,customer.phone||customer.rawPhone,event.initial?'初始状态基线':'状态变更',event.source||customer.source,event.date,event.at||'',event.type==='joined'?'进群':'退群',event.from||'新增资料',event.to,customer.source,customer.deleted?'回收站':'在册']);}rows.sort((a,b)=>String(b[5]).localeCompare(String(a[5]))||String(b[6]).localeCompare(String(a[6])));exportCsvRows(`进退群明细_${today}.csv`,['客户编号','客户姓名','手机号码','记录性质','记录时归属','日期','时间','状态类型','变更前状态','变更后状态','当前归属','客户记录'],rows,'条状态记录');}
  function exportRegistrations(){
    const customers=new Map(activeCustomers().map(customer=>[String(customer.id),customer]));
    const records=state.registrations.filter(record=>record.status==='已报名'&&customers.has(String(record.customerId)));
    const rows=records.map(record=>{
      const customer=customers.get(String(record.customerId));
      return [record.date,customer.name,customer.rawPhone||customer.phone,record.source,record.owner||customer.assistant,record.status,record.note].map(csvCell).join(',');
    });
    const csv=['报名时间,客户,号码,来源,负责人,状态,备注',...rows].join('\r\n');
    download(`报名记录_${today}.csv`,'\ufeff'+csv,'text/csv;charset=utf-8');
  }
  function exportCurrentView(){if(state.view==='customers')exportCustomers(filteredCustomers('customer'),'客户中心筛选结果.csv');else if(state.view==='segments')exportCustomers(filteredCustomers(),'分类视图筛选结果.csv');else if(state.view==='followups')exportFollowups();else if(state.view==='hot')exportHotCustomers();else if(state.view==='vip')exportVipCustomers();else if(state.view==='tickets'||state.view==='deposits')exportBusinessRecords(state.view);else if(state.view==='groups')exportGroupSummary();else if(state.view==='analytics')exportAnalyticsReport();else toast('当前页面没有可导出的列表');}
  const csvFields=[['name','客户姓名',['客户姓名','客户名称','姓名','name','customername']],['vipNumber','VIP编号',['VIP编号','VIP号','会员编号','vipnumber','vipid','vipcode']],['phone','手机号码',['标准号码','原始号码','客户号码','手机号码','手机号','电话','号码','phone','phoneraw','phonenormalized','phonenumber','mobile','mobilephone','cellphone','number']],['source','渠道',['渠道','数据归属','客户归属','来源类型','归属','source']],['page','页面分类',['页面分类','单导页面','来源页面','来源表','source_sheet','页面','page']],['assistant','跟进助理',['跟进助理','负责人','助理','assistant','owner']],['status','进群状态',['进群状态','群状态','group_status','状态','status']],['phase','客户阶段',['客户阶段','customer_stage','阶段','phase']],['qualification','资质评级',['资质评级','资质等级','客户资质','qualification','qualification_level']],['country','国家/地区',['国家','国家/地区','地区','country','region']],['language','客户语言',['语言','客户语言','language','locale']],['occupation','职业/工作',['职业','工作','职业及工作','occupation','job','work']],['age','年龄',['年龄','age']],['budget','预算',['预算','投资预算','budget']],['productInterest','产品兴趣',['产品兴趣','股票兴趣','投资偏好','兴趣偏好','productinterest','interest','preference']],['hot','热聊',['热聊','热聊状态','是否热聊','重点聊','hot']],['investor','是否股民',['是否股民','股民','投资者','investor','is investor']],['ticketFlag','跟票状态',['跟票','跟票状态','是否跟票','ticket','has ticket']],['depositFlag','入金状态',['入金','入金状态','是否入金','deposit','has deposit']],['group','群编号',['群编号','群号','群组','group_code','group']],['registered','登记日期',['登记日期','注册日期','创建时间','registered_at','日期','registered','date']],['lastFollow','最后跟进',['最后跟进','最后跟进日期','最近跟进','lastfollow','last_follow']],['nextFollow','下次跟进',['下次跟进','下次跟进日期','计划跟进','计划跟进日期','计划日期','下次联系','next_followup','nextfollow','followupdate','duedate','due']],['note','备注',['备注','notes','跟进备注','说明','note']]];
  csvFields.push(['recordType','记录类型',['记录类型','业务类型','数据类型','类型','type']],['product','股票代码/产品',['产品','产品代码','股票','股票代码','证券代码','证券','代码','product','symbol','stock','stockcode']],['direction','买卖方向',['方向','买卖','操作','交易方向','direction','side','action']],['amount','金额',['金额','入金金额','充值金额','支付金额','amount','deposit','payment']],['currency','币种',['币种','货币','currency']],['followDate','业务日期',['跟票日期','入金日期','业务日期','交易日期','交易时间','followdate','businessdate','transactiondate']],['buyDate','买入日期',['买入日期','购买日期','买入时间','buydate','buy_date','purchase_date']],['sellDate','卖出日期',['卖出日期','出售日期','卖出时间','selldate','sell_date','sale_date']],['nextFollow','下次跟进',['下次跟进','下次跟进日期','计划跟进','计划跟进日期','跟进日期','计划日期','下次联系','next_followup','nextfollow','followupdate','duedate','due']],['businessNote','业务备注',['业务备注','交易备注','跟票备注','入金备注','businessnote']]);
  function parseCsv(text,delimiter){const rows=[];let row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}else if(ch==='"')quoted=false;else field+=ch;continue;}if(ch==='"'&&field===''){quoted=true;continue;}if(ch===delimiter){row.push(field);field='';continue;}if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field='';continue;}field+=ch;}if(field||row.length){row.push(field);if(row.some(x=>x.trim()))rows.push(row);}return rows;}
  function normalizeImportedDate(value){const raw=String(value??'').trim();if(!raw)return '';const normalized=raw.normalize('NFKC').replace(/[年./月]/g,'-').replace(/日/g,'').replace(/[Ts]+\d{1,2}:\d{2}(?::\d{2})?.*$/,'').replace(/\s+/g,'');const direct=normalized.replace(/-+/g,'-');if(isValidDateKey(direct))return direct;const ymd=direct.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);if(ymd){const candidate=`${ymd[1]}-${String(ymd[2]).padStart(2,'0')}-${String(ymd[3]).padStart(2,'0')}`;return isValidDateKey(candidate)?candidate:'';}const dmy=direct.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);if(dmy){const first=Number(dmy[1]),second=Number(dmy[2]),day=first>12?first:(second>12?second:first),month=first>12?second:(second>12?first:second),candidate=`${dmy[3]}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;return isValidDateKey(candidate)?candidate:'';}if(/^\d{8}$/.test(direct)){const compact=`${direct.slice(0,4)}-${direct.slice(4,6)}-${direct.slice(6,8)}`;return isValidDateKey(compact)?compact:'';}const serialText=raw.normalize('NFKC');if(/^\d{1,7}(?:\.\d+)?$/.test(serialText)){const serialValue=Number(serialText),serial=Math.trunc(serialValue);if(Number.isFinite(serialValue)&&serialValue>=1&&serialValue<=2958465){const date=new Date(Date.UTC(1899,11,30)+serial*86400000),excel=`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;if(isValidDateKey(excel))return excel;}return '';}const numericDateTime=raw.normalize('NFKC').match(/^(\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})(?:T|\s+)\d{1,2}:\d{2}/i);if(numericDateTime)return normalizeImportedDate(numericDateTime[1]);const parsed=Date.parse(raw);if(Number.isFinite(parsed)){const date=new Date(parsed);const fallback=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;if(isValidDateKey(fallback))return fallback;}return '';}
  function detectCsvDelimiter(text){let quoted=false,counts={',':0,';':0,'\t':0,'|':0};for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){i++;continue;}quoted=!quoted;continue;}if(!quoted&&(ch==='\n'||ch==='\r'))break;if(!quoted&&Object.hasOwn(counts,ch))counts[ch]++;}return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];}
  function normalizedHeader(text){return String(text||'').replace(/^\ufeff/,'').toLowerCase().replace(/[\s_\-\/（）()]/g,'');}
  async function decodeCsvFile(file){const bytes=new Uint8Array(await file.arrayBuffer());if(bytes[0]===0xff&&bytes[1]===0xfe)return new TextDecoder('utf-16le').decode(bytes.subarray(2));if(bytes[0]===0xfe&&bytes[1]===0xff)return new TextDecoder('utf-16be').decode(bytes.subarray(2));if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)return new TextDecoder('utf-8').decode(bytes.subarray(3));try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return new TextDecoder('gb18030').decode(bytes);}}
  function csvHeaderMapping(headers,sampleRows=[]){const businessFields=[['recordType','记录类型',['记录类型','业务类型','类型','type']],['product','产品',['产品','产品代码','股票','股票代码','代码','product','symbol','stock','stockcode']],['direction','方向',['方向','买卖','操作','direction','side','action']],['amount','金额',['金额','入金金额','充值金额','amount','deposit','payment']],['currency','币种',['币种','货币','currency']],['tradeRef','交易流水号',['交易流水号','成交编号','订单号','交易编号','trade_ref','traderef','orderid']],['externalRef','外部流水号',['外部流水号','批次号','外部编号','external_ref','externalref','batchno']],['nextFollow','下次跟进',['下次跟进','下次跟进日期','计划跟进','计划跟进日期','跟进日期','计划日期','下次联系','next_followup','nextfollow','followupdate','duedate','due']],['businessNote','业务备注',['业务备注','交易备注','入金备注','businessnote']],['followDate','跟票日期',['跟票日期','入金日期','业务日期','交易日期','followdate','businessdate','transactiondate']],['buyDate','买入日期',['买入日期','购买日期','买入时间','buydate','buy_date','purchase_date']],['sellDate','卖出日期',['卖出日期','出售日期','卖出时间','selldate','sell_date','sale_date']]],fields=[...csvFields,...businessFields];let mapping=window.ZhikeSmartImport?.inferHeaderMapping?.(headers,sampleRows,{fields})||{};if(!Object.keys(mapping).length){mapping={};for(const [key,,aliases] of fields){const accepted=new Set(aliases.map(normalizedHeader));const index=headers.findIndex((header,i)=>!Object.values(mapping).includes(i)&&accepted.has(normalizedHeader(header)));if(index>=0)mapping[key]=index;}}const canonical={};for(const [rawKey,index] of Object.entries(mapping)){const field=window.ZhikeSmartImport?.canonicalImportField?.(rawKey)||({due:'nextFollow'}[rawKey]||rawKey);if(canonical[field]==null)canonical[field]=index;}return window.ZhikeSmartImport?.applyMappingProfile?.(headers,canonical,state.settings?.importProfiles)?.mapping||canonical;}
  function csvBatchStats(batch){const index=batch.mapping.phone,dateIndex=batch.mapping.registered,seen=new Set();let valid=0,invalid=0,duplicates=0;for(const row of batch.rows.slice(1)){const phone=index==null?'':linkedPhone(row[index]),rawDate=dateIndex==null?'':String(row[dateIndex]||'').trim();if(phone.length!==10||(rawDate&&!normalizeImportedDate(rawDate)))invalid++;else if(seen.has(phone))duplicates++;else{seen.add(phone);valid++;}}const enriched={...batch,aliases:importSourceCatalog()};const route=window.ZhikeSmartImport?.summarizeImportBatch?.(enriched)||{mode:'customer',customerRows:valid,ticketRows:0,depositRows:0,ambiguousRows:0,sourceCounts:{},statusCounts:{}};const decisions=batch.rows.slice(1,6).map((row,index)=>({row:index+2+(batch.headerOffset||0),...(window.ZhikeSmartImport?.explainImportDecision?.(row,batch.mapping,batch.headers||batch.rows[0]||[],{batchMode:route.mode,aliases:importSourceCatalog(),filename:batch.filename})||{})}));return {valid,invalid,duplicates,total:batch.rows.length-1,decisions,...route};}
  function importModeLabel(mode){return ({customer:'客户资料（业务派生列仅作参考）',ticket:'跟票业务',deposit:'入金业务',registration:'报名业务',followup:'跟进业务',mixed:'混合业务（按行分流）'})[mode]||'客户资料';}
  function importDefaultSourceControl(pending){
    const selected=String(pending?.defaultSource||'').trim();
    const catalog=[...new Set([...sources,...groupFanSources].map(value=>String(value||'').trim()).filter(value=>value&&!nonBusinessSource.test(value)))];
    if(selected&&!catalog.includes(selected))catalog.push(selected);
    return `<div class="import-source-fallback"><label class="filter-field"><span>未识别渠道处理</span><select data-csv-default-source><option value="">待复核（不自动归类）</option>${catalog.map(value=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(value)}</option>`).join('')}</select></label><small>只有没有任何可靠候选的行才使用这里的显式默认值；低置信度或多候选行仍会进入待复核，不会自动默认为单导。</small></div>`;
  }
  function csvSampleHtml(){const pending=state.pendingCsv;if(!pending)return '';const batches=pending.batches||[pending],sample=pending.rows.slice(1,5),selected=key=>pending.mapping[key],meta=window.ZhikeSmartImport?.mappingConfidence?.(pending.headers,pending.mapping),profile=window.ZhikeSmartImport?.applyMappingProfile?.(pending.headers,pending.mapping,state.settings?.importProfiles)?.profile,hints=window.ZhikeSmartImport?.mappingSuggestions?.(pending.headers,pending.mapping)||[];return `<div class="import-batch-grid">${batches.map((batch,index)=>{const stats=csvBatchStats(batch),mode=stats.mode||window.ZhikeSmartImport?.importBatchMode?.(batch)||'customer',routeSummary=[stats.customerRows?`客户 ${stats.customerRows}`:'',stats.ticketRows?`跟票 ${stats.ticketRows}`:'',stats.depositRows?`入金 ${stats.depositRows}`:'',stats.registrationRows?`报名 ${stats.registrationRows}`:'',stats.followupRows?`跟进 ${stats.followupRows}`:'',stats.ambiguousRows?`待判定 ${stats.ambiguousRows}`:''].filter(Boolean).join(' · ')||'无可分流业务记录',sourceSummary=Object.entries(stats.sourceCounts||{}).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([source,count])=>`${source} ${count}`).join(' · '),statusSummary=Object.entries(stats.statusCounts||{}).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([status,count])=>`${status} ${count}`).join(' · '),decisionSummary=(stats.decisions||[]).map(item=>`第${item.row}行→${item.target||'customer'}${item.source?`/${item.source}`:''}${item.status?`/${item.status}`:''}：${(item.reasons||[]).join('；')}`).join(' | ');return `<article class="import-file-card"><div><strong>${esc(batch.filename)}</strong><span>${stats.total.toLocaleString()} 行 · 有效 ${stats.valid} · 异常 ${stats.invalid} · 文件内重复 ${stats.duplicates}</span><small>导入模式：${esc(importModeLabel(mode))} · 预计写入：${esc(routeSummary)}</small>${sourceSummary?`<small>逐行渠道：${esc(sourceSummary)}</small>`:''}${statusSummary?`<small>逐行状态：${esc(statusSummary)}</small>`:''}${decisionSummary?`<small>识别依据样例：${esc(decisionSummary)}</small>`:''}</div>${batches.length>1?`<button class="table-action danger-text" data-action="remove-import-file" data-index="${index}">移除</button>`:''}</article>`;}).join('')}</div>${importDefaultSourceControl(pending)}<div class="import-mapping-title"><strong>字段映射与样例预览</strong><span>${profile?'已应用上次映射 · ':''}自动识别置信度 ${meta?.score||0}% · ${batches.length>1?'各文件已分别自动识别表头；下方可调整第一个文件':'确认识别字段后导入'}</span></div>${hints.length?`<div class="notice-line">导入前建议：${esc(hints.join('；'))}</div>`:''}<div class="filter-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">${csvFields.map(([key,label])=>`<label class="filter-field"><span>${label}</span><select data-csv-field="${key}"><option value="">不导入</option>${pending.headers.map((header,index)=>`<option value="${index}" ${selected(key)===index?'selected':''}>${esc(header||`第 ${index+1} 列`)}</option>`).join('')}</select></label>`).join('')}</div><div class="preview-table-wrap" style="max-height:260px;margin-top:12px"><table class="preview-table"><thead><tr>${csvFields.filter(([key])=>selected(key)!=null).map(([,label])=>`<th>${label}</th>`).join('')}</tr></thead><tbody>${sample.map(row=>`<tr>${csvFields.filter(([key])=>selected(key)!=null).map(([key])=>`<td>${esc(row[selected(key)]||'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="notice-line">渠道和状态按行自动识别：优先明确字段，其次扫描该行内容，最后才使用文件名；已存在号码会关联并只补空字段，真正冲突、号码异常、低置信度或缺少号码的行会进入“数据治理”供复核。</div>`;}
  async function saveCurrentImportMapping(){const pending=state.pendingCsv;if(!pending||!window.ZhikeSmartImport?.saveMappingProfile)return;const fallback=String(pending.filename||'我的导入映射').replace(/\.[^.]+$/,'').slice(0,48)||'我的导入映射',name=await requestText('保存表头映射','这套映射会保存在本机，后续相同表头可自动套用。',fallback,{label:'映射名称',maxLength:80});if(name===null)return;const value=name.trim().slice(0,80);if(!value){toast('映射名称不能为空','x');return;}state.settings.importProfiles=window.ZhikeSmartImport.saveMappingProfile(state.settings.importProfiles,value,pending.headers,pending.mapping);persist();$('#modal .modal-body').innerHTML=csvSampleHtml();toast(`已保存导入映射：${value}`);}
  async function aiCustomerImportMapping(headers,sampleRows,localMapping){
    if(window.ZhikeSmartImport?.detectImportDomain?.(headers)==='phone-registry')return {...localMapping,recordTypeHint:'phone-registry',aiSkippedReason:'phone-registry-local-only'};
    const bridge=window.zhikeAI;if(!bridge?.request)return localMapping;
    const required=['name','phone','source','page','assistant','status','phase','qualification','country','language','occupation','age','budget','productInterest','hot','investor','ticketFlag','depositFlag','group','registered','lastFollow','nextFollow','recordType','product','direction','amount','currency','followDate','buyDate','sellDate','tradeRef','externalRef','note','businessNote'];
    const missing=required.filter(key=>localMapping[key]==null);
    // A complete local mapping is normally enough.  Still ask AI to review
    // when a business column is ambiguous: this is where spreadsheet exports
    // most often confuse a customer summary (e.g. “入金金额”) with a real
    // deposit record.  AI remains advisory; importBatchMode/target guards are
    // authoritative and the import continues if the service is unavailable.
    const headersText=(headers||[]).map(value=>String(value??'').trim());
    const hasAmbiguousBusiness=headersText.some(value=>/(金额|入金|跟票|股票|买卖|交易|业务|记录类型|币种|流水)/i.test(value));
    if(!missing.length&&!hasAmbiguousBusiness)return localMapping;
    try{
      const sample=(sampleRows||[]).slice(0,8).map(row=>row.map(value=>String(value??'')).join('\t')).join('\n');
      const prompt=[
        '你是知客的“导入字段识别器”，只做表头/样例到字段的结构化映射，不分析客户隐私，不生成客户内容。',
        '只返回一个严格 JSON 对象，格式为 {"mapping":{"字段":列序号或null},"recordTypeHint":"customer|ticket|deposit|registration|followup|mixed"}，不要 Markdown、解释或额外字段。列序号从 0 开始，无法确认必须填 null。',
        `允许字段：${required.join(',')}。候选本地映射：${JSON.stringify(localMapping)}。`,
        '客户中心优先规则：如果同时存在姓名/名称与电话/号码，并有渠道、来源、状态、登记日期、跟票、入金、热聊、VIP、是否股民、最后跟进、下次跟进或入金金额等客户摘要列，且没有明确的股票代码/证券代码、买卖方向、买入或卖出日期、业务日期、交易流水、币种、记录类型等业务列，recordTypeHint 必须为 customer。',
        '客户中心的“跟票/入金/热聊/VIP/是否股民/最后跟进/下次跟进/入金金额”是客户属性或汇总值，不能映射为 product、direction、recordType、buyDate、sellDate、followDate，也不能凭这些列创建跟票或入金记录。',
        '只有明确的股票代码/买卖方向/买入卖出日期/业务日期/记录类型才可判为 ticket；只有明确的入金日期、币种、支付或入金业务记录才可判为 deposit。单独的“入金金额”在客户中心导出中仍属于摘要列。',
        '如果同一文件同时包含客户资料和真实业务行，才返回 mixed；不要因为列名包含“跟票”或“入金”就返回 mixed。',
      ].join('\n');
      const result=await bridge.request({assistantMode:'operations',input:prompt,context:'表头：'+JSON.stringify(headersText)+'\n样例：'+sample});
      const match=String(result?.text||'').match(/\{[\s\S]*\}/);if(!match)return localMapping;
      const rawParsed=JSON.parse(match[0]);
      const parsed=rawParsed?.mapping&&typeof rawParsed.mapping==='object'&&!Array.isArray(rawParsed.mapping)
        ? {...rawParsed.mapping,recordTypeHint:rawParsed.recordTypeHint??rawParsed.mapping.recordTypeHint}
        : rawParsed;
      const next={...localMapping};
      // Providers may return aliases (for example `due`); normalize every key
      // before merging so the preview and writer use one canonical vocabulary.
      const canonical=key=>window.ZhikeSmartImport?.canonicalImportField?.(key)||({due:'nextFollow'}[key]||key);
      const customerExport=window.ZhikeSmartImport?.looksLikeCustomerExport?.(headersText)===true;
      const businessFields=new Set(['recordType','product','direction','amount','currency','followDate','buyDate','sellDate','tradeRef','externalRef','businessNote']);
      for(const [rawKey,index] of Object.entries(parsed||{})){
        const field=canonical(rawKey);
        if(field==='recordTypeHint')continue;
        const columnIndex=Number.isInteger(index)?index:(typeof index==='string'&&/^\d+$/.test(index.trim())?Number(index):null);
        if(!required.includes(field)||!Number.isInteger(columnIndex)||columnIndex<0||columnIndex>=headers.length||next[field]!=null)continue;
        // Never let an AI suggestion override the customer-export boundary.
        // The mapped column is still visible in the preview, but it cannot
        // change the batch target or create a derived business row.
        if(customerExport&&businessFields.has(field))continue;
        next[field]=columnIndex;
      }
      const allowedHints=new Set(['customer','ticket','deposit','registration','followup','mixed']);
      const hint=String(parsed?.recordTypeHint||'').trim().toLowerCase();
      if(allowedHints.has(hint))next.recordTypeHint=customerExport?'customer':hint;
      else if(customerExport)next.recordTypeHint='customer';
      return next;
    }catch{return localMapping;}
  }
  async function importCsvFiles(fileList){
    const files=[...(fileList||[])];
    if(!files.length)return;
    try{
      const batches=[];let totalRows=0;
      for(const file of files){
        if(file.size>24*1024*1024)throw new Error(`${file.name}：文件超过 24 MB 上限`);
        const tables=[];
        if(/\.xlsx?$|\.xlsm$/i.test(file.name)){
          if(!window.zhikeAI?.parseExcel)throw new Error('当前环境无法解析 Excel，请改用 CSV');
          const parsed=await window.zhikeAI.parseExcel({bytes:await file.arrayBuffer()});
          for(const table of parsed.tables||[])tables.push({name:`${file.name} · ${table.name||'工作表'}`,rows:table.rows||[]});
        }else{
          const text=(await decodeCsvFile(file)).replace(/^\ufeff/,'');
          tables.push({name:file.name,rows:parseCsv(text,detectCsvDelimiter(text))});
        }
        if(!tables.length)throw new Error(`${file.name}：文件没有可识别的工作表`);
        for(const table of tables){
          const detected=window.ZhikeSmartImport?.detectHeaderRow?.(table.rows||[]),headerOffset=detected?.index>0?detected.index:0,rows=headerOffset?(table.rows||[]).slice(headerOffset):(table.rows||[]);
          if(rows.length<2)throw new Error(`${table.name}：文件为空或只有表头`);
          if(rows.length>50001)throw new Error(`${table.name}：单个工作表最多 50,000 行`);
          totalRows+=rows.length-1;
          if(totalRows>100000)throw new Error('一次批量导入最多 100,000 行，请分批选择');
          const headers=rows[0].map(x=>String(x??'').trim());
          const localMapping=csvHeaderMapping(headers,rows.slice(1,21));
          if(window.ZhikeSmartImport?.detectImportDomain?.(headers)==='phone-registry')throw new Error(`${table.name}：识别为“手机号登记”文件。该资料必须在“手机号登记 → 导入 Excel”中使用本地规则导入，不调用 AI，也不会写入客户中心。`);
          const mapping=await aiCustomerImportMapping(headers,rows.slice(1,21),localMapping);
          batches.push({rows,headers,mapping,filename:table.name,headerOffset});
        }
      }
      if(!batches.length)throw new Error('没有找到可导入的数据');
      state.pendingCsv={...batches[0],batches,defaultSource:''};
      const names=files.length===1?esc(files[0].name):`${files.length} 个文件`;
      openModal('智能批量导入',`${names} · 共 ${totalRows} 行待预览`,csvSampleHtml()+`${batches.length>1?`<div class="notice-line">已识别 ${batches.length} 个工作表/文件，可分别检查字段映射。</div>`:''}`,`<button class="btn" data-action="close-modal">取消</button><button class="btn" data-action="save-import-mapping">保存映射</button><button class="btn primary" data-action="commit-csv">确认批量导入</button>`);
    }catch(error){state.pendingCsv=null;toast(error.message||'文件读取失败','x');}
  }
  async function commitCsvImport(){
    const today='';
    const pending=state.pendingCsv;
    if(!pending)return;
    const batches=pending.batches||[pending];
    if(batches.some(batch=>batch.mapping.phone==null)){toast('有文件未识别到“手机号码”列','x');return;}
    let added=0,updated=0,matched=0,processedRows=0;
    const yieldToUi=()=>new Promise(resolve=>setTimeout(resolve,0));
    const importFlag=value=>/^(?:是|有|已|true|1|yes|y|热聊|股民|跟票|入金)$/i.test(String(value??'').trim());
    const importAmount=value=>{const number=Number(String(value??'').replace(/[,$￥₹€£\s]/g,''));return Number.isFinite(number)&&number>=0?number:0;};
    const settingsBefore=structuredClone(state.settings);
    const sourcesBefore=[...sources],groupFanSourcesBefore=[...groupFanSources];
    const existingByPhone=new Map(knownIntakePhones());
    const knownVipNumbers=new Map(knownIntakeVipNumbers());
    const issues=[],newCustomers=[],newTickets=[],newDeposits=[],newRegistrations=[],newFollowups=[],decisionSamples=[],customerJournal=new Map(),acceptedRowsByBatch=new Map();
    const importCustomersByPhone=new Map(existingByPhone);
    const existingIds=new Set(state.customers.map(customer=>String(customer.id)));
    const rememberCustomer=customer=>{if(!customer||!existingIds.has(String(customer.id))||customerJournal.has(String(customer.id)))return;customerJournal.set(String(customer.id),structuredClone(customer));};
    const restoreCustomers=()=>{for(const [id,snapshot] of customerJournal){const current=state.customers.find(customer=>String(customer.id)===id);if(!current)continue;for(const key of Object.keys(current))delete current[key];Object.assign(current,snapshot);}};
    const restoreImportStaging=()=>{if(window.ZhikeBusinessRules?.restoreImportStaging?.({state,customerSnapshots:customerJournal,settingsBefore,sources,sourcesBefore,groupFanSources,groupFanSourcesBefore}))return;restoreCustomers();state.settings=structuredClone(settingsBefore);sources.splice(0,sources.length,...sourcesBefore);groupFanSources.splice(0,groupFanSources.length,...groupFanSourcesBefore);};
    const importId=`${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    if(window.ZhikeSmartImport?.rememberMappingProfile)for(const batch of batches)state.settings.importProfiles=window.ZhikeSmartImport.rememberMappingProfile(state.settings.importProfiles,batch.headers,batch.mapping);
    for(const batch of batches){
      const batchMode=window.ZhikeSmartImport?.importBatchMode?.(batch)||'customer';
      for(let i=1;i<batch.rows.length;i++){
        processedRows++;if(processedRows%500===0)await yieldToUi();
        const row=batch.rows[i];
        const raw=Object.fromEntries(csvFields.map(([key])=>[key,batch.mapping[key]==null?'':String(row[batch.mapping[key]]||'').trim()]));
        const rawPhone=raw.phone,phone=linkedPhone(rawPhone),vipNumber=String(raw.vipNumber||'').trim().slice(0,64),vipKeyValue=vipKey(vipNumber);
        const classificationInput={...raw,recordType:batch.mapping.recordType==null?'':String(row[batch.mapping.recordType]||'').trim(),product:batch.mapping.product==null?'':String(row[batch.mapping.product]||'').trim(),direction:batch.mapping.direction==null?'':String(row[batch.mapping.direction]||'').trim(),amount:batch.mapping.amount==null?'':String(row[batch.mapping.amount]||'').trim(),currency:batch.mapping.currency==null?'':String(row[batch.mapping.currency]||'').trim()};
        const registered=normalizeImportedDate(raw.registered),suggestions=window.ZhikeSmartImport?.csvRowSuggestions?.(raw)||[],classification=window.ZhikeSmartImport?.classifyImportRow?.(classificationInput,{target:batchMode})||{type:'customer',confidence:1,reasons:[]},rowRoute=window.ZhikeSmartImport?.inferRowClassification?.(row,batch.mapping,batch.headers||batch.rows?.[0]||[],{aliases:importSourceCatalog(),filename:batch.filename})||{},sourceReview=window.ZhikeSmartImport?.resolveImportSource?.(rowRoute,raw.source,window.ZhikeSmartImport?.sourceSignal?.(batch.filename,importSourceCatalog())||'',raw.page,importSourceCatalog(),pending.defaultSource)||{source:rowRoute.source||'',needsReview:!rowRoute.source,candidates:[]};
        const decision=window.ZhikeSmartImport?.explainImportDecision?.(row,batch.mapping,batch.headers||batch.rows?.[0]||[],{batchMode,aliases:importSourceCatalog(),filename:batch.filename,defaultSource:pending.defaultSource})||{target:classification.type||'customer',source:sourceReview.source||'',status:rowRoute.status||'',confidence:classification.confidence||0,reasons:classification.reasons||[]};
        if(decisionSamples.length<500)decisionSamples.push({file:batch.filename,row:i+1+(batch.headerOffset||0),phone:rawPhone,target:decision.target,source:decision.source,status:decision.status,dates:decision.dates,confidence:decision.confidence,needsReview:decision.needsReview,reasons:decision.reasons});
        const existingCustomer=phone.length===10?importCustomersByPhone.get(phone):null;
        const vipOwner=vipKeyValue?knownVipNumbers.get(vipKeyValue):null;
        const invalidOtherDate=[['最后跟进日期','lastFollow'],['下次跟进日期','nextFollow'],['业务日期','followDate'],['买入日期','buyDate'],['卖出日期','sellDate']].find(([label,key])=>batch.mapping[key]!=null&&String(row[batch.mapping[key]]??'').trim()&&!normalizeImportedDate(row[batch.mapping[key]]));
        let reason='';
        if(phone.length!==10)reason='号码异常或缺失';
        else if(vipKeyValue&&knownVipNumbers.has(vipKeyValue)&&vipOwner&&String(vipOwner.id)!==String(existingCustomer?.id))reason='VIP编号已存在或在文件内重复：其他客户已占用';
        else if(raw.registered&&!registered)reason='登记日期无法识别';
        else if(invalidOtherDate)reason=`${invalidOtherDate[0]}无法识别`;
        else if(classification.type!=='customer'&&classification.confidence<0.8)reason='业务类型识别置信度不足';
        else if((window.ZhikeSmartImport?.shouldReviewSource?.(sourceReview,{existingCustomer:Boolean(existingCustomer),recordType:classification.type})??sourceReview.needsReview))reason=`渠道无法可靠识别${sourceReview.candidates?.length?`（候选：${sourceReview.candidates.slice(0,5).join('、')}）`:''}`;
        else if(suggestions.some(item=>/多个候选/.test(item)))reason=`字段存在歧义：${suggestions.filter(item=>/多个候选/.test(item)).join('、')}`;
        if(reason){issues.push({id:`I${importId}-${issues.length}`,file:batch.filename,row:i+1+(batch.headerOffset||0),reason,raw:JSON.stringify(row),values:{...raw,channelCandidates:sourceReview.candidates||[],channelConfidence:sourceReview.confidence||0,decision},originalValues:{...raw}});continue;}
        if(!acceptedRowsByBatch.has(batch))acceptedRowsByBatch.set(batch,new Set());
        acceptedRowsByBatch.get(batch).add(i);
        const sourceValue=value=>sources.find(source=>source.toLocaleLowerCase()===String(value||'').trim().toLocaleLowerCase());
        const rawSource=String(window.ZhikeSmartImport?.normalizeValue?.(raw.source,'source',importSourceCatalog())||raw.source||'').trim();
        const fileSource=window.ZhikeSmartImport?.sourceSignal?.(batch.filename,importSourceCatalog())||'';
        const inheritedBusinessSource=existingCustomer&&classification.type!=='customer'?normalizeBusinessSource(existingCustomer.source,existingCustomer.page,existingCustomer.channel):'';
        const sourceFallback=sourceReview.source||inheritedBusinessSource||'';
        const source=normalizeBusinessSource(sourceReview.source||sourceValue(rawSource)||rawSource||sourceFallback,raw.page,sourceFallback),sourceExplicit=['资料','行标签'].includes(rowRoute.sourceOrigin)||Boolean(raw.source&&sourceReview.source);
        const qualification=qualifications.includes(raw.qualification)?raw.qualification:'待评估';
        const normalizedStatus=String(window.ZhikeSmartImport?.normalizeValue?.(raw.status,'status',importSourceCatalog())||raw.status||rowRoute.status||'').trim(),normalizedCustomerStatus=statuses.includes(normalizedStatus)?normalizedStatus:'';
        const customerSummaryBatch=batchMode==='customer';
        const incoming={id:`C${importId}-${added}`,name:raw.name||'未命名客户',rawPhone,phone,source,page:raw.page||'',channel:source,assistant:raw.assistant||'未分配',status:normalizedCustomerStatus||(isGroupFanSource(source)?'在群':'未进群'),phase:raw.phase||'新客户',qualification,country:raw.country||'',language:raw.language||'',occupation:raw.occupation||'',age:Number.isFinite(Number(raw.age))?Number(raw.age):null,budget:raw.budget||'',productInterest:raw.productInterest||'',hot:importFlag(raw.hot),investor:importFlag(raw.investor),group:raw.group||'—',vipNumber,ticket:customerSummaryBatch&&importFlag(raw.ticketFlag),deposit:customerSummaryBatch&&importFlag(raw.depositFlag),amount:customerSummaryBatch?importAmount(raw.amount):0,registered:registered||today,lastFollow:normalizeImportedDate(raw.lastFollow),due:normalizeImportedDate(raw.nextFollow)||(state.settings.autoInitialFollow===false?'—':localDateOffset(1)),note:raw.note||'',deleted:false,touched:false};
        // File imports must preserve an absent registration date as blank;
        // today's date is only a default for manual/quick intake, never a
        // substitute for an unrecognized or missing imported value.
        if(!registered)incoming.registered='';
        let customer=existingCustomer;
        if(customer){
          rememberCustomer(customer);
          const merged=window.ZhikeSmartImport?.mergeCustomerFields?.(customer,incoming)||{changedFields:[]};
          const sourceLocked=[...(Array.isArray(customer.manualLockedFields)?customer.manualLockedFields:[]),...(Array.isArray(customer.aiLockedFields)?customer.aiLockedFields:[])].includes('source');
          if(sourceExplicit&&source&&!sourceLocked&&normalizeBusinessSource(customer.source,customer.page,customer.channel)!==source){
            const prior=normalizeBusinessSource(customer.source,customer.page,customer.channel);
            customer.sourceHistory=[...new Set([...(Array.isArray(customer.sourceHistory)?customer.sourceHistory:[]),prior,source].filter(Boolean))];
            customer.source=source;customer.channel=source;
            if(!merged.changedFields.includes('source'))merged.changedFields.push('source');
          }
          if(merged.changedFields.length)updated++;else matched++;
        }else{
          customer=incoming;newCustomers.push(customer);importCustomersByPhone.set(phone,customer);existingByPhone.set(phone,customer);added++;
        }
        if(source&&!sources.includes(source))sources.push(source);
        if(vipKeyValue)knownVipNumbers.set(vipKeyValue,customer);
      }
    }
    const byPhone=new Map();
    for(const customer of [...state.customers,...newCustomers])if(!customer.deleted)for(const key of customerPhoneKeys(customer))if(!byPhone.has(key))byPhone.set(key,customer);
    const ticketKeys=new Set(state.tickets.map(r=>businessRecordSignature(r,'ticket'))),depositKeys=new Set(state.deposits.map(r=>businessRecordSignature(r,'deposit'))),registrationKeys=new Set(state.registrations.map(r=>businessRecordSignature(r,'registration'))),followupKeys=new Set(state.followups.map(r=>businessRecordSignature(r,'followup')));
    for(const batch of batches){
      const batchMode=window.ZhikeSmartImport?.importBatchMode?.(batch)||'customer';
      for(let i=1;i<batch.rows.length;i++){
        processedRows++;if(processedRows%500===0)await yieldToUi();
        if(!acceptedRowsByBatch.get(batch)?.has(i))continue;
        const row=batch.rows[i],phone=linkedPhone(batch.mapping.phone==null?'':row[batch.mapping.phone]),customer=byPhone.get(phone);
        if(!customer||!window.ZhikeSmartImport?.shouldWriteBusinessRow?.(row,batch.mapping,batchMode,batch.headers||batch.rows?.[0]||[]))continue;
        const rawType=String(batch.mapping.recordType==null?'':row[batch.mapping.recordType]||'').trim(),product=String(batch.mapping.product==null?'':row[batch.mapping.product]||'').trim(),directionRaw=String(batch.mapping.direction==null?'':row[batch.mapping.direction]||'').trim(),direction=directionRaw?ticketDirectionKey(directionRaw):'',amountRaw=String(batch.mapping.amount==null?'':row[batch.mapping.amount]||'').trim(),amount=Number(amountRaw.replace(/,/g,'')),tradeRef=String(row[batch.mapping.tradeRef??-1]||'').trim(),externalRef=String(row[batch.mapping.externalRef??-1]||'').trim(),classification=window.ZhikeSmartImport?.classifyImportRow?.({recordType:rawType,product,direction,amount:amountRaw,currency:batch.mapping.currency==null?'':row[batch.mapping.currency]},{target:batchMode})||{},type=(classification.type||window.ZhikeSmartImport?.inferRecordType?.({recordType:rawType,product,direction,amount:amountRaw})||'customer').toLocaleLowerCase(),genericDate=normalizeImportedDate(batch.mapping.followDate==null?(batch.mapping.registered==null?'':row[batch.mapping.registered]):row[batch.mapping.followDate]),buyDate=normalizeImportedDate(batch.mapping.buyDate==null?'':row[batch.mapping.buyDate])||(direction==='买入'?genericDate:''),sellDate=normalizeImportedDate(batch.mapping.sellDate==null?'':row[batch.mapping.sellDate])||(direction==='卖出'?genericDate:''),date=direction==='买入'?(buyDate||genericDate):direction==='卖出'?(sellDate||genericDate):(genericDate||buyDate||sellDate)||today,nextDate=normalizeImportedDate(batch.mapping.nextFollow==null?'':row[batch.mapping.nextFollow]),note=String(row[batch.mapping.businessNote??batch.mapping.note]||'').trim();
        if(type==='ticket'){
          const record=normalizeTicketRecord({id:`TI${importId}-${newTickets.length}`,customerId:customer.id,customer:customer.name,phone:customer.rawPhone||customer.phone,date,buyDate,sellDate,product:product||'未指定',direction,tradeRef,externalRef,assistant:customer.assistant,channel:customer.channel||customer.source,group:customer.group,status:'已确认',note});
          if(!ticketKeys.has(businessRecordSignature(record,'ticket'))){ticketKeys.add(businessRecordSignature(record,'ticket'));newTickets.push(record);rememberCustomer(customer);customer.ticket=true;}
        }else if(type==='deposit'&&Number.isFinite(amount)&&amount>0){
          const record={id:`DI${importId}-${newDeposits.length}`,customerId:customer.id,customer:customer.name,phone:customer.rawPhone||customer.phone,date,amount,currency:String(batch.mapping.currency==null?'INR':row[batch.mapping.currency]||'INR').trim()||'INR',externalRef,tradeRef,assistant:customer.assistant,channel:customer.channel||customer.source,group:customer.group,status:'已确认',note};
          if(!depositKeys.has(businessRecordSignature(record,'deposit'))){depositKeys.add(businessRecordSignature(record,'deposit'));newDeposits.push(record);rememberCustomer(customer);customer.deposit=true;customer.amount=(Number(customer.amount)||0)+amount;}
        }else if(type==='registration'){
          const record={id:`RI${importId}-${newRegistrations.length}`,customerId:customer.id,date,source:customer.channel||customer.source,owner:customer.assistant,status:'已报名',note,externalRef,tradeRef,createdAt:new Date().toISOString()};
          if(!registrationKeys.has(businessRecordSignature(record,'registration'))){registrationKeys.add(businessRecordSignature(record,'registration'));newRegistrations.push(record);rememberCustomer(customer);customer.registration='已报名';}
        }else if(type==='followup'){
          const record={id:`FI${importId}-${newFollowups.length}`,customerId:customer.id,date,method:'文件导入',result:note||'已完成跟进',note:note||'已完成跟进',nextDate};
          if(!followupKeys.has(businessRecordSignature(record,'followup'))){followupKeys.add(businessRecordSignature(record,'followup'));newFollowups.push(record);rememberCustomer(customer);const summary=window.ZhikeSmartImport?.latestFollowSummary?.(customer,record)||{lastFollow:date||customer.lastFollow,due:nextDate||customer.due};advanceCrm(customer,'follow');customer.lastFollow=summary.lastFollow||'';customer.due=summary.due||customer.due;}
        }
      }
    }
    if(state.customers.length+newCustomers.length>250000){restoreImportStaging();toast('客户库最多保留 250,000 位客户，请分批或清理后再导入','x');return;}
    if(state.importIssues.length+issues.length>100000){restoreImportStaging();toast('待复核记录将超过本机保留上限，请先在数据治理中导出并清理旧记录','x');return;}
    const before={customers:state.customers,importIssues:state.importIssues,activities:state.activities.slice(),pendingCsv:state.pendingCsv,tickets:state.tickets,deposits:state.deposits,registrations:state.registrations,followups:state.followups,batchOperations:state.batchOperations.slice()};
    const importModes=[...new Set(batches.map(batch=>window.ZhikeSmartImport?.importBatchMode?.(batch)||'customer'))];
    const importOperation={id:`IMP-${importId}`,type:'智能批量导入',value:importModes.join('、'),count:added+updated+matched,customerCount:added,updatedCount:updated,matchedCount:matched,ticketCount:newTickets.length,depositCount:newDeposits.length,registrationCount:newRegistrations.length,followupCount:newFollowups.length,issueCount:issues.length,decisionSamples,decisionPolicy:'local-rules-first-ai-advisory',files:batches.map(batch=>batch.filename).slice(0,20),createdAt:new Date().toISOString(),status:'已执行'};
    state.customers=[...newCustomers,...state.customers];state.tickets=[...newTickets,...state.tickets];state.deposits=[...newDeposits,...state.deposits];state.registrations=[...newRegistrations,...state.registrations];state.followups=[...newFollowups,...state.followups];state.importIssues=[...issues,...state.importIssues];state.batchOperations=[importOperation,...state.batchOperations].slice(0,500);state.pendingCsv=null;syncBusinessRuleState();
    activity(`智能导入 ${batches.length} 个文件：新增 ${added} 位，补齐 ${updated} 位，已关联 ${matched} 行，跟票 ${newTickets.length} 条，入金 ${newDeposits.length} 条，报名 ${newRegistrations.length} 条，跟进 ${newFollowups.length} 条，${issues.length} 行待复核`);
    try{await flushStateWrites();}
    catch{restoreImportStaging();Object.assign(state,before);intakePhoneIndex=null;businessIndexCache=null;countsCache=null;persist();toast('批量导入未能保存，已恢复导入前状态','x');return;}
    closeModal();render();toast(`智能导入完成：新增 ${added} 位，补齐 ${updated} 位，跟票 ${newTickets.length} 条，入金 ${newDeposits.length} 条，报名 ${newRegistrations.length} 条，跟进 ${newFollowups.length} 条，${issues.length} 行已保留待复核`);
  }
  function exportImportIssues(){const list=state.importIssues;if(!list.length){toast('没有导入审计记录');return;}const csv=['文件,行号,状态,原问题,处理时间,关联客户ID,原始行,导入字段快照,修正字段快照',...list.map(x=>[x.file,x.row,x.resolved?'已导入':x.ignored?'已忽略':'待复核',x.reason,x.resolvedAt||x.ignoredAt||'',x.resolvedCustomerId||'',x.raw,JSON.stringify(x.originalValues||x.values||{}),JSON.stringify(x.values||{})].map(csvCell).join(','))].join('\r\n');download(`导入行审计_${today}.csv`,'\ufeff'+csv,'text/csv;charset=utf-8');}
  function validateBackupData(backup){const record=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)),normalizePhone=value=>{const digits=String(value||'').replace(/\D/g,'');return digits.length===12&&digits.startsWith('91')?digits.slice(2):digits;};if(!record(backup)||!Array.isArray(backup.customers)||backup.customers.length>250000)throw new Error('备份格式不正确，无法识别客户列表。');const ids=new Set(),phones=new Set();for(const customer of backup.customers){const id=String(customer?.id??'').trim(),keys=record(customer)?[customer.phone,customer.rawPhone,...(Array.isArray(customer.legacyPhones)?customer.legacyPhones:[])].map(normalizePhone).filter(phone=>phone.length===10):[];if(!record(customer)||! /^[\p{L}\p{N}_-]{1,128}$/u.test(id)||ids.has(id))throw new Error('备份中的客户编号缺失、重复、过长或包含不支持的字符，未执行恢复。');if(!customer.deleted&&keys.some(phone=>phones.has(phone)))throw new Error('备份中存在重复客户号码。请先在原工作区数据治理中处理，未执行恢复。');ids.add(id);if(!customer.deleted)for(const phone of keys)phones.add(phone);}for(const key of ['tickets','deposits','followups','activities','savedViews','importIssues','phoneRegistry','registrations','batchOperations'])if(Object.hasOwn(backup,key)&&!Array.isArray(backup[key]))throw new Error(`备份中的${{tickets:'跟票',deposits:'入金',followups:'跟进',activities:'操作记录',savedViews:'保存视图',importIssues:'导入复核',phoneRegistry:'手机号登记',registrations:'报名',batchOperations:'批量操作'}[key]}清单格式异常，未执行恢复。`);for(const key of ['tickets','deposits','followups','activities','importIssues','phoneRegistry','registrations','batchOperations'])if(Array.isArray(backup[key])&&backup[key].some(item=>!record(item)))throw new Error(`备份中的${{tickets:'跟票',deposits:'入金',followups:'跟进',activities:'操作记录',phoneRegistry:'手机号登记',registrations:'报名',batchOperations:'批量操作'}[key]}记录格式异常，未执行恢复。`);for(const key of ['tickets','deposits','followups','registrations'])for(const item of backup[key]||[]){const customerId=String(item.customerId??'').trim();if(!customerId)continue;if(!/^[\p{L}\p{N}_-]{1,128}$/u.test(customerId)||!ids.has(customerId))throw new Error('备份中的业务记录关联了不存在或无效的客户编号，未执行恢复。');}for(const key of ['tickets','deposits','followups','activities','importIssues','phoneRegistry','registrations','batchOperations']){const seen=new Set();for(const item of backup[key]||[]){const id=String(item?.id??'').trim();if(id&&seen.has(id))throw new Error('备份中存在重复记录编号，未执行恢复。');if(id)seen.add(id);}}if(Array.isArray(backup.savedViews)&&backup.savedViews.some(item=>typeof item!=='string'&&!record(item)))throw new Error('备份中的保存视图格式异常，未执行恢复。');for(const key of ['settings','channelAliases','qualityDecisions'])if(Object.hasOwn(backup,key)&&!record(backup[key]))throw new Error(`备份中的${{settings:'系统设置',channelAliases:'渠道识别规则',qualityDecisions:'数据复核状态'}[key]}格式异常，未执行恢复。`);const operatingTasks=backup.settings?.operatingTasks;if(operatingTasks!==undefined&&(!Array.isArray(operatingTasks)||operatingTasks.some(task=>!record(task)||(task.customerId!=null&&task.customerId!==''&&!ids.has(String(task.customerId))))))throw new Error('备份中的任务记录关联了不存在的客户编号，未执行恢复。');}
  function validateStatusHistoryData(backup) {
    const validEvent = stored => {
      const event = window.ZhikeBusinessRules.normalizeMonitorStatusHistoryEvent(stored);
      return event && typeof event === 'object' && !Array.isArray(event) && ['joined', 'left'].includes(event.type)
        && /^\d{4}-\d{2}-\d{2}$/.test(event.date || '') && typeof event.to === 'string'
        && (!event.from || typeof event.from === 'string') && (!event.at || typeof event.at === 'string' && Number.isFinite(Date.parse(event.at)))
        && (!event.source || typeof event.source === 'string' && event.source.length <= (event.origin === 'ws-group-monitor' ? 160 : 48))
        && (!Object.hasOwn(event, 'initial') || typeof event.initial === 'boolean');
    };
    for (const customer of backup.customers) {
      if (Object.hasOwn(customer, 'statusHistory') && (!Array.isArray(customer.statusHistory) || customer.statusHistory.length > 100000 || !customer.statusHistory.every(validEvent))) {
        throw new Error('备份中的进退群状态历史格式异常，未执行恢复。');
      }
    }
  }
  async function decodeWorkspaceBackupFile(text){
    let backup=JSON.parse(text);
    if(backup?.backupFormat==='zhike-6-native-workspace'){
      if(Number(backup.version)!==6||typeof backup.payloadJson!=='string')throw new Error('自动备份格式不正确，未执行恢复。');
      const integrity=backup.integrity;if(!integrity||integrity.algorithm!=='SHA-256'||!/^[a-f0-9]{64}$/i.test(String(integrity.payloadSha256||'')))throw new Error('备份缺少 SHA-256 完整性信息，未执行恢复。');
      const actualHash=await sha256Text(backup.payloadJson);if(actualHash!==String(integrity.payloadSha256).toLowerCase())throw new Error('备份完整性校验失败，文件可能已损坏或被修改。');
      backup=JSON.parse(backup.payloadJson);
      if(backup?.backupFormat!=='zhike-6-workspace'||Number(backup.version)!==6)throw new Error('自动备份内容格式不正确，未执行恢复。');
      return backup;
    }
    if(backup?.backupFormat!=='zhike-6-workspace'||Number(backup?.version)!==6)throw new Error('仅支持知客 6 系列的完整备份，未读取旧版数据。');
    const integrity=backup.integrity;if(!integrity||integrity.algorithm!=='SHA-256'||!/^[a-f0-9]{64}$/i.test(String(integrity.payloadSha256||'')))throw new Error('备份缺少 SHA-256 完整性信息，未执行恢复。');
    const unsignedBackup={...backup};delete unsignedBackup.integrity;const actualHash=await sha256Text(JSON.stringify(unsignedBackup));if(actualHash!==String(integrity.payloadSha256).toLowerCase())throw new Error('备份完整性校验失败，文件可能已损坏或被修改。');
    return backup;
  }
  function prepareBackupWsAccounts(backup){
    const entries=backup.wsAccounts&&typeof backup.wsAccounts==='object'&&!Array.isArray(backup.wsAccounts)?Object.entries(backup.wsAccounts):backup.ws?[['default',backup.ws]]:[];
    const accounts=[];
    if(!entries.length)return accounts;
    const accountMeta=new Map((Array.isArray(backup.wsAccountMetadata)?backup.wsAccountMetadata:[]).map(item=>[String(item?.id||''),item]));
    for(const [accountId,value] of entries){
      if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('备份中的 WS 账号数据格式异常，未执行恢复。');
      const id=String(accountId),meta=accountMeta.get(id)||{};
      const embedded=Array.isArray(value.accounts)&&value.accounts.length===1?value.accounts[0]:null;
      if(Object.hasOwn(value,'accounts')&&(!embedded||String(embedded.id)!==id))throw new Error('WS 备份账号元数据与账号编号不一致，恢复已取消。');
      if(Object.hasOwn(meta,'workspaceMode')&&embedded&&Object.hasOwn(embedded,'workspaceMode')&&meta.workspaceMode!==embedded.workspaceMode)throw new Error('WS 备份的两处账号用途不一致，恢复已取消。');
      const backupMode=Object.hasOwn(meta,'workspaceMode')?meta.workspaceMode:embedded&&Object.hasOwn(embedded,'workspaceMode')?embedded.workspaceMode:undefined;
      const metadata={...embedded,id,displayName:meta.displayName||embedded?.displayName||id};
      if(backupMode!==undefined)metadata.workspaceMode=backupMode;
      accounts.push({...value,accountId:id,accounts:[metadata]});
    }
    return accounts;
  }
  function prepareBackupCrm(backup){
    const incoming={customers:normalizeCustomerRows(backup.customers,backup.settings?.sourceDefinitions),tickets:normalizeObjectRows(backup.tickets),deposits:normalizeObjectRows(backup.deposits),followups:normalizeObjectRows(backup.followups),registrations:normalizeObjectRows(backup.registrations),phoneRegistry:normalizeObjectRows(backup.phoneRegistry),batchOperations:normalizeObjectRows(backup.batchOperations),savedViews:normalizeSavedViews(backup.savedViews),activities:normalizeObjectRows(backup.activities),channelAliases:backup.channelAliases&&typeof backup.channelAliases==='object'?backup.channelAliases:{},settings:backup.settings&&typeof backup.settings==='object'?backup.settings:{},importIssues:normalizeObjectRows(backup.importIssues),qualityDecisions:backup.qualityDecisions&&typeof backup.qualityDecisions==='object'?backup.qualityDecisions:{}};
    const previous=Object.fromEntries(Object.keys(incoming).map(key=>[key,state[key]]));
    const lists=Object.fromEntries(Object.entries(optionCatalog).map(([key,item])=>[key,[...item.values]]));
    const previousLedgerDirty=groupLedgerDirty;
    // Existing normalization reads the active option catalog. Stage it only
    // within this synchronous turn, then put the live workspace back before I/O.
    try{
      Object.assign(state,incoming);groupLedgerDirty=true;applyOptionLists();exposeImportSourceCatalog();
      const restoredAt=new Date();
      state.activities=[{id:`A${Date.now()}-${Math.random().toString(36).slice(2,6)}`,text:`从备份恢复 ${state.customers.length} 位客户`,time:restoredAt.toLocaleString('zh-CN'),createdAt:restoredAt.toISOString(),color:'green'},...state.activities].slice(0,5000);
      return statePayload();
    }finally{
      Object.assign(state,previous);groupLedgerDirty=previousLedgerDirty;
      for(const [key,values] of Object.entries(lists))optionCatalog[key].values.splice(0,optionCatalog[key].values.length,...values);
    }
  }
  async function restoreBackupFile(file){
    if(!file)return;
    if(file.size>250*1024*1024){toast('备份文件超过 250 MB 上限','x');return;}
    if(destructiveWriteBusy){toast('已有工作区更改正在执行，请稍候。','x');return;}
    destructiveWriteBusy=true;localDataRevision++;
    let refreshAfter=false,accounts=[];
    const surface=typeof document==='undefined'?null:document.body;
    const wasInert=surface?.inert;
    try{
      const backup=await decodeWorkspaceBackupFile(await file.text());
      if(Object.hasOwn(backup,'wsAccounts')&&(!backup.wsAccounts||typeof backup.wsAccounts!=='object'||Array.isArray(backup.wsAccounts)))throw new Error('备份中的 WS 账号清单格式无效。');
      validateBackupData(backup);validateStatusHistoryData(backup);for(const key of ['registrations','batchOperations'])if(Object.hasOwn(backup,key)&&(!Array.isArray(backup[key])||backup[key].some(item=>!item||typeof item!=='object'||Array.isArray(item))))throw new Error(`备份中的${key==='registrations'?'报名记录':'批量操作记录'}格式异常，未执行恢复。`);
      const currentSummary={customers:state.customers.length,tickets:state.tickets.length,deposits:state.deposits.length,followups:state.followups.length},backupSummary={customers:backup.customers.length,tickets:Array.isArray(backup.tickets)?backup.tickets.length:0,deposits:Array.isArray(backup.deposits)?backup.deposits.length:0,followups:Array.isArray(backup.followups)?backup.followups.length:0};const created=backup.createdAt&&Number.isFinite(Date.parse(backup.createdAt))?new Date(backup.createdAt).toLocaleString():'未记录';const differences=[['客户',currentSummary.customers,backupSummary.customers],['跟票',currentSummary.tickets,backupSummary.tickets],['入金',currentSummary.deposits,backupSummary.deposits],['跟进',currentSummary.followups,backupSummary.followups]].map(([label,current,next])=>`${label}：当前 ${current} → 备份 ${next}（${next-current>=0?'+':''}${next-current}）`).join('\n');if(!confirm(`恢复差异预览\n备份时间：${created}\n\n${differences}\n\n确认后将替换当前工作区，并先自动建立当前数据快照。`))return;
      if(surface)surface.inert=true;
      if(window.__LOCAL_DB__){
        await flushStateWrites();
        const snapshot=await fetch('/api/snapshot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'恢复 JSON 备份前自动快照'})});
        const snapshotResult=await snapshot.json().catch(()=>({}));if(!snapshot.ok||snapshotResult.snapshotCreated!==true)throw new Error('无法建立恢复前快照，未执行恢复。');
        accounts=prepareBackupWsAccounts(backup);
      }
      const crm=prepareBackupCrm(backup);
      if(window.__LOCAL_DB__){
         const operationId=crypto.randomUUID();
         const body=JSON.stringify({operationId,crm,accounts});
         const headers={'Content-Type':'application/json','X-State-Version':stateVersion};
         for(let attempt=0;attempt<2;attempt++){
           try{
             const response=await fetch('/api/workspace/restore',{method:'POST',headers,body});
             const result=await response.json();
             if(!response.ok)throw Object.assign(new Error(result.error||result.message||'工作区恢复失败。'),{restoreRejected:(result.code||result.errorCode)==='WORKSPACE_RESTORE_REJECTED'});
             if(result.ok!==true||result.operationId!==operationId||!result.version)throw new Error('恢复结果未能确认。');
             stateVersion=String(result.version);lastCommittedState=cloneStateData(crm);break;
           }catch(error){
             if(error.restoreRejected)throw error;
             if(attempt===1)throw Object.assign(error,{restoreOutcomeUnknown:true});
           }
         }
       }
       applySharedData(crm);
       if(!window.__LOCAL_DB__)persist();
       state.selected.clear();state.extraFilters={};state.customerSearch='';
       if(accounts.length&&window.zhikeDesktop?.wsAccounts){
         try{
           const listed=await window.zhikeDesktop.wsAccounts({action:'list'});
           if(!accounts.every(item=>listed?.accounts?.some(row=>row.id===item.accountId)))throw new Error();
         }catch{try{render();}catch{}toast('工作区已恢复，桌面账号列表尚未刷新，请重新打开工作台。','x');return;}
       }
       try{render();toast(`备份恢复完成：${state.customers.length} 位客户`);}catch{toast('备份数据已恢复，但页面刷新失败；请重新打开知客工作台。','x');}
     }catch(error){
       refreshAfter=Boolean(window.__LOCAL_DB__);
       if(error?.restoreOutcomeUnknown){
         toast('工作区恢复结果未确认，请重新打开工作台核对数据库状态。','x');return;
       }
       toast(error.message||'无法读取备份文件','x');
     }finally{
       destructiveWriteBusy=false;
       if(surface)surface.inert=wasInert;
       if(refreshAfter)try{await refreshSharedState();}catch{}
     }
  }
  function saveIntake(){if(!state.parsed.length){toast('请先粘贴客户资料');return;}let added=0;const keep=[],newCustomers=[],knownPhones=knownIntakePhones(),knownVipNumbers=new Set(knownIntakeVipNumbers().keys()),batchTime=Date.now(),manualDate=$('#manualRegistered')?.checked,defaultDate=manualDate?($('#defaultRegistered')?.value||today):today,defaults=currentIntakeDefaults();for(const row of state.parsed){if(row.phone.length!==10||row.issues.length){keep.push(row.raw);continue;}if(knownPhones.has(row.phone)){keep.push(row.raw);continue;}const vipNumber=String(row.vipNumber||defaults.vipNumber||'').trim().slice(0,64),vipKeyValue=vipKey(vipNumber);if(vipKeyValue&&knownVipNumbers.has(vipKeyValue)){keep.push(row.raw);continue;}const page=row.pageExplicit?row.page:($('#defaultPage')?.value||''),source=normalizeBusinessSource(row.sourceExplicit?row.source:'',page,defaults.source);const item={id:`C${batchTime}-${added}-${Math.random().toString(36).slice(2,6)}`,name:row.name||'未命名客户',rawPhone:row.rawPhone,phone:row.phone,source,page,channel:source,assistant:row.assistant==='未分配'?($('#defaultAssistant')?.value||'未分配'):row.assistant,status:row.statusExplicit?row.status:($('#defaultStatus')?.value||(isGroupFanSource(source)?'在群':'未进群')),phase:row.phase||$('#defaultPhase')?.value||'新客户',hot:row.hotExplicit?row.hot:Boolean(defaults.hot),investor:row.investorExplicit?row.investor:Boolean(defaults.investor),group:row.group||$('#defaultGroup')?.value||'—',vipNumber,ticket:false,deposit:false,amount:0,registered:row.registered||defaultDate,lastFollow:'',due:row.due||(state.settings.autoInitialFollow===false?'—':localDateOffset(1)),note:row.note||$('#defaultNote')?.value||'',deleted:false,touched:false};item.status=recordCustomerStatus(item,item.status,{initial:true});newCustomers.push(item);knownPhones.set(row.phone,item);if(vipKeyValue)knownVipNumbers.add(vipKeyValue);added++;}if(state.customers.length+newCustomers.length>250000){toast('客户库已达到 250,000 条上限，本次录入未写入。','x');return;}if(added){state.settings.intakeBatches=[{id:'IB'+batchTime,createdAt:new Date().toISOString(),added,remaining:keep.length,customerIds:newCustomers.map(c=>c.id)},...(state.settings.intakeBatches||[])].slice(0,200);}state.customers=newCustomers.concat(state.customers);state.intakeText=keep.join('\n');state.settings.intakeDefaults=defaults;state.settings.intakeDraft={text:state.intakeText,defaults};persist();activity(`快速录入新增 ${added} 位客户`);parseIntake();return {added,remaining:keep.length};
  }
  async function applyBatch(type){
    const pending=state.pendingBatch;
    if(!pending||pending.type!==type){toast('批量预览已失效，请重新操作','x');return;}
    const ids=new Set(pending.ids),value=pending.value,next=batchNextValue(type,value),targets=state.customers.filter(customer=>ids.has(customer.id)&&!customer.deleted&&batchFieldValue(customer,type)!==next);
    if(!targets.length){state.pendingBatch=null;closeModal();toast('没有记录需要修改');return;}
    const label={assistant:'分配助理',status:'修改状态',follow:'安排跟进',hot:'调整热聊'}[type];
    if(!await snapshotBeforeWrite(`批量${label}前自动快照`))return;
    const before=targets.map(customer=>({customer,before:cloneStateData(customer)})),previousUndo=state.lastBatchUndo,previousActivities=state.activities.slice();
    for(const {customer} of before){if(type==='assistant')customer.assistant=value;if(type==='status')customer.status=recordCustomerStatus(customer,value);if(type==='follow')customer.due=value;if(type==='hot')customer.hot=value==='true';customer.touched=true;}
    const afterById=new Map(targets.map(customer=>[customer.id,cloneStateData(customer)]));
    const rows=before.map(item=>({before:item.before,afterValue:next,after:afterById.get(item.before.id)}));
    state.lastBatchUndo={label,type,rows,createdAt:new Date().toISOString()};state.pendingBatch=null;state.selected.clear();activity(`批量${label} ${targets.length} 位客户`);
    try{await flushStateWrites();closeModal();render();toast(`已更新 ${targets.length} 位客户，可在表格底部撤销`);}
    catch(error){for(const item of before)Object.assign(item.customer,item.before);state.lastBatchUndo=previousUndo;state.pendingBatch=pending;state.activities=previousActivities;persist();render();toast(error.message||'批量修改保存失败，已恢复原数据','x');}
  }
  async function undoLastBatch(){
    const undo=state.lastBatchUndo;
    if(!undo?.rows?.length){toast('没有可撤销的批量操作');return;}
    const current=new Map(state.customers.map(customer=>[customer.id,customer]));
    const restorable=undo.rows.filter(row=>{const customer=current.get(row.before.id);return customer&&!customer.deleted&&batchFieldValue(customer,undo.type)===row.afterValue&&(undo.type!=='status'||JSON.stringify(customer.statusHistory||[])===JSON.stringify(row.after?.statusHistory||[]));});
    if(!restorable.length){state.lastBatchUndo=null;render();toast('相关字段已有新修改，未覆盖；撤销记录已清除','x');return;}
    if(!await snapshotBeforeWrite('撤销批量操作前自动快照'))return;
    const before=restorable.map(row=>({row,customer:current.get(row.before.id),current:cloneStateData(current.get(row.before.id))}));
    for(const {row,customer} of before){const previous=row.before,after=row.after||{},ignore=new Set(['touched',undo.type==='assistant'?'assistant':undo.type==='status'?'status':undo.type==='follow'?'due':'hot',...(undo.type==='status'?['statusHistory']:[])]),keys=new Set([...Object.keys(customer),...Object.keys(after)]),hasOtherChanges=[...keys].some(key=>!ignore.has(key)&&JSON.stringify(customer[key])!==JSON.stringify(after[key]));if(undo.type==='assistant')customer.assistant=previous.assistant;if(undo.type==='status'){customer.status=previous.status;customer.statusHistory=cloneStateData(previous.statusHistory||[]);}if(undo.type==='follow')customer.due=previous.due;if(undo.type==='hot')customer.hot=Boolean(previous.hot);customer.touched=Boolean(previous.touched||hasOtherChanges);}
    const count=restorable.length,skipped=undo.rows.length-count,label=undo.label,previousActivities=state.activities.slice();state.lastBatchUndo=null;activity(`撤销批量${label} ${count} 位客户${skipped?`，跳过 ${skipped} 位有新修改的客户`:''}`);
    try{await flushStateWrites();render();toast(`已撤销批量${label}，恢复 ${count} 位客户${skipped?`，跳过 ${skipped} 位有新修改的客户`:''}`);}
    catch(error){for(const item of before)Object.assign(item.customer,item.current);state.lastBatchUndo=undo;state.activities=previousActivities;persist();render();toast(error.message||'撤销批量操作保存失败，已恢复原数据','x');}
  }
  async function saveCurrentView(mode){
    const scope=mode==='segment'?'segment':'customer',custom=state.savedViews.filter(view=>view.scope===scope&&!view.builtin);
    if(custom.length>=50){toast('此区域最多保存 50 个自定义视图');return;}
    const answer=await requestText('保存筛选视图','名称最多 32 个字符。','',{label:'视图名称',maxLength:32});if(answer===null)return;
    const name=answer.trim().slice(0,32);if(!name){toast('视图名称不能为空');return;}
    if(state.savedViews.some(view=>view.scope===scope&&view.name.toLocaleLowerCase()===name.toLocaleLowerCase())){toast('此区域已有同名视图');return;}
    if(!await snapshotBeforeWrite('保存筛选视图前自动快照'))return;
    const before=state.savedViews.slice(),beforeActivities=state.activities.slice(),filters=scope==='customer'?{...state.extraFilters}:{...state.segment},search=scope==='customer'?state.customerSearch:state.search;
    state.savedViews.push({id:`view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`,name,scope,filters,search,builtin:false});activity(`保存${scope==='customer'?'客户中心':'分类视图'}：${name}`);
    try{await flushStateWrites();render();toast(`已保存视图：${name}`);}catch(error){state.savedViews=before;state.activities=beforeActivities;persist();render();toast(error.message||'保存视图失败，已恢复原数据','x');}
  }
  async function renameSavedView(id){
    const view=state.savedViews.find(item=>item.id===id);if(!view||view.builtin){toast('默认视图不能重命名');return;}
    const answer=await requestText('修改视图名称','名称最多 32 个字符。',view.name,{label:'视图名称',maxLength:32});if(answer===null)return;
    const name=answer.trim().slice(0,32);if(!name){toast('视图名称不能为空');return;}
    if(state.savedViews.some(item=>item.id!==id&&item.scope===view.scope&&item.name.toLocaleLowerCase()===name.toLocaleLowerCase())){toast('此区域已有同名视图');return;}
    if(!await snapshotBeforeWrite('重命名筛选视图前自动快照'))return;
    const before=view.name,beforeActivities=state.activities.slice();view.name=name;activity(`重命名保存视图：${name}`);
    try{await flushStateWrites();render();toast('视图名称已更新');}catch(error){view.name=before;state.activities=beforeActivities;persist();render();toast(error.message||'重命名视图失败，已恢复原名称','x');}
  }
  async function deleteSavedView(id){
    const view=state.savedViews.find(item=>item.id===id);if(!view||view.builtin){toast('默认视图不能删除');return;}
    if(!confirm(`删除保存视图“${view.name}”？不会删除客户数据。`))return;
    if(!await snapshotBeforeWrite('删除筛选视图前自动快照'))return;
     const before=state.savedViews.slice(),beforeActivities=state.activities.slice();state.savedViews=state.savedViews.filter(item=>item.id!==id);activity(`删除保存视图：${view.name}`);
     try{await flushStateWrites();render();toast('保存视图已删除');}catch(error){state.savedViews=before;state.activities=beforeActivities;persist();render();toast(error.message||'删除视图失败，已恢复原视图','x');}
  }
  function restoreCustomerFields(customer,before){
    for(const key of Object.keys(customer))if(!Object.hasOwn(before,key))delete customer[key];
    Object.assign(customer,before);
  }
  let customerEditPending=false,followupSavePending=false;
  async function saveCustomer(id){
    if(customerEditPending)return;
    const c=state.customers.find(item=>sameId(item.id,id)&&!item.deleted);
    if(!c){toast('找不到这位客户，请刷新后重试','x');return;}
    const rawPhone=$('#editPhone').value.trim(),phone=linkedPhone(rawPhone);
    if(phone.length!==10){toast('号码格式异常，请检查后再保存');return;}
    const vipNumber=($('#editVipNumber')?.value||'').trim().slice(0,64);
    const draft={
      name:$('#editName').value.trim()||c.name,rawPhone,phone,source:$('#editSource').value,
      page:$('#editPage').value,assistant:$('#editAssistant').value,phase:$('#editPhase').value,
      qualification:$('#editQualification')?.value||'待评估',group:$('#editGroup').value||'—',note:$('#editNote').value,
    };
    const status=$('#editStatus').value;
    const hasConflicts=()=>{
      if(state.customers.some(other=>!sameId(other.id,c.id)&&!other.deleted&&linkedPhone(other.phone||other.rawPhone)===phone)){
        toast('这个号码已属于其他客户，请先在数据治理中核对重复号码');return true;
      }
      if(vipNumber&&state.customers.some(other=>!sameId(other.id,c.id)&&!other.deleted&&String(other.vipNumber||'').trim().toLocaleLowerCase()===vipNumber.toLocaleLowerCase())){
        toast('这个 VIP 编号已属于其他客户，请先检查 VIP 管理','x');return true;
      }
      return false;
    };
    if(hasConflicts())return;
    customerEditPending=true;
    try{
      if(!await snapshotBeforeWrite('编辑客户前自动快照'))return;
      if(c.deleted||!state.customers.includes(c)){toast('客户档案已更新，请重新打开后编辑','x');return;}
      if(hasConflicts())return;
      const before={...c},key=String(c.id),previousDecision=state.qualityDecisions[key],previousActivities=state.activities.slice();
      const priorPhone=linkedPhone(c.phone||c.rawPhone);
      if(priorPhone&&priorPhone!==phone)c.legacyPhones=[...new Set([...(c.legacyPhones||[]),priorPhone])];
      Object.assign(c,{
        name:draft.name,rawPhone,phone,source:draft.source,page:draft.page,
        channel:draft.source,assistant:draft.assistant,
      });
      c.status=recordCustomerStatus(c,status);
      c.phase=draft.phase;
      c.qualification=draft.qualification;
      if(vipNumber)c.vipNumber=vipNumber;
      else delete c.vipNumber;
      if(['已进群','在群'].includes(c.status))advanceCrm(c,'joined');
      c.group=draft.group;
      c.note=draft.note;
      c.touched=true;
      delete state.qualityDecisions[key];
      persist();
      activity(`修改客户 ${c.name} 的资料`);
      try{
        await flushStateWrites();
      }catch{
        restoreCustomerFields(c,before);
        if(previousDecision!==undefined)state.qualityDecisions[key]=previousDecision;
        else delete state.qualityDecisions[key];
        state.activities=previousActivities;
        persist();
        toast('保存失败，已恢复到修改前状态','x');
        render();
        return;
      }
      closeModal();
      render();
      toast('客户资料已保存');
    }finally{customerEditPending=false;}
  }
  async function setCustomerDeleted(id,deleted){const customer=state.customers.find(item=>sameId(item.id,id));if(!customer||Boolean(customer.deleted)===deleted)return;if(!deleted){const phone=phoneForQuality(customer),phoneOwner=phone.length===10?state.customers.find(item=>!sameId(item.id,customer.id)&&!item.deleted&&phoneForQuality(item)===phone):null;if(phoneOwner){toast(`无法恢复：号码已属于 ${phoneOwner.name}`,'x');return;}const vip=vipKey(customer.vipNumber||customer.vipId||customer.vipCode),vipOwner=vip?state.customers.find(item=>!sameId(item.id,customer.id)&&!item.deleted&&vipKey(item.vipNumber||item.vipId||item.vipCode)===vip):null;if(vipOwner){toast(`无法恢复：VIP 编号已属于 ${vipOwner.name}`,'x');return;}}if(!await snapshotBeforeWrite(deleted?'移入回收站前自动快照':'恢复客户前自动快照'))return;const before=Boolean(customer.deleted),beforeDeletedAt=customer.deletedAt,previousActivities=state.activities.slice();customer.deleted=deleted;if(deleted)state.selected.delete(customer.id);persist();activity(`${deleted?'将':'从回收站恢复'} ${customer.name}`);try{await flushStateWrites();}catch{customer.deleted=before;if(beforeDeletedAt===undefined)delete customer.deletedAt;else customer.deletedAt=beforeDeletedAt;state.activities=previousActivities;persist();toast('本机数据库保存失败，已恢复原状态','x');render();return;}render();toast(deleted?'客户已移入回收站':'客户已恢复');}
  async function batchDeleteCustomers(){const targets=state.customers.filter(customer=>!customer.deleted&&state.selected.has(selectionKey(customer.id)));if(!targets.length){toast('请先选择要删除的客户','x');return;}if(!confirm(`确认将已选的 ${targets.length} 位客户移入回收站？\n\n客户资料不会永久删除，可以在“回收站”中恢复。`))return;if(!await snapshotBeforeWrite('批量删除客户前自动快照'))return;const previousRows=targets.map(customer=>({customer,deleted:customer.deleted,deletedAt:customer.deletedAt})),previousSelected=new SelectionSet(state.selected),previousActivities=state.activities.slice();for(const customer of targets){customer.deleted=true;customer.deletedAt=new Date().toISOString();}state.selected.clear();persist();activity(`批量将 ${targets.length} 位客户移入回收站`);try{await flushStateWrites();}catch{for(const item of previousRows){item.customer.deleted=item.deleted;if(item.deletedAt===undefined)delete item.customer.deletedAt;else item.customer.deletedAt=item.deletedAt;}state.selected=new SelectionSet(previousSelected);state.activities=previousActivities;persist();toast('本机数据库保存失败，已恢复所有客户','x');render();return;}render();toast(`已将 ${targets.length} 位客户移入回收站`);}
  function extendedBatchModal(type){if(!state.selected.size){toast('请先选择客户');return;}const config={qualification:['修改客户评级',`<select id="extendedBatchValue">${qualifications.map(x=>`<option>${esc(x)}</option>`).join('')}</select>`],registration:['修改报名状态','<select id="extendedBatchValue"><option value="已报名">已报名</option><option value="">清空报名状态</option></select>'],phase:['修改客户阶段',`<select id="extendedBatchValue">${phases.map(x=>`<option>${esc(x)}</option>`).join('')}</select>`],tag:['添加客户标签','<input id="extendedBatchValue" maxlength="30" placeholder="输入标签">']}[type];openModal(`批量${config[0]}`,'先查看影响范围，再确认写入',`<label class="filter-field"><span>目标值</span>${config[1]}</label><div class="notice-line">将预览 ${state.selected.size} 位已选择客户，不会立即写入。</div>`,`<button class="btn" data-action="close-modal">取消</button><button class="btn primary" data-action="extended-batch-preview" data-type="${type}">预览变更</button>`);}
  function extendedBatchPreview(type){const value=$('#extendedBatchValue')?.value.trim();if(!value&&type!=='registration'){toast('请输入或选择目标值','x');return;}const targets=state.customers.filter(c=>!c.deleted&&state.selected.has(c.id)),read=c=>type==='qualification'?(c.qualification||'未评级'):type==='registration'?(c.registration||'未报名'):type==='phase'?(c.phase||'未设置'):((c.tags||[]).join('、')||'无标签'),changed=targets.filter(c=>type==='tag'?!(c.tags||[]).includes(value):read(c)!==(value||'未报名'));state.pendingExtendedBatch={type,value,ids:changed.map(c=>c.id)};openModal('批量变更预览','确认前请核对目标值与客户名单',`<div class="batch-preview-summary"><div><span>已选择</span><strong>${targets.length}</strong></div><div><span>将变更</span><strong>${changed.length}</strong></div><div><span>不变</span><strong>${targets.length-changed.length}</strong></div></div><div class="batch-preview-target"><span>目标值</span><strong>${esc(value||'清空')}</strong></div><div class="batch-preview-list">${changed.slice(0,20).map(c=>`<span class="batch-preview-name">${esc(c.name)} · ${esc(read(c))} → ${esc(value||'清空')}</span>`).join('')||'<span>没有需要变更的客户</span>'}</div>`,`<button class="btn" data-action="batch-${type}">返回调整</button><button class="btn primary" data-action="extended-batch-apply" data-type="${type}" ${changed.length?'':'disabled'}>确认并执行</button>`);}
  async function applyExtendedBatch(type){const pending=state.pendingExtendedBatch;if(!pending||pending.type!==type)return;const targets=state.customers.filter(c=>pending.ids.includes(c.id));if(!targets.length)return;if(!await snapshotBeforeWrite('6.0 批量运营写入前快照'))return;const before=targets.map(cloneStateData),beforeRegistrations=state.registrations.slice(),beforeBatchOperations=state.batchOperations.slice(),beforeUndo=state.lastBatchUndo,beforeActivities=state.activities.slice(),now=new Date().toISOString();for(const c of targets){if(type==='qualification'){const old=c.qualification||'未评级';c.qualification=pending.value;c.qualificationUpdatedAt=now;c.qualificationHistory=[...(c.qualificationHistory||[]),{id:`Q${Date.now()}-${c.id}`,from:old,to:pending.value,at:now,date:today}].slice(-100);}if(type==='registration'){c.registration=pending.value;if(pending.value==='已报名')state.registrations.unshift({id:`RB${Date.now()}-${c.id}`,customerId:c.id,date:now,source:'批量运营',owner:c.assistant,status:'已报名',note:'批量设置报名状态',createdAt:now});}if(type==='phase')c.phase=pending.value;if(type==='tag')c.tags=[...new Set([...(c.tags||[]),pending.value])];c.touched=true;}const op={id:`OP${Date.now()}`,type,value:pending.value,count:targets.length,createdAt:now,before,after:targets.map(cloneStateData),status:'已执行'};state.batchOperations.unshift(op);state.batchOperations=state.batchOperations.slice(0,500);state.lastBatchUndo={label:{qualification:'修改评级',registration:'报名状态',phase:'客户阶段',tag:'添加标签'}[type],type:`extended:${type}`,rows:before.map((item,index)=>({before:item,after:op.after[index]})),createdAt:now,operationId:op.id};state.pendingExtendedBatch=null;state.selected.clear();activity(`批量${op.type} ${targets.length} 位客户`);try{await flushStateWrites();closeModal();render();toast(`批量操作完成：${targets.length} 位客户，已保存快照和操作记录`);}catch(error){for(const item of before){const current=state.customers.find(customer=>String(customer.id)===String(item.id));if(current)Object.assign(current,item);}state.registrations=beforeRegistrations;state.batchOperations=beforeBatchOperations;state.lastBatchUndo=beforeUndo;state.pendingExtendedBatch=pending;state.activities=beforeActivities;persist();render();toast(error.message||'批量操作保存失败，已恢复原数据','x');}}

  async function undoExtendedBatch(){
    const undo=state.lastBatchUndo;if(!undo?.rows?.length||!String(undo.type).startsWith('extended:'))return undoLastBatch();
    if(!await snapshotBeforeWrite('撤销 6.0 批量操作前自动快照'))return;
    const beforeCustomers=undo.rows.map(row=>({id:row.before.id,current:cloneStateData(state.customers.find(customer=>String(customer.id)===String(row.before.id))||row.before)})),beforeRegistrations=state.registrations.slice(),beforeBatchOperations=state.batchOperations.slice();
    const byId=new Map(state.customers.map((customer,index)=>[String(customer.id),index]));for(const row of undo.rows){const index=byId.get(String(row.before.id));if(index!==undefined)state.customers[index]=cloneStateData(row.before);}
    if(undo.type==='extended:registration')state.registrations=state.registrations.filter(item=>!(item.source==='批量运营'&&item.createdAt===undo.createdAt));
    const operation=state.batchOperations.find(item=>item.id===undo.operationId);if(operation){operation.status='已撤销';operation.undoneAt=new Date().toISOString();}
    const count=undo.rows.length,label=undo.label,previousActivities=state.activities.slice();state.lastBatchUndo=null;activity(`撤销批量${label} ${count} 位客户`);
    try{await flushStateWrites();render();toast(`已撤销批量${label}，恢复 ${count} 位客户`);}catch(error){for(const item of beforeCustomers){const index=byId.get(String(item.id));if(index!==undefined)state.customers[index]=item.current;}state.registrations=beforeRegistrations;state.batchOperations=beforeBatchOperations;state.lastBatchUndo=undo;state.activities=previousActivities;persist();render();toast(error.message||'撤销批量操作保存失败，已恢复原数据','x');}
  }

  async function handleAction(action,el){
    const id=el.dataset.id;const customer=state.customers.find(c=>sameId(c.id,id));
    if(action==='create-customer'){
      const name=$('#newName')?.value.trim()||'',rawPhone=$('#newPhone')?.value.trim()||'';
      if(name.length>80){toast('客户姓名最多 80 个字符','x');return;}
      if(rawPhone.length>64){toast('原始号码内容过长，请检查','x');return;}
      $('#newName').value=name;$('#newPhone').value=rawPhone;
    }
    if(action==='save-customer'){
      const name=$('#editName')?.value.trim()||'',rawPhone=$('#editPhone')?.value.trim()||'',group=$('#editGroup')?.value.trim()||'',note=$('#editNote')?.value||'';
      if(!name){toast('客户姓名不能只包含空格','x');return;}
      if(name.length>80||rawPhone.length>64||group.length>80||note.length>2000){toast('资料过长：姓名/群编号最多 80 字符，备注最多 2000 字符','x');return;}
    }
    if(action==='save-follow'){
      const followDate=$('#followDate')?.value||'',nextFollow=$('#nextFollow')?.value||'',note=$('#followNote')?.value||'';
      if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(followDate)||!/^\d{4}-\d{2}-\d{2}$/.test(nextFollow)){toast('请填写有效的跟进时间和下次跟进日期','x');return;}
      if(note.length>2000){toast('跟进结果最多 2000 个字符','x');return;}
    }
    if(action==='save-business'){
      const note=$('#businessNote')?.value||'',product=$('#businessProduct')?.value||'';
      if(product.length>120||note.length>2000){toast('产品名称最多 120 字符，业务备注最多 2000 字符','x');return;}
    }
    if(action==='open-search-customer'){if(customer&&!customer.deleted)showCustomer(customer);return;}
    if(action==='open-search-list'){const query=$('#globalSearchInput')?.value.trim();closeModal();if(query){state.extraFilters={};state.customerSearch=query;setView('customers');}return;}
    if(['home-overdue','home-high-value','home-unfollowed-registered'].includes(action)){state.homeCustomerScope={'home-overdue':'overdue','home-high-value':'high-value','home-unfollowed-registered':'registered-unfollowed'}[action];state.extraFilters={};state.customerSearch='';setView('customers');return;}
    if(action==='go-customers'){state.homeCustomerScope='';setView('customers');return;}if(action==='go-vip'){state.vipFilter='all';setView('vip');return;}if(action==='go-registrations'){setView('registrations');return;}
    if(action==='go-ws')window.__zhikeWsFollowups?.openWorkspace?.();else if(action==='go-operations')setView('operations');else if(action==='go-intake')setView('intake');else if(action==='go-followups'){state.followTab='open';setView('followups');}else if(action==='go-hot'){state.hotFilter='all';setView('hot');}else if(action==='go-hot-stale'){state.hotFilter='stale';setView('hot');}else if(action==='go-assistant-suggestions'){state.view='automation';state.automationView='assistant-suggestions';render();}else if(action==='automation-overview'){state.automationView='overview';render();}else if(action==='go-analytics')setView('analytics');else if(action==='go-activity')setView('activity');else if(action==='go-quality')setView('quality');else if(action==='go-data')setView('data');else if(action==='go-tickets')setView('tickets');else if(action==='go-deposits')setView('deposits');else if(action==='go-groups')setView('groups');
    else if(action==='go-segments'){const dynamicSource=String(el.dataset.homeSource||'').trim();if(dynamicSource){const scope=el.dataset.homeScope||'today',type=el.dataset.homeStatus==='left'?'left':'joined';state.segment={...segmentFilterDefaults(),source:dynamicSource,...(scope==='today'?{eventFilter:`${today}:${type}`}:{status:type==='joined'?'已进群（含在群）':'退群（含临时）'})};state.segmentCard='';state.search='';}else{const key=el.dataset.homeFilter;const map={'single-joined':{source:'单导',type:'joined'},'single-left':{source:'单导',type:'left'},'group-joined':{source:'群粉',type:'joined'},'group-left':{source:'群粉',type:'left'},'single-total-joined':{source:'单导',status:'已进群（含在群）'},'single-total-left':{source:'单导',status:'退群（含临时）'},'group-total-joined':{source:'群粉',status:'已进群（含在群）'},'group-total-left':{source:'群粉',status:'退群（含临时）'}};const filter=map[key];if(filter){state.segment={...segmentFilterDefaults(),source:filter.source,...(filter.type?{eventFilter:`${today}:${filter.type}`}:{status:filter.status})};state.segmentCard='';state.search='';}}setView('segments');}
    else if(action==='toggle-customer-preview'&&state.view==='customers'){state.customerPreviewCollapsed=!state.customerPreviewCollapsed;render();$('#viewContainer [data-action="toggle-customer-preview"]')?.focus();}
    else if(action==='toggle-filters'){state.showFilters=!state.showFilters;render();}
    else if(action==='clear-filters'){state.homeCustomerScope='';state.segment=segmentFilterDefaults();state.segmentCard='';state.search='';state.extraFilters={};render();}
    else if(action==='clear-extra'){state.extraFilters={};render();}
    else if(action==='clear-search'){state.customerSearch='';state.homeCustomerScope='';render();}
    else if(action==='clear-selection'){state.selected.clear();render();}
    else if(action==='save-view')await saveCurrentView(el.dataset.mode||(state.view==='segments'?'segment':'customer'));
    else if(action==='rename-view')await renameSavedView(id);
    else if(action==='delete-view')await deleteSavedView(id);
    else if(action==='new-customer')newCustomerModal();
    else if(action==='create-customer'){const raw=$('#newPhone').value;const phone=linkedPhone(raw);if(phone.length!==10){toast('请输入有效的10位标准号码','x');return;}const duplicate=knownIntakePhones().get(phone);if(duplicate){toast(`号码已存在：${duplicate.name}（${duplicate.rawPhone||duplicate.phone}），未新增客户`,'x');return;}const beforeCustomers=state.customers.slice(),beforeActivities=state.activities.slice(),source=$('#newSource').value,vipNumber=($('#newVipNumber')?.value||'').trim().slice(0,64);if(vipNumber&&state.customers.some(item=>!item.deleted&&String(item.vipNumber||'').trim().toLocaleLowerCase()===vipNumber.toLocaleLowerCase())){toast('这个 VIP 编号已属于其他客户','x');return;}const customer={id:`C${Date.now()}`,name:$('#newName').value||'新客户',rawPhone:raw,phone,source,page:$('#newPage').value,channel:source,assistant:$('#newAssistant').value,status:$('#newStatus').value,phase:'新客户',qualification:$('#newQualification')?.value||'待评估',vipNumber,hot:false,investor:false,group:'—',ticket:false,deposit:false,amount:0,registered:today,lastFollow:'',due:today,note:'',deleted:false,touched:true};customer.status=recordCustomerStatus(customer,customer.status,{initial:true});state.customers.unshift(customer);intakePhoneIndex=null;activity('新增客户 '+($('#newName').value||phone));try{await flushStateWrites();closeModal();render();toast('客户已保存到本机');}catch(error){state.customers=beforeCustomers;state.activities=beforeActivities;intakePhoneIndex=null;persist();render();toast(error.message||'客户保存失败，已恢复原数据','x');}}
    else if(action==='edit-customer'&&customer){closeCustomerDrawer();editCustomerModal(customer);}
    else if(action==='save-customer')await saveCustomer(id);
    else if(action==='follow'&&customer){closeCustomerDrawer();followModal(customer);}
    else if(action==='save-follow'){
      const c=customer;
      if(!c||followupSavePending)return;
      followupSavePending=true;
      el.disabled=true;
      try{
        const followDate=$('#followDate').value,followDay=followDate.slice(0,10);
        const followNote=$('#followNote').value||'已完成跟进',registration=$('#followRegistration').value||'';
        const beforeCustomer={...c},beforeFollowups=state.followups.slice(),beforeRegistrations=state.registrations.slice(),beforeActivities=state.activities.slice();
        const previousFollowDay=String(c.lastFollow||'').slice(0,10);
        const latest=window.ZhikeSmartImport?.latestFollowSummary?.(c,{date:followDate})?.lastFollow||
          (isValidDateKey(previousFollowDay)&&previousFollowDay>followDay?previousFollowDay:followDay);
        c.registration=registration;
        c.due=$('#nextFollow').value||today;
        c.note=followNote;
        c.touched=true;
        const followId=`F${Date.now()}`;
        state.followups.unshift({id:followId,customerId:c.id,date:followDate,method:$('#followMethod').value,registration,result:followNote,note:followNote,nextDate:c.due});
        if(registration==='已报名')state.registrations.unshift({id:`R${Date.now()}`,customerId:c.id,date:followDate,source:'跟进登记',owner:c.assistant,status:'已报名',note:followNote,createdAt:new Date().toISOString(),followupId:followId});
        advanceCrm(c,'follow');
        c.lastFollow=latest;
        activity(`完成 ${c.name} 的跟进${registration?`，报名状态：${registration}`:''}`);
        try{
          await flushStateWrites();
        }catch(error){
          restoreCustomerFields(c,beforeCustomer);
          state.followups=beforeFollowups;
          state.registrations=beforeRegistrations;
          state.activities=beforeActivities;
          persist();
          render();
          toast(error.message||'跟进保存失败，已恢复原数据','x');
          return;
        }
        closeModal();
        render();
        toast(`跟进已保存${registration?` · ${registration}`:''}`);
      }finally{
        followupSavePending=false;
        el.disabled=false;
      }
    }
    else if(action==='new-registration')registrationModal();
    else if(action==='save-registration'){const customerId=$('#registrationCustomer')?.value,status=$('#registrationStatus')?.value,c=state.customers.find(x=>sameId(x.id,customerId)&&!x.deleted);if(!c){toast('请选择有效客户','x');return;}if(status!=='已报名'){toast('报名状态未选择“已报名”，未计入报名统计');return;}const beforeCustomer=structuredClone(c),beforeRegistrations=state.registrations.slice(),beforeActivities=state.activities.slice(),record={id:`R${Date.now()}-${Math.random().toString(36).slice(2,6)}`,customerId:c.id,date:$('#registrationDate')?.value||new Date().toISOString(),source:$('#registrationSource')?.value.trim()||c.source,owner:$('#registrationOwner')?.value||c.assistant,status,note:$('#registrationNote')?.value.trim()||'',createdAt:new Date().toISOString()};state.registrations.unshift(record);c.registration='已报名';c.touched=true;activity(`新增报名记录：${c.name} · ${record.source}`);try{await flushStateWrites();closeModal();state.view='registrations';render();toast('报名记录已保存并关联客户档案');}catch(error){Object.assign(c,beforeCustomer);state.registrations=beforeRegistrations;state.activities=beforeActivities;persist();render();toast(error.message||'报名记录保存失败，已恢复原数据','x');}}
    else if(action==='commit-csv')await commitCsvImportWithSnapshot();else if(action==='save-import-mapping')await saveCurrentImportMapping();
    else if(action==='deduplicate-customers')deduplicatePreview();
    else if(action==='apply-deduplicate-customers')await applyDeduplicateCustomers();
    else if(action==='batch-delete-customers')await batchDeleteCustomers();
    else if(['batch-qualification','batch-registration','batch-phase','batch-tag'].includes(action))extendedBatchModal(action.replace('batch-',''));
    else if(action==='extended-batch-preview')extendedBatchPreview(el.dataset.type);
    else if(action==='extended-batch-apply')await applyExtendedBatch(el.dataset.type);
    else if(action==='batch-assistant')batchModal('assistant');else if(action==='batch-status')batchModal('status');else if(action==='batch-follow')batchModal('follow');else if(action==='batch-hot')batchModal('hot');else if(action==='preview-batch')previewBatch(el.dataset.type);else if(action==='apply-batch')await applyBatch(el.dataset.type);else if(action==='undo-batch')await undoExtendedBatch();else if(action==='dismiss-batch-undo'){state.lastBatchUndo=null;render();}
    else if(action==='import-tickets')$('#ticketImportFile')?.click();
    else if(action==='quick-intake-file')$('#quickIntakeFile')?.click();
    else if(action==='edit-business-record')editBusinessRecord(el.dataset.kind,id);
    else if(action==='save-business-edit')await saveBusinessEdit(el.dataset.kind,id);
    else if(action==='delete-business-record')await deleteBusinessRecord(el.dataset.kind,id);
    else if(action==='registration-page'){state.registrationPage=Math.max(1,Number(el.dataset.page)||1);render();}
    else if(action==='delete-registration-record')await deleteRegistrationRecord(id);
    else if(action==='new-ticket'||action==='new-deposit'){if(!activeCustomers().length){toast('请先新增或导入客户，再登记业务记录','x');return;}businessModal(action==='new-ticket'?'ticket':'deposit');}
    else if(action==='new-customer-ticket'||action==='new-customer-deposit'){if(!customer)return;closeCustomerDrawer();businessModal(action==='new-customer-ticket'?'ticket':'deposit',customer.id);}
    else if(action==='save-business'){const c=state.customers.find(x=>sameId(x.id,$('#businessCustomer').value));if(!c){toast('所选客户不存在或已移入回收站','x');return;}const date=$('#businessDate').value;if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')){toast('请选择有效的业务日期','x');return;}const beforeCustomer=structuredClone(c),beforeTickets=state.tickets.slice(),beforeDeposits=state.deposits.slice(),beforeActivities=state.activities.slice(),type=el.dataset.type,common={id:`B${Date.now()}-${Math.random().toString(36).slice(2,6)}`,customer:c.name,phone:c.rawPhone,date,assistant:c.assistant,channel:c.channel,group:c.group,status:'已确认',note:$('#businessNote').value.trim(),customerId:c.id};if(type==='ticket'){const record=normalizeTicketRecord({...common,product:$('#businessProduct').value.trim()||'未指定',direction:$('#businessDirection').value});if(state.tickets.some(item=>businessRecordSignature(item,'ticket')===businessRecordSignature(record,'ticket'))){toast('完全相同的跟票记录已存在，未重复写入；同一客户的买入和卖出会按各自日期单独保留','x');return;}state.tickets.unshift(record);c.ticket=true;advanceCrm(c,'ticket');}else{const amount=Number($('#businessAmount').value);if(!Number.isFinite(amount)||amount<=0||amount>1000000000000){toast('请输入大于 0 且不超过 1 万亿的有效入金金额','x');return;}const record={...common,amount,currency:$('#businessCurrency').value};if(state.deposits.some(item=>businessRecordSignature(item,'deposit')===businessRecordSignature(record,'deposit'))){toast('完全相同的入金记录已存在，未重复写入','x');return;}state.deposits.unshift(record);c.deposit=true;c.amount=(Number(c.amount)||0)+amount;advanceCrm(c,'deposit');}activity(`${c.name} 新增${type==='ticket'?'跟票':'入金'}记录，CRM 阶段更新为${c.phase}`);try{await flushStateWrites();closeModal();render();toast(`业务记录已保存 · 当前阶段：${c.phase}`);}catch(error){Object.assign(c,beforeCustomer);state.tickets=beforeTickets;state.deposits=beforeDeposits;state.activities=beforeActivities;persist();render();toast(error.message||'业务记录保存失败，已恢复原数据','x');}}
    else if(action==='backup'){
      const createdAt=new Date().toISOString();
      try{
        await flushStateWrites();
        const workspace=statePayload();
        if(new TextEncoder().encode(JSON.stringify(workspace)).byteLength>95*1024*1024)throw new Error('当前客户数据超过 95 MB 可恢复上限，未生成无法恢复的完整备份。');
        const wsBackup=window.__zhikeWsBackup;
        if(!wsBackup?.listAccounts||!wsBackup?.exportData)throw new Error('WS 本机备份服务不可用，未生成不完整备份。');
        const listed=await wsBackup.listAccounts();
        if(!Array.isArray(listed?.accounts)||!listed.accounts.length)throw new Error('WS 账号清单不可用，未生成不完整备份。');
        const accounts=[...listed.accounts],wsAccounts=Object.create(null),wsAccountMetadata=[],seenAccounts=new Set();
        if(!accounts.some(account=>String(account?.id||'').toLowerCase()==='default'))accounts.unshift({id:'default',displayName:'默认账号'});
        const wsRowLimits=[['settings',5000],['conversations',5000],['messages',100000],['analyses',20000],['replies',20000],['batches',20000],['collectionRuns',5000],['collectionItems',100000],['followupAlerts',20000]];
        for(const account of accounts){
          const accountId=String(account?.id||'').trim(),key=accountId.toLowerCase();
          if(!accountId||seenAccounts.has(key))throw new Error('WS 账号清单包含无效或重复账号，未生成备份。');
          seenAccounts.add(key);
          const data=await wsBackup.exportData(accountId);
          if(Number(data?.schemaVersion)!==6||wsRowLimits.some(([field,limit])=>!Array.isArray(data?.[field])||data[field].length>limit))throw new Error('WS 账号导出不完整或超过可恢复记录上限，未生成备份。');
          if(new TextEncoder().encode(JSON.stringify(data)).byteLength>48*1024*1024)throw new Error('单个 WS 账号超过 48 MB 可恢复上限，未生成无法恢复的完整备份。');
          wsAccounts[accountId]=data;
          const workspaceMode=account?.workspaceMode===undefined?'ordinary':account.workspaceMode;
          if(!['ordinary','dedicated'].includes(workspaceMode))throw new Error('WS 账号用途无效，未生成备份。');
          wsAccountMetadata.push({id:accountId,displayName:String(account?.displayName||accountId),workspaceMode,status:String(account?.status||'')});
        }
        const ws=wsAccounts.default||wsAccounts[accounts[0].id];
        const backupPayload={...workspace,backupFormat:'zhike-6-workspace',version:6,productVersion:'6.1.0',createdAt,summary:{customers:state.customers.length,tickets:state.tickets.length,deposits:state.deposits.length,followups:state.followups.length,registrations:state.registrations.length,phoneRegistry:state.phoneRegistry.length,batchOperations:state.batchOperations.length},ws,wsAccounts,wsAccountMetadata};
        const integrity={algorithm:'SHA-256',payloadSha256:await sha256Text(JSON.stringify(backupPayload))};
        const serialized=JSON.stringify({...backupPayload,integrity},null,2);
        if(new TextEncoder().encode(serialized).byteLength>250*1024*1024)throw new Error('完整备份文件超过 250 MB 可恢复上限，未生成无法恢复的备份。');
        download(`知客6.0完整备份_${today}.json`,serialized,'application/json');
        const previous=state.settings.lastBackupAt,previousActivities=state.activities.slice();
        state.settings.lastBackupAt=createdAt;
        activity('创建 6.0 完整数据备份（含 WS 工作台）');
        try{await flushStateWrites();}catch(error){
          if(previous===undefined)delete state.settings.lastBackupAt;else state.settings.lastBackupAt=previous;
          state.activities=previousActivities;persist();render();
          toast('备份下载已触发，但本机备份时间登记失败：'+(error.message||'请检查本机存储'),'x');return;
        }
        render();toast('6.0 完整备份已生成并写入 SHA-256 完整性信息');
      }catch(error){
        toast('完整备份未生成：'+(error.message||'本机数据暂不可读'),'x');
      }
    }
    else if(action==='soft-delete'&&customer){if(confirm(`将 ${customer.name} 移入回收站？客户资料仍可恢复。`))await setCustomerDeleted(id,true);}
    else if(action==='restore-customer'&&customer)await setCustomerDeleted(id,false);
    else if(action==='empty-recycle')await emptyRecycleWithSnapshot();
    else if(action==='export-registrations')exportRegistrations();
    else if(action==='export-filtered')exportCurrentView();else if(action==='export-status-history')exportStatusHistory();
    else if(action==='export-selected')exportCustomers(state.customers.filter(c=>state.selected.has(c.id)),'已选客户.csv');
    else if(action==='export-all')exportCustomers(activeCustomers(),'全部客户.csv');
    else if(action==='export-activity'){const csv=['操作内容,时间,来源',...state.activities.map(a=>[a.text,a.time,'本机工作台'].map(csvCell).join(','))].join('\r\n');download('操作记录.csv','\ufeff'+csv,'text/csv;charset=utf-8');}
    else if(action==='download-template')exportCustomers([],'客户导入模板.csv');
    else if(action==='import-csv'){const input=$('#importFile');if(input){input.multiple=true;input.click();}}else if(action==='import-backup')$('#backupFile')?.click();
    else if(action==='clear-intake'){if((state.intakeText||'').trim()&&!confirm('清空当前快速录入内容？未写入的内容将被移除。'))return;state.intakeText='';state.parsed=[];state.settings.intakeDraft={text:'',defaults:intakeDefaults()};state.settings.intakeDefaults=intakeDefaults();scheduleIntakeDraft();renderIntake();}
    else if(action==='organize-intake')organizeIntake();
    else if(action==='apply-intake-smart-defaults')applyIntakeSmartDefaults();
    else if(action==='save-intake')await saveIntakeWithSnapshot();
    else if(action==='close-modal')closeModal();
    else if(action==='quality-scan'){state.qualityView='overview';render();toast('本地数据检查完成');}
    else if(action==='quality-overview'){state.qualityView='overview';state.qualityShowReviewed=false;render();}
    else if(action==='quality-duplicates'){state.qualityView='duplicates';state.qualityShowReviewed=false;render();}
    else if(action==='quality-vip-duplicates'){state.qualityView='vip-duplicates';state.qualityShowReviewed=false;render();}
    else if(action==='quality-invalid'){state.qualityView='invalid';state.qualityShowReviewed=false;render();}
     else if(action==='historical-date-migration'){const candidates=historicalDateMigrationCandidates();if(!candidates.length){toast('没有发现需要迁移的历史日期');return;}openModal('历史日期字段迁移',`发现 ${candidates.length} 位客户的登记日期与下次跟进日期相同`,`<div class="notice-line">仅处理登记日期与下次跟进日期相同、且没有跟进记录的疑似旧数据。现有登记日期不会改变；迁移前会自动创建快照。</div><div class="timeline"><h3>处理方式</h3><p>清空下次跟进：适合无法确认原计划日期的旧数据。</p><p>改为登记日期次日：适合历史版本把登记日期误写到跟进字段的情况。</p></div>`,`<button class="btn" data-action="close-modal">取消</button><button class="btn" data-action="migrate-historical-dates" data-mode="clear">清空下次跟进</button><button class="btn primary" data-action="migrate-historical-dates" data-mode="next">改为登记日期次日</button>`);}
     else if(action==='migrate-historical-dates')await migrateHistoricalDates(el.dataset.mode||'clear');
    else if(action==='toggle-quality-reviewed'){state.qualityShowReviewed=!state.qualityShowReviewed;render();}
    else if(action==='review-quality'){
      const id=String(el.dataset.id),type=el.dataset.type,before=structuredClone(state.qualityDecisions||{}),beforeActivities=state.activities.slice();
      state.qualityDecisions[id]={...(state.qualityDecisions[id]||{}),[type]:true,updatedAt:new Date().toISOString()};
      activity(`复核客户号码：${state.customers.find(c=>String(c.id)===id)?.name||id}`);
      try{await flushStateWrites();render();toast('已标记复核，客户记录保持不变');}
      catch(error){state.qualityDecisions=before;state.activities=beforeActivities;persist();render();toast(error.message||'复核标记保存失败，已恢复','x');}
    }
    else if(action==='undo-quality-review'){
      const id=String(el.dataset.id),type=el.dataset.type;if(state.qualityDecisions[id]){
        const before=structuredClone(state.qualityDecisions||{}),beforeActivities=state.activities.slice();
        delete state.qualityDecisions[id][type];if(!Object.keys(state.qualityDecisions[id]).some(k=>k!=='updatedAt'))delete state.qualityDecisions[id];
        try{await flushStateWrites();render();toast('已撤销复核标记');}
        catch(error){state.qualityDecisions=before;state.activities=beforeActivities;persist();render();toast(error.message||'撤销复核保存失败，已恢复','x');}
      }
    }
    else if(action==='export-import-issues')exportImportIssues();
    else if(action==='restore-local-snapshot')await restoreLocalSnapshot(id);
    else if(action==='apply-assistant-suggestion')await applyAssistantSuggestions([String(id)]);
    else if(action==='apply-all-assistant-suggestions')await applyAssistantSuggestions();
    else if(action==='assistant-suggestion-page'){state.assistantSuggestionPage=Number(el.dataset.page)||1;render();}
    else if(action==='edit-import-issue'){const issue=state.importIssues.find(x=>String(x.id)===String(id));if(issue)importIssueModal(issue);}
    else if(action==='retry-import-issue')await retryImportIssueWithSnapshot(id);
    else if(action==='ignore-import-issue')await ignoreImportIssueWithSnapshot(id);
    else if(action==='restore-import-issue'){
      const issue=state.importIssues.find(x=>String(x.id)===String(id));if(issue){
        const before=structuredClone(issue),beforeActivities=state.activities.slice();
        issue.ignored=false;delete issue.ignoredAt;issue.resolved=false;delete issue.resolvedAt;delete issue.resolvedCustomerId;
        activity(`撤销导入行处理：${issue.file} 第 ${issue.row} 行`);
        try{await flushStateWrites();render();toast('已恢复为待复核');}
        catch(error){Object.assign(issue,before);state.activities=beforeActivities;persist();render();toast(error.message||'恢复导入记录失败，已恢复原状态','x');}
      }
    }
    else if(action==='show-import-customer'){const linked=state.customers.find(c=>String(c.id)===String(id));if(linked)showCustomer(linked);else toast('关联客户记录不存在');}
    else if(action==='clear-import-issues'){
      const processed=state.importIssues.filter(x=>x.resolved||x.ignored);
      if(!processed.length){toast('没有可清理的已处理记录');}
      else if(confirm(`清理 ${processed.length} 条已导入或已忽略的审计记录？未处理的待复核行不会被清除。`)){
        const before=state.importIssues.slice(),beforeActivities=state.activities.slice();
        state.importIssues=state.importIssues.filter(x=>!x.resolved&&!x.ignored);activity(`清理 ${processed.length} 条已处理的导入审计记录`);
        try{await flushStateWrites();render();toast('已处理记录已清理，待复核行仍保留');}
        catch(error){state.importIssues=before;state.activities=beforeActivities;persist();render();toast(error.message||'清理导入记录失败，已恢复','x');}
      }
    }
    else if(action==='unassigned'){state.segment={source:'全部',page:'全部',assistant:'未分配',status:'',phase:'',hot:'',ticket:'',deposit:'',follow:''};setView('segments');}
    else if(action==='missing-group'){state.search='';state.segment={source:'全部',page:'全部',assistant:'全部',status:'',phase:'',hot:'',ticket:'',deposit:'',follow:'',missingGroup:true};setView('segments');}
    else if(action==='group-filter'){state.search=el.dataset.group;state.segment={...segmentFilterDefaults(),source:el.dataset.source||'全部'};setView('segments');}
    else if(action==='new-vip')vipCustomerModal();
    else if(action==='confirm-new-vip')await setCustomerVip($('#vipCustomer')?.value,$('#vipNumber')?.value);
    else if(action==='clear-vip')await setCustomerVip(id,'');
    else if(action==='new-hot')hotCustomerModal();
    else if(action==='confirm-new-hot')await setCustomerHot($('#hotCustomer')?.value,true);
    else if(action==='toggle-hot')await setCustomerHot(id,!customer?.hot);
    else if(action==='toggle-favorite')await setCustomerFavorite(id,!customer?.favorite);
    else if(action==='toggle-field-lock')await setCustomerFieldLock(id,el.dataset.field);
    else if(action==='save-customer-qualification')await saveCustomerQualification(id);
    else if(action==='favorite-customers'){state.extraFilters={favorite:'true'};state.customerSearch='';setView('customers');}
    else if(action==='toast-settings')securitySettingsModal();
    else if(action==='edit-setting'&&el.dataset.setting==='安全与备份')securitySettingsModal();
    else if(action==='edit-setting'){const key=Object.entries(optionCatalog).find(([,item])=>item.label===el.dataset.setting)?.[0];if(key)optionListModal(key);}
    else if(action==='add-option')await addOption(el.dataset.optionKey);
    else if(action==='reset-options')await resetOptionList(el.dataset.optionKey);
    else if(action==='save-security-settings')await saveSecuritySettings();
    else if(action==='save-preferences'){const before={perPage:state.perPage,settings:structuredClone(state.settings),palette:window.ZhikeWorkspaceShell?.getPalette?.(),activities:state.activities.slice()};state.perPage=Number($('#defaultPerPage')?.value)||10;state.settings.defaultPerPage=state.perPage;state.settings.theme=$('#appearanceTheme')?.value||state.settings.theme||'light';state.settings.density=$('#appearanceDensity')?.value||state.settings.density||'comfortable';applyAppearance(state.settings.theme==='dark'?'horizon-night':'atelier-dawn');activity(`更新界面主题、密度与表格默认每页 ${state.perPage} 条`);try{await flushStateWrites();render();toast('界面与表格偏好已保存');}catch(error){state.perPage=before.perPage;state.settings=before.settings;state.activities=before.activities;applyAppearance(before.palette);persist();render();toast(error.message||'界面偏好保存失败，已恢复原设置','x');}}
    else if(action==='remove-import-file'){const index=Number(el.dataset.index),batches=state.pendingCsv?.batches||[],defaultSource=String(state.pendingCsv?.defaultSource||'');batches.splice(index,1);if(!batches.length){state.pendingCsv=null;closeModal();toast('已取消本次导入');return;}state.pendingCsv={...batches[0],batches,defaultSource};$('#modal .modal-body').innerHTML=csvSampleHtml();$('#modal .modal-header p').textContent=`${batches.length} 个 CSV 文件 · 共 ${batches.reduce((sum,batch)=>sum+batch.rows.length-1,0)} 行待预览`;}
    else if(action==='close-customer-drawer')closeCustomerDrawer();
    else if(action==='clear-all-data')clearAllDataModal();
    else if(action==='confirm-clear-all-data'){const password=$('#clearDataVerify')?.value||'';closeModal();await clearAllDataWithSnapshot(password);}
    else if(action==='columns')customerColumnsModal(el.dataset.mode||'customer');
    else if(action==='columns-reset'){$$('#modal [data-column-option]').forEach(input=>input.checked=true);}
    else if(action==='columns-apply'){
      const mode=el.dataset.mode==='segment'?'segment':'customer',before=structuredClone(state.settings.tableColumns||{}),beforeActivities=state.activities.slice(),selected=$$('#modal [data-column-option]:checked').map(input=>input.value);
      state.settings.tableColumns={...(state.settings.tableColumns||{}),[mode]:['select','customer',...selected,'actions']};activity(`更新${mode==='customer'?'客户中心':'分类视图'}表格列设置`);
      try{await flushStateWrites();closeModal();render();toast('表格列设置已保存');}
      catch(error){state.settings.tableColumns=before;state.activities=beforeActivities;persist();render();toast(error.message||'表格列设置保存失败，已恢复','x');}
    }
    else if(action==='choose-profile-avatar')$('#profileAvatarFile')?.click();
    else if(action==='remove-profile-avatar')await removeProfileAvatar();
    else if(action==='save-workspace-profile')await saveWorkspaceProfile();
    else if(action==='notifications')notificationModal();
    else toast('当前操作暂不可用，请刷新页面后重试。','x');
  }

  $('#mainNav').addEventListener('click',e=>{const item=e.target.closest('[data-view]');if(item){state.homeCustomerScope='';if(item.dataset.view==='automation')state.automationView='overview';setView(item.dataset.view);}});
  function filterRegistrationRows(){if(state.view!=='registrations')return;state.registrationSource=$('[data-registration-filter="source"]')?.value||'全部';state.registrationOwner=$('[data-registration-filter="owner"]')?.value||'全部';state.registrationSearch=$('[data-registration-search]')?.value||'';state.registrationPage=1;clearTimeout(registrationFilterTimer);registrationFilterTimer=setTimeout(()=>{if(state.view!=='registrations')return;const input=$('[data-registration-search]'),caret=input?.selectionStart;render();const next=$('[data-registration-search]');if(next){next.focus();if(caret!=null)next.setSelectionRange(Math.min(caret,next.value.length),Math.min(caret,next.value.length));}},140);}
  function filterActivityRows(){const query=($('[data-activity-search]')?.value||'').trim().toLocaleLowerCase();$$('[data-activity-row]').forEach(row=>{row.hidden=Boolean(query&&!row.textContent.toLocaleLowerCase().includes(query));});}
  document.addEventListener('change',e=>{if(e.target.matches('[data-registration-filter]'))filterRegistrationRows();});
  document.addEventListener('input',e=>{if(e.target.matches('[data-registration-search]'))filterRegistrationRows();if(e.target.matches('[data-activity-search]'))filterActivityRows();});
  const sidebar=$('#sidebar'), collapseButton=$('#collapseNav');
  const syncSidebar=()=>{sidebar.classList.toggle('collapsed',state.collapsed);sidebar.hidden=wsSidebarActive;sidebar.inert=wsSidebarActive;sidebar.setAttribute('aria-hidden',String(wsSidebarActive));document.body.classList.toggle('ws-workspace-active',wsSidebarActive);collapseButton.setAttribute('aria-expanded',String(!state.collapsed));collapseButton.setAttribute('aria-label',state.collapsed?'展开导航':'收起导航');collapseButton.title=state.collapsed?'展开导航':'收起导航';collapseButton.querySelector('use').setAttribute('href',state.collapsed?'#i-chevron-right':'#i-chevron-left');$$('.nav-item').forEach(item=>{const label=item.querySelector('span')?.textContent?.trim();if(label){item.title=label;item.setAttribute('aria-label',label);}});};
  const narrowSidebar=window.matchMedia('(max-width:1150px)');
  let narrowSidebarOverride=false,wideSidebarPreference=state.collapsed;
  let wsSidebarActive=false,wsSidebarPriorCollapsed=state.collapsed;
  const sidebarRoute=()=>document.documentElement.dataset.view||state.view;
  const adaptSidebar=()=>{
    if(sidebarRoute()==='ws-workbench'){
      if(!wsSidebarActive){wsSidebarPriorCollapsed=state.collapsed;wsSidebarActive=true;}
    }else if(wsSidebarActive){
      // The independent WS rail owns the entire workspace. Preserve the
      // original sidebar preference through automatic window maximization.
      state.collapsed=wsSidebarPriorCollapsed;wsSidebarActive=false;
    }else{
      if(narrowSidebar.matches){if(!narrowSidebarOverride)state.collapsed=true;}
      else{narrowSidebarOverride=false;state.collapsed=wideSidebarPreference;}
    }
    syncSidebar();
  };
  narrowSidebar.addEventListener('change',adaptSidebar);
  adaptSidebar();
  new MutationObserver(records=>{if(records.some(record=>record.attributeName==='data-view'))adaptSidebar();}).observe(document.documentElement,{attributes:true,attributeFilter:['data-view']});
  updateWorkspaceIdentity();
  $('#workspaceSwitch').addEventListener('click',workspaceProfileModal);
  $$('.profile-button,.top-avatar').forEach(button=>button.addEventListener('click',profileAvatarModal));
  collapseButton.addEventListener('click',()=>{if(wsSidebarActive)return;state.collapsed=!state.collapsed;if(narrowSidebar.matches)narrowSidebarOverride=true;else{wideSidebarPreference=state.collapsed;try{localStorage.setItem('zhike-sidebar-collapsed',String(state.collapsed));}catch{}}syncSidebar();});
  $('#backupButton').addEventListener('click',()=>void handleAction('backup',{}).catch(error=>toast(error.message||'备份操作失败','x')));
  $('#shortcutButton').addEventListener('click',shortcutHelpModal);
  $('#globalSearch').addEventListener('click',()=>globalSearchModal());
  let searchRenderTimer,moduleSearchTimer;
  $('#viewContainer').addEventListener('input',e=>{const input=e.target.closest('[data-search]');if(!input)return;const kind=input.dataset.search;if(kind==='segment')state.search=input.value;else if(kind==='customer')state.customerSearch=input.value;else if(kind==='group')state.groupQuery=input.value;else if(kind==='module'){
    if(state.view==='tickets'||state.view==='deposits'){
      state.businessSearch=input.value;const pos=input.selectionStart;clearTimeout(moduleSearchTimer);moduleSearchTimer=setTimeout(()=>{render();const next=$('[data-search="module"]');if(next){next.focus();next.setSelectionRange(Math.min(pos,next.value.length),Math.min(pos,next.value.length));}},140);
    }else filterRenderedTable(input);
    return;
  }state.page=1;const pos=input.selectionStart;clearTimeout(searchRenderTimer);searchRenderTimer=setTimeout(()=>{if(state.view!=(kind==='segment'?'segments':kind==='group'?'groups':'customers'))return;render();const next=$(`[data-search="${kind}"]`);if(next){next.focus();next.setSelectionRange(pos,pos);}},120);});
  $('#viewContainer').addEventListener('change',e=>{
    const t=e.target;
    if(state.view==='tickets'&&t.matches('[data-business-product-filter],[data-business-direction-filter]')){state.businessProductFilter=t.matches('[data-business-product-filter]')?t.value:state.businessProductFilter;state.businessDirectionFilter=t.matches('[data-business-direction-filter]')?t.value:state.businessDirectionFilter;state.page=1;render();return;}
    const parsedEdit=t.closest('[data-parsed-field]');if(parsedEdit){const row=state.parsed[Number(parsedEdit.dataset.parsedIndex)];if(row){const field=parsedEdit.dataset.parsedField;row[field]=parsedEdit.value.trim();if(field==='source')row.sourceExplicit=true;if(field==='page')row.pageExplicit=true;if(field==='status')row.statusExplicit=true;if(field==='rawPhone')row.phone=row.rawPhone.replace(/\D/g,'').replace(/^91(?=\d{10}$)/,'');if(field==='registered'||field==='due')row[field]=normalizeImportedDate(row[field]);if(field==='status')row.issues=row.issues.filter(issue=>issue!=='进群状态冲突');revalidateIntakeRows();}return;}
    if(t.matches('[data-filter-dim]')){state.segment[t.dataset.filterDim]=t.value;state.page=1;render();}
    if(t.matches('[data-extra-filter]')){state.extraFilters[t.dataset.extraFilter]=t.value;state.page=1;render();}
    if(t.matches('[data-select]')){if(t.checked)state.selected.add(t.dataset.select);else state.selected.delete(t.dataset.select);render();}
    if(t.matches('[data-select-page]')){const list=state.view==='customers'?filteredCustomers('customer'):filteredCustomers();list.slice((state.page-1)*state.perPage,state.page*state.perPage).forEach(c=>{const key=selectionKey(c.id);t.checked?state.selected.add(key):state.selected.delete(key);});render();}
     if(t.matches('.page-size')){
       const before={perPage:state.perPage,defaultPerPage:state.settings.defaultPerPage};
       state.perPage=Number(t.value);state.settings.defaultPerPage=state.perPage;persist();
       void flushStateWrites().then(()=>render()).catch(error=>{state.perPage=before.perPage;state.settings.defaultPerPage=before.defaultPerPage;persist();render();toast(error.message||'分页设置保存失败，已恢复','x');});
     }
    if(t.matches('[data-page-jump]')){const pageCount=Math.max(1,Math.ceil((state.view==='customers'?filteredCustomers('customer'):filteredCustomers()).length/state.perPage));state.page=Math.min(pageCount,Math.max(1,Number(t.value)||1));render();}
    if(t.matches('#ticketImportFile')){importTicketFile(t.files?.[0]);t.value='';}
    if(t.matches('#quickIntakeFile')){loadQuickIntakeFile(t.files?.[0]);t.value='';}
    if(t.matches('#importFile')){importCsvFiles(t.files);t.value='';}
    if(t.matches('#backupFile')){restoreBackupFile(t.files[0]);t.value='';}
  });
  $('#viewContainer').addEventListener('click',e=>{
    const groupSource=e.target.closest('[data-group-source]');if(groupSource){state.groupSource=groupSource.dataset.groupSource;state.page=1;render();return;}
    const followTab=e.target.closest('[data-follow-tab]');if(followTab){state.followTab=followTab.dataset.followTab;state.page=1;render();return;}
    const hotTab=e.target.closest('[data-hot-filter]');if(hotTab){state.hotFilter=hotTab.dataset.hotFilter;render();return;}
    const vipTab=e.target.closest('[data-vip-filter]');if(vipTab){state.vipFilter=vipTab.dataset.vipFilter;render();return;}
    const assistantPage=e.target.closest('[data-assistant-page]');if(assistantPage){state.assistantSuggestionPageFilter=assistantPage.value;state.assistantSuggestionPage=1;render();return;}
    if((state.view==='tickets'||state.view==='deposits')&&e.target.closest('[data-business-period]')){state.businessPeriod=e.target.closest('[data-business-period]').dataset.businessPeriod;render();return;}
    if((state.view==='tickets'||state.view==='deposits')&&e.target.closest('.subnav button')){const label=e.target.closest('.subnav button').textContent.trim();const records=state.view==='tickets'?state.tickets:state.deposits;if(label==='按助理'){const options=[...new Set(records.map(r=>r.assistant).filter(Boolean))];requestText('按助理筛选',options.length?`可选：${options.join('、')}`:'可输入任意助理名称',state.businessAssistant==='全部'?'':state.businessAssistant,{label:'助理名称',placeholder:'全部'}).then(value=>{if(value!==null){state.businessAssistant=value.trim()||'全部';render();}});return;}if(label==='按来源'){const options=[...new Set(records.map(r=>r.channel).filter(Boolean))];requestText('按来源筛选',options.length?`可选：${options.join('、')}`:'可输入任意来源渠道',state.businessChannel==='全部'?'':state.businessChannel,{label:'来源渠道',placeholder:'全部'}).then(value=>{if(value!==null){state.businessChannel=value.trim()||'全部';render();}});return;}}
    const summary=e.target.closest('[data-summary]');if(summary?.dataset.summary){const [key,val]=summary.dataset.summary.split(':');state.segmentCard=state.segmentCard===summary.dataset.summary?'':summary.dataset.summary;if(key==='status')state.segment.status=val==='joined'?'已进群（含在群）':val==='not'?'未进群':'退群（含临时）';else if(key==='hot')state.segment.hot=state.segment.hot?'':'是';else if(key==='vip')state.segment.vip=state.segment.vip?'':'有';else if(key==='ticket')state.segment.ticket=state.segment.ticket?'':'有';else if(key==='deposit')state.segment.deposit=state.segment.deposit?'':'有';else if(key==='follow')state.segment.follow=state.segment.follow?'':'逾期';state.page=1;render();return;}
    const set=e.target.closest('[data-set]');if(set){const key=set.dataset.set,val=set.dataset.value;if(key==='source'){state.segment.source=val;state.segment.page='全部';}else state.segment[key]=val;state.page=1;render();return;}
    const chip=e.target.closest('[data-clear-filter]');if(chip){const k=chip.dataset.clearFilter;if(state.view==='customers')delete state.extraFilters[k];else if(k==='source')state.segment.source='全部';else if(k==='page')state.segment.page='全部';else if(k==='assistant')state.segment.assistant='全部';else state.segment[k]='';render();return;}
    const saved=e.target.closest('[data-saved-view]');if(saved){applySavedView(saved.dataset.savedView);return;}
    const page=e.target.closest('[data-page]');if(page){state.page=Number(page.dataset.page);render();return;}
    const analytic=e.target.closest('[data-analytics-filter]');if(analytic){const [key,...rest]=analytic.dataset.analyticsFilter.split(':');const val=rest.join(':');state.segment={...segmentFilterDefaults()};if(key==='source')state.segment.source=val;if(key==='hot')state.segment.hot=val==='true'?'是':'否';if(key==='vip')state.segment.vip=val==='true'?'有':'无';if(key==='ticket')state.segment.ticket=val==='true'?'有':'无';if(key==='deposit')state.segment.deposit=val==='true'?'有':'无';if(key==='follow')state.segment.follow='逾期';if(key==='assistant')state.segment.assistant=val;if(key==='group')state.search='';setView('segments');return;}
    const sourceFilter=e.target.closest('[data-source]');if(sourceFilter){state.extraFilters={source:sourceFilter.dataset.source};setView('customers');state.extraFilters={source:sourceFilter.dataset.source};render();return;}
     const toggle=e.target.closest('[data-toggle]');if(toggle){const previous=state.settings.autoInitialFollow;state.settings.autoInitialFollow=state.settings.autoInitialFollow===false;persist();void flushStateWrites().then(()=>{renderIntake();toast(`首次跟进任务已${state.settings.autoInitialFollow?'启用':'暂停'}`);}).catch(error=>{state.settings.autoInitialFollow=previous;persist();renderIntake();toast(error.message||'首次跟进设置保存失败，已恢复','x');});return;}
     const rule=e.target.closest('[data-rule]');if(rule){const key=rule.dataset.rule;const labels={autoInitialFollow:'快速录入后创建次日跟进',staleHotReminder:'热聊未跟进提醒',assistantSuggestions:'助理分配建议'};if(!labels[key]){toast('该项属于固定运行规则');return;}const previous=state.settings[key];const enabled=state.settings[key]===false;state.settings[key]=enabled;activity(`${enabled?'启用':'暂停'}本地自动化：${labels[key]}`);void flushStateWrites().then(()=>{render();toast(`${labels[key]}已${enabled?'启用':'暂停'}`);}).catch(error=>{state.settings[key]=previous;persist();render();toast(error.message||'自动化设置保存失败，已恢复','x');});return;}
    const act=e.target.closest('[data-action]');if(act){void handleAction(act.dataset.action,act).catch(error=>toast(error.message||'操作失败，请重试','x'));return;}
    const customerButton=e.target.closest('button[data-customer]');
    const row=customerButton||(!e.target.closest('button,input')&&e.target.closest('[data-customer]'));
    if(row){
      const customer=state.customers.find(c=>sameId(c.id,row.dataset.customer));
      if(!customer&&customerButton)return;
      updateCustomerPreview(customer);
      showCustomer(customer);
    }
  });
  $('#modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')closeModal();});
  $('#modal').addEventListener('click',e=>{const edit=e.target.closest('[data-option-edit]');if(edit){renameOption(edit.dataset.optionEdit,edit.dataset.optionValue);return;}const remove=e.target.closest('[data-option-remove]');if(remove){removeOption(remove.dataset.optionRemove,remove.dataset.optionValue);return;}const act=e.target.closest('[data-action]');if(act)void handleAction(act.dataset.action,act).catch(error=>toast(error.message||'操作失败，请重试','x'));});
  document.addEventListener('paste',e=>{const textarea=e.target.closest?.('#intakeText');if(!textarea)return;const clip=e.clipboardData?.getData('text');if(!clip)return;e.preventDefault();e.stopImmediatePropagation();const start=textarea.selectionStart,end=textarea.selectionEnd,cleaned=normalizeIntakePaste(clip),before=textarea.value.slice(0,start),after=textarea.value.slice(end),prefix=before&&!before.endsWith('\n')?'\n':'',suffix=after&&!after.startsWith('\n')?'\n':'',insert=`${prefix}${cleaned}${suffix}${cleaned.endsWith('\n')?'':'\n'}`;textarea.setRangeText(insert,start,end,'end');state.intakeText=textarea.value.replace(/\n{3,}/g,'\n\n');parseIntakeLines(state.intakeText);scheduleIntakeDraft();const caret=Math.min(textarea.selectionStart,state.intakeText.length),scrollTop=textarea.scrollTop;renderIntake();const next=$('#intakeText');next?.focus();next?.setSelectionRange(caret,caret);if(next)next.scrollTop=scrollTop;toast(`已自动清洗并整理 ${cleaned.split('\n').filter(Boolean).length} 行粘贴内容`);},true);
  document.addEventListener('click',e=>{const drawer=e.target.closest('#customerDrawer');if(!drawer)return;const act=e.target.closest('[data-action]');if(act)void handleAction(act.dataset.action,act).catch(error=>toast(error.message||'操作失败，请重试','x'));});
  let globalSearchTimer;
  $('#modal').addEventListener('input',e=>{if(!e.target.matches('#globalSearchInput'))return;const query=e.target.value;clearTimeout(globalSearchTimer);globalSearchTimer=setTimeout(()=>{const input=$('#globalSearchInput'),results=$('#globalSearchResults');if(input&&results&&input.value===query)results.innerHTML=globalSearchResultsHtml(query);},180);});
  $('#notificationButton').addEventListener('click',()=>void handleAction('notifications',{}).catch(error=>toast(error.message||'提醒加载失败','x')));
  $('#modal').addEventListener('input',e=>{const picker=e.target.closest('[data-customer-picker]');if(picker)syncCustomerPicker(picker);});
  $('#modal').addEventListener('change',e=>{if(e.target.matches('[data-customer-picker]'))syncCustomerPicker(e.target);if(e.target.matches('#profileAvatarFile')){saveProfileAvatar(e.target.files?.[0]);return;}const defaultSource=e.target.closest('[data-csv-default-source]');if(defaultSource&&state.pendingCsv){state.pendingCsv.defaultSource=String(defaultSource.value||'').trim();$('#modal .modal-body').innerHTML=csvSampleHtml();return;}const select=e.target.closest('[data-csv-field]');if(!select||!state.pendingCsv)return;const key=select.dataset.csvField;const index=select.value===''?null:Number(select.value);if(index!==null)for(const [other,value] of Object.entries(state.pendingCsv.mapping))if(other!==key&&value===index)delete state.pendingCsv.mapping[other];if(index===null)delete state.pendingCsv.mapping[key];else state.pendingCsv.mapping[key]=index;if(window.ZhikeSmartImport?.rememberMappingProfile)state.settings.importProfiles=window.ZhikeSmartImport.rememberMappingProfile(state.settings.importProfiles,state.pendingCsv.headers,state.pendingCsv.mapping);$('#modal .modal-body').innerHTML=csvSampleHtml();});
  window.__flushLocalWrites=async(options={})=>{const draftPending=Boolean(intakeDraftTimer);clearTimeout(intakeDraftTimer);if(draftPending||state.view==='intake'){state.settings.intakeDefaults=state.view==='intake'?currentIntakeDefaults():state.settings.intakeDefaults||{};state.settings.intakeDraft={text:state.intakeText,defaults:state.settings.intakeDefaults};persist();}await flushStateWrites();if(options.snapshot===false||!window.__LOCAL_DB__||state.settings.autoCloseSnapshot===false)return;const response=await fetch('/api/snapshot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'桌面应用关闭自动快照'})});if(!response.ok)throw new Error('关闭前自动快照失败');};
  window.addEventListener('pagehide',()=>{if(!window.__LOCAL_DB__)return;if(window.__DESKTOP_APP__){void window.__flushLocalWrites?.({snapshot:false}).catch(()=>{});return;}const data=pendingStateData||{customers:state.customers,savedViews:state.savedViews,activities:state.activities,tickets:state.tickets,deposits:state.deposits,followups:state.followups,registrations:state.registrations,batchOperations:state.batchOperations,phoneRegistry:state.phoneRegistry,settings:state.settings,channelAliases:state.channelAliases,importIssues:state.importIssues,qualityDecisions:state.qualityDecisions};const body=JSON.stringify(data);if(new Blob([body]).size<=60*1024){void fetch('/api/state',{method:'PUT',keepalive:true,headers:{'Content-Type':'application/json','X-State-Version':stateVersion},body}).catch(()=>{});}});
  window.addEventListener('keydown',e=>{const key=e.key.toLowerCase(),typing=Boolean(e.target.closest?.('input,textarea,select,[contenteditable="true"]'));if(e.key==='Escape'){closeModal();closeCustomerDrawer();return;}if(state.view==='intake'&&(e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();void saveIntakeWithSnapshot().catch(error=>toast(error.message||'快速录入保存失败，请重试','x'));return;}if(typing)return;if((e.ctrlKey||e.metaKey)&&key==='k'){e.preventDefault();$('#globalSearch').click();}else if((e.ctrlKey||e.metaKey)&&key==='n'){e.preventDefault();newCustomerModal();}else if((e.ctrlKey||e.metaKey)&&e.shiftKey&&key==='i'){e.preventDefault();setView('intake');}else if((e.ctrlKey||e.metaKey)&&e.shiftKey&&key==='b'){e.preventDefault();void handleAction('backup',{}).catch(error=>toast(error.message||'备份操作失败','x'));}});
  async function initializeBackend(){
    const metricsRead=beginMetricsRead();let metricsOutcome='discarded';
    if(!window.__LOCAL_DB__){
      initialBackendReadPending=false;
      completeMetricsRead(metricsRead,'error','LOCAL_SOURCE_UNAVAILABLE');
      render();markSyncVersion();return;
    }
    try{
      const response=await fetch('/api/state');if(!response.ok)throw new Error('读取本机数据库失败');
      const storedState=await response.json();stateVersion=String(storedState.version||'');
      if(storedState.initialized){applySharedData(storedState);lastCommittedState=cloneStateData(statePayload());}
      else{persist();await flushStateWrites();}
      metricsOutcome='applied';
    }catch(error){metricsOutcome='error';dbWriteFailure=error;markSyncVersion();toast(error.message||'本机数据库连接失败','x');}
    finally{initialBackendReadPending=false;completeMetricsRead(metricsRead,metricsOutcome);}
    render();markSyncVersion(stateVersion);
  }
  async function refreshSharedState(){if(!window.__LOCAL_DB__)return false;if(syncBusy||destructiveWriteBusy||pendingStateData||writeConflict||queuedWriteCount)return null;const metricsRead=beginMetricsRead();let metricsOutcome='discarded';try{const revisionAtStart=localDataRevision,versionAtStart=stateVersion;const response=await fetch('/api/state',{cache:'no-store'});if(!response.ok)throw new Error('读取本机数据库失败');const storedState=await response.json();if(syncBusy||destructiveWriteBusy||localDataRevision!==revisionAtStart||stateVersion!==versionAtStart||pendingStateData||writeConflict||queuedWriteCount)return null;const incomingVersion=String(storedState.version||'');if(incomingVersion&&incomingVersion===stateVersion){metricsOutcome='checked';syncReadFailure=null;markSyncVersion(incomingVersion);return true;}if(storedState.initialized){applySharedData(storedState);metricsOutcome='applied';lastCommittedState=cloneStateData(statePayload());stateVersion=String(incomingVersion||stateVersion);syncReadFailure=null;markSyncVersion(stateVersion);/* Background WS AI/CRM sync already updates its own stable panel. Re-rendering the whole shell here resizes WebView2 and causes periodic foreground jitter. */if(state.view!=='ws-workbench')render();}else if(incomingVersion){metricsOutcome='checked';markSyncVersion(incomingVersion);}return true;}catch(error){metricsOutcome='error';throw error;}finally{completeMetricsRead(metricsRead,metricsOutcome);}}
  async function followupAction(payload){
    await flushStateWrites();
    const response=await fetch('/api/ws/followup-action',{method:'POST',headers:{'Content-Type':'application/json','X-State-Version':stateVersion},body:JSON.stringify(payload)});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'跟进操作保存失败');
    await refreshSharedState();
    window.dispatchEvent(new CustomEvent('zhike:followups-changed'));
    return result;
  }
  window.__zhikeRegistryHost={state,persist,render,activity,toast,openModal,closeModal,requestText,icons,esc,download,csvCell,snapshotBeforeWrite,flushStateWrites,refreshState:refreshSharedState,getStateVersion:()=>stateVersion,getMetricsProjection,showCustomer,followupAction,restoreFollowupView:()=>setView('followups')};
  document.addEventListener('click',event=>{if(event.target.closest('[data-action="retry-home-ai"]'))scheduleHomeWsFollowups({immediate:true});const button=event.target.closest('[data-action="go-operations"][data-task-id]');if(button){state.opsTaskQuery=button.dataset.taskId||'';state.opsTaskFilter='all';state.opsTaskBucket='';state.opsTaskOwner='';window.ZhikeOperationsUI?.render?.(true);}},true);
  window.addEventListener('zhike:followups-changed',()=>{if(state.view==='home')scheduleHomeWsFollowups();else if(state.view==='operations')window.ZhikeOperationsUI?.render?.(true);});
  window.__refreshSharedState=refreshSharedState;
  setInterval(()=>{const currentDate=localDateKey();if(currentDate!==today){today=currentDate;render();}},60000);
  // initialization is started after the connection-aware overrides below
  const legacySyncFromBackend=syncFromBackend;
  syncFromBackend=async function(force=false){
    const previousWriteFailure=dbWriteFailure;
    const result=await legacySyncFromBackend(force);
    if(result===false&&dbWriteFailure&&dbWriteFailure!==previousWriteFailure&&!pendingStateData&&!queuedWriteCount&&!writeConflict){
      syncReadFailure=dbWriteFailure;
      dbWriteFailure=previousWriteFailure||null;
    }else if(result===true&&!dbWriteFailure)syncReadFailure=null;
    markSyncVersion();
    return result;
  };

  // Replace the compact legacy writer after all declarations are loaded. The
  // wrapper keeps the existing queue semantics but preserves server-side
  // validation/authentication messages instead of reporting every failure as
  // a generic local database error.
  enqueueStateWrite = async function(data){
    queuedWriteCount++;
    dbWritePromise=dbWritePromise.catch(()=>{}).then(async()=>{
      const expectedVersion=stateVersion;
      let wire=stateWriteBody(data);
      let response=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json','X-State-Version':expectedVersion,...wire.headers},body:wire.body});
      if(response.status===409){
        const latestResponse=await fetch('/api/state',{cache:'no-store'});
        if(!latestResponse.ok)throw await stateWriteError(latestResponse,'读取共享数据失败');
        const latest=await latestResponse.json();
        const result=mergeConcurrentState(lastCommittedState||{},data,latest);
        if(result.conflicts.length){writeConflict={local:data,latest,conflicts:result.conflicts};throw new Error('检测到其他窗口同时修改了相同记录');}
        applySharedData(result.merged);data=statePayload();stateVersion=String(latest.version||'');wire={headers:{},body:JSON.stringify(data)};
        response=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json','X-State-Version':stateVersion},body:wire.body});
        if(!response.ok)throw await stateWriteError(response,'合并写入失败');
        render();toast('已自动合并其他窗口的独立修改');
      }
      if(!response.ok)throw await stateWriteError(response,'写入失败');
      const result=await response.json().catch(()=>({}));
      lastCommittedState=cloneStateData(data);writeConflict=null;syncReadFailure=null;markSyncVersion(result.version);dbWriteWarned=false;dbWriteFailure=null;
    }).catch(error=>{
      if(!writeConflict&&data)pendingStateData=pendingStateData||data;
      dbWriteFailure=error;
      if(!dbWriteWarned){
        const detail=String(error?.message||'').trim();
        const message=writeConflict?'同一记录在其他窗口也有修改，请处理冲突':detail&&detail!=='写入失败'?detail:'本机数据库暂不可写，请稍后检查数据目录';
        toast(message,'x');dbWriteWarned=true;
      }
      markSyncVersion();
    }).finally(()=>{queuedWriteCount--;});
    return dbWritePromise;
  };
  const legacyInitializeBackend=initializeBackend;
  initializeBackend=async function(){
    const previousWriteFailure=dbWriteFailure;
    await legacyInitializeBackend();
    if(dbWriteFailure&&dbWriteFailure!==previousWriteFailure&&!pendingStateData&&!queuedWriteCount&&!writeConflict){
      syncReadFailure=dbWriteFailure;
      dbWriteFailure=previousWriteFailure||null;
      markSyncVersion();
    }
  };
  // Keep the detailed hot-chat summary available from the existing customer
  // drawer without changing the original customer rendering rules.
  const baseShowCustomer = showCustomer;
  showCustomer = function(customer){
    baseShowCustomer(customer);
    if(!customer?.hot)return;
    const drawer=document.querySelector('#customerDrawer');
    const actions=drawer?.querySelector('.customer-360-actions');
    if(actions&&!drawer.querySelector('.customer-hot-profile-summary'))actions.insertAdjacentHTML('beforebegin',renderCustomerHotProfileSummary(customer));
  };
  if(window.__zhikeRegistryHost)window.__zhikeRegistryHost.showCustomer=showCustomer;
  initializeBackend();
  startDataSync();
  $('#syncStatus')?.addEventListener('click',async()=>{
    if(!syncReadFailure||dbWriteFailure||writeConflict)return;
    syncReadFailure=null;
    markSyncVersion();
    await syncFromBackend(true);
    if(syncReadFailure)toast('共享数据同步仍未恢复，请稍后重试','x');else toast('共享数据同步已恢复');
  });
})();
