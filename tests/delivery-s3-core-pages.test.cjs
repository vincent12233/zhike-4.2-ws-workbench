'use strict';
// Synthetic controlled DOM/services, executing actual shipped UI functions and
// event registrations. No application bootstrap, backend, production data or WS.
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../resources/app/app.js'),'utf8');
function between(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,'Production boundary '+start);return source.slice(a,b);}
class ClassList{constructor(){this.values=new Set();}add(...x){x.forEach(v=>this.values.add(v));}remove(...x){x.forEach(v=>this.values.delete(v));}contains(x){return this.values.has(x);}toggle(x,force){const next=force??!this.contains(x);next?this.add(x):this.remove(x);return next;}}
class Node{constructor(tag='div'){this.tagName=tag.toUpperCase();this.dataset={};this.classList=new ClassList();this.handlers=new Map();this.innerHTML='';this.children=[];this.focusCount=0;}addEventListener(name,handler){this.handlers.set(name,handler);}focus(){this.focusCount++;}insertAdjacentHTML(_,html){this.innerHTML+=html;}appendChild(node){this.children.push(node);}querySelector(){return null;}querySelectorAll(){return [];}}
function makeFixture(){
 const view=new Node(),toggle=new Node('button'),overview=new Node('details'),overviewLabel=new Node('span'),nodes=new Map([['viewContainer',view],['crumbCurrent',new Node()]]),events=[],toasts=[],downloads=[],followCalls=[],editCalls=[];
 const preview={outerHTML:''},visibleCustomerRows=[];
 overview.open=false;overview.querySelector=selector=>selector==='[data-overview-toggle-label]'?overviewLabel:null;
 const document={body:new Node('body'),documentElement:{dataset:{}},createElement:tag=>new Node(tag),querySelector:selector=>selector==='#customerDrawer'?nodes.get('customerDrawer')||null:null,querySelectorAll:()=>[],dispatchEvent:event=>{events.push(event);return true;}};
 document.body.appendChild=node=>{nodes.set(node.id,node);document.body.children.push(node);};
 const rows=Array.from({length:15},(_,index)=>({id:'CORE_'+index,name:index<2?'同名客户':'隔离客户 '+index,rawPhone:'+91 '+(9000000000+index),phone:String(9000000000+index),source:index<12?'单导':'群粉',channel:index<12?'单导':'群粉',phase:index<2||index%2===0?'意向客户':'新客户',assistant:'隔离助理',status:'在群',group:'合成组',registered:'2026-11-17',due:index%3?'2026-11-17':'2026-11-16',qualification:'B级｜中等'}));rows.push({...rows[0],id:'DELETED',deleted:true});
 const state={view:'customers',customers:rows,selected:new Set(),page:1,perPage:5,settings:{},segment:{source:'全部',page:'全部',assistant:'全部'},extraFilters:{},customerSearch:'',search:'',showFilters:source.match(/\bshowFilters:\s*(true|false)\b/)[1]==='true',followTab:'done',followups:[{id:'CF',customerId:'CORE_1',date:'2026-11-15T10:20',method:'文字',result:'合成跟进结果',nextDate:'2026-11-19'}],activities:[],registrations:[],tickets:[],deposits:[]};
 const context={state,document,window:{},console,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},today:'2026-11-17',qualifications:['B级｜中等'],sources:['单导','群粉'],assistants:['隔离助理'],pages:['合成页面'],statuses:['在群','未进群'],phases:['新客户','意向客户'],homeDetailExpanded:false,
  $:selector=>selector==='#viewContainer'?view:selector==='#viewContainer .customer6-focus'&&!state.customerPreviewCollapsed?preview:selector.includes('.customer-business-overview')?overview:selector==='#crumbCurrent'?nodes.get('crumbCurrent'):selector.includes('toggle-customer-preview')?toggle:selector==='#viewContainer .page-heading'?new Node():null,$$:selector=>selector==='#viewContainer tr[data-customer]'?visibleCustomerRows:[],
  selectionKey:id=>String(id??''),sameId:(a,b)=>String(a??'')===String(b??''),esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),icons:name=>`<svg data-icon="${name}"></svg>`,
  activeCustomers:()=>state.customers.filter(c=>!c.deleted),customersByPriority:()=>state.customers.filter(c=>!c.deleted),effectiveCustomerSource:c=>c.source,isGroupFanSource:value=>value==='群粉',businessSummaryIndex:()=>({}),customerBusinessSummary:c=>({ticket:Boolean(c.ticket),deposit:Boolean(c.deposit),amount:Number(c.amount)||0}),crmProfile:c=>({grade:'B',score:50,sla:'今日到期',stage:c.phase||'新线索',followCount:1,nextAction:'按计划跟进'}),
  counts:()=>({total:state.customers.filter(c=>!c.deleted).length,favorite:0,ticket:0,deposit:0,joined:15,hot:0,vip:0,due:10,overdue:5}),duplicateCustomerPlan:()=>({duplicates:[]}),money:n=>'¥'+Number(n||0).toLocaleString('zh-CN'),isValidDateKey:value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value)),localDateOffset:()=> '2026-11-24',
  customerCompletenessHtml:c=>`<div data-completeness-for="${String(c.id)}"></div>`,customerFieldLockHtml:c=>`<div data-field-locks-for="${String(c.id)}"></div>`,loadCustomerGovernancePanel:async()=>{},groupMembershipRows:c=>`<div data-group-for="${String(c.id)}"></div>`,customerTimeline:c=>`<div data-timeline-for="${String(c.id)}"></div>`,statusTag:s=>`<span>${String(s||'')}</span>`,phaseTag:s=>`<span>${String(s||'')}</span>`,sourceTag:s=>`<span>${String(s||'')}</span>`,
  renderSavedViews:()=>'<div data-existing-saved-views></div>',renderActiveChips:()=>'<div data-existing-active-chips></div>',csvCell:value=>'"'+String(value??'').replace(/"/g,'""')+'"',download:(name,content,type)=>downloads.push({name,content,type}),toast:message=>toasts.push(message),
  followModal:customer=>followCalls.push(customer.id),editCustomerModal:customer=>editCalls.push(customer.id),closeModal(){},persist(){throw new Error('UI-only action must not persist');},flushStateWrites:async()=>{throw new Error('UI-only action must not write');},
 };
 context.render=()=>{context.renderCount++;if(state.view==='customers')context.renderCustomers();else if(state.view==='followups')context.renderFollowups();};context.renderCount=0;
 context.isValidDateKey=vm.runInNewContext('('+between('  const isValidDateKey=','  let today =').trim().replace(/^const isValidDateKey=/,'').replace(/;$/,'')+')');
 vm.createContext(context);
 vm.runInContext(between('  const selectionKey =','  const assistants =')+';this.makeSelectionSet=values=>new SelectionSet(values);',context);state.selected=context.makeSelectionSet();
 const functions=between('  const navNames =','  const customerColumnDefs=')+between('  function setView(','  const heading =')+between('  const heading =','  function governanceHeading(')
  +between('  const btn =','  const metric =')
  +between('  const customerColumnDefs=','  function normalizedViewFilters(')
  +between('  function filteredCustomers(','  function renderSegmentTabs(')
  +between('  function customerAvatarHtml(','  function segmentTitle(')
  +between('  function renderCustomerFilters(','  function renderSegments(')
  +between('  function customerIdentityHtml(','  function normalizeIntakePaste(')
  +between('  function renderFollowups(','  function daysSinceFollow(')
  +between('  function closeCustomerDrawer(','  function editCustomerModal(')
  +between('  function exportCustomers(','  function exportHotCustomers(')
  +between('  function exportCurrentView(','  const csvFields=')
  +between('  async function handleAction(','  $(\'#mainNav\').addEventListener(');
 vm.runInContext(functions,context);
 vm.runInContext(between("  $('#viewContainer').addEventListener('change',", "  $('#viewContainer').addEventListener('click',"),context);
 vm.runInContext(between("  $('#viewContainer').addEventListener('click',", "  $('#modalBackdrop').addEventListener("),context);
 return {state,context,view,toggle,overview,overviewLabel,nodes,events,toasts,downloads,followCalls,editCalls,preview,visibleCustomerRows};
}
async function verifyDrawerIdentity(){
 const f=makeFixture(),a=f.state.customers[0],b=f.state.customers[1];assert.equal(a.name,b.name);assert.equal(f.nodes.has('customerDrawer'),false);
 f.context.showCustomer(a);let drawer=f.nodes.get('customerDrawer');assert.ok(drawer);assert.equal(drawer.dataset.customerId,a.id);assert.equal(drawer.classList.contains('open'),true);assert.match(drawer.innerHTML,/data-id="CORE_0"/);assert.equal(f.events.at(-1).type,'zhike:customer-drawer-opened');assert.equal(f.events.at(-1).detail.customerId,a.id);assert.deepEqual(Object.keys(f.events.at(-1).detail),['customerId'],'UI lifecycle exposes only identity');
 f.context.showCustomer(a);assert.equal(f.events.length,2,'same-ID redraw still signals the existing enhancement');assert.equal(f.nodes.get('customerDrawer'),drawer,'one lazily created drawer is reused');
 f.context.showCustomer(b);assert.equal(drawer.dataset.customerId,b.id);assert.match(drawer.innerHTML,/data-id="CORE_1"/);assert.equal(f.events.at(-1).detail.customerId,b.id);
 await f.context.handleAction('follow',{dataset:{id:b.id}});assert.deepEqual(f.followCalls,[b.id],'same-name customer is resolved by trusted ID');assert.equal(drawer.classList.contains('open'),false);assert.equal('customerId' in drawer.dataset,false,'closing invalidates late identity-based responses');
 f.context.showCustomer(a);await f.context.handleAction('close-customer-drawer',{dataset:{}});assert.equal('customerId' in drawer.dataset,false);f.context.showCustomer({name:'无ID'});assert.equal(drawer.classList.contains('open'),false);assert.equal('customerId' in drawer.dataset,false);
 f.context.showCustomer({...a,id:0});assert.equal(drawer.dataset.customerId,'0','numeric zero is a valid original identity');f.context.closeCustomerDrawer();
 console.log('S3 drawer: first lazy creation, same-ID redraw, same-name A→B, close/invalid ID and lifecycle payload passed');
}
function change(f,target){f.view.handlers.get('change')({target:{dataset:{},closest:()=>null,matches:()=>false,...target}});}
async function verifyCustomerPreviewSelection(){
 const f=makeFixture(),first=f.state.customers[0],second=f.state.customers[1];
 const makeRow=customer=>{
  const row=new Node('tr'),button=new Node('button');
  row.dataset.customer=button.dataset.customer=customer.id;
  button.attributes=new Map();
  button.setAttribute=(name,value)=>button.attributes.set(name,value);
  button.removeAttribute=name=>button.attributes.delete(name);
  row.querySelector=selector=>selector==='button[data-customer]'?button:null;
  return {row,button};
 };
 const a=makeRow(first),b=makeRow(second);
 f.visibleCustomerRows.push(a.row,b.row);
 f.context.window.ZhikeAvatar={render:({size})=>`<span class="zk-avatar zk-avatar--${size}"></span>`};
 f.context.renderCustomers();
 assert.match(f.view.innerHTML,/<button type="button" class="customer-name-open"[^>]*>\s*<span class="zk-avatar zk-avatar--table"><\/span>\s*<span class="customer-name-copy">/);
 assert.equal(a.row.classList.contains('customer6-preview-selected'),true);
 assert.equal(a.button.attributes.get('aria-current'),'true');
 const click=f.view.handlers.get('click');
 click({target:{closest:selector=>selector==='button[data-customer]'?b.button:null}});
 assert.equal(f.nodes.get('customerDrawer').dataset.customerId,second.id);
 assert.equal(f.state.customerPreviewId,second.id,'the real customer-name button selects by CRM identity even when names match');
 assert.match(f.preview.outerHTML,/9000000001/);
 assert.equal(a.row.classList.contains('customer6-preview-selected'),false);
 assert.equal(a.button.attributes.has('aria-current'),false);
 assert.equal(b.row.classList.contains('customer6-preview-selected'),true);
 assert.equal(b.button.attributes.get('aria-current'),'true');

 f.state.page=2;
 const other=makeRow(f.state.customers[5]);
 f.visibleCustomerRows.splice(0,2,other.row);
 f.context.renderCustomers();
 assert.match(f.view.innerHTML,/<aside id="customerCenterPreview"[\s\S]*本页首位客户[\s\S]*9000000005/);
 assert.equal(other.button.attributes.get('aria-current'),'true','preview resolves to a visible customer after paging');
 assert.equal(f.state.customerPreviewId,second.id,'paging away is reversible');
 f.state.page=1;
 f.visibleCustomerRows.splice(0,1,a.row,b.row);
 f.context.renderCustomers();
 assert.match(f.view.innerHTML,/<aside id="customerCenterPreview"[\s\S]*当前选中客户[\s\S]*9000000001/);
 assert.equal(b.button.attributes.get('aria-current'),'true');
 console.log('S3 customers: name-button identity, row highlight and page-local 360 preview stay synchronized');
}
async function verifyCustomerScopes(){
 const f=makeFixture();f.state.extraFilters={source:'单导',phase:'意向客户'};f.state.customerSearch='同名';assert.deepEqual(Array.from(f.context.filteredCustomers('customer'),c=>c.id),['CORE_0','CORE_1'],'actual search+source+phase chain preserves ID rows');
 f.state.customerSearch='';f.state.extraFilters={source:'单导'};f.state.page=2;f.state.selected.add('CORE_0');f.state.selected.add('CORE_14');f.context.renderCustomers();assert.match(f.view.innerHTML,/当前筛选 12 位客户/);assert.match(f.view.innerHTML,/筛选内 1 位，筛选外 1 位/);assert.match(f.view.innerHTML,/导出筛选结果包含全部匹配页/);assert.match(f.view.innerHTML,/data-action="export-filtered"/);assert.match(f.view.innerHTML,/data-search="customer"/);assert.match(f.view.innerHTML,/data-select-page/);
 f.context.exportCurrentView();assert.equal(f.downloads.length,1);const csv=f.downloads[0].content;assert.equal(csv.trim().split('\r\n').length,13,'export includes twelve filtered customers across all three pages');assert.match(csv,/9000000000/);assert.match(csv,/9000000011/);assert.doesNotMatch(csv,/9000000014/);
 change(f,{checked:true,matches:s=>s==='[data-select-page]'});assert.equal(f.state.selected.size,7,'existing page checkbox adds only current five rows and retains off-page selection');assert.equal(f.state.selected.has('CORE_14'),true);change(f,{checked:false,matches:s=>s==='[data-select-page]'});assert.deepEqual([...f.state.selected].sort(),['CORE_0','CORE_14']);
 f.state.settings.tableColumns={customer:['source']};f.context.renderCustomers();assert.match(f.view.innerHTML,/<th data-column="phone" hidden/);f.context.exportCurrentView();assert.match(f.downloads.at(-1).content,/标准号码/,'hidden columns do not narrow existing CSV fields');
 await f.context.handleAction('export-selected',{dataset:{}});assert.match(f.downloads.at(-1).content,/9000000000/);assert.match(f.downloads.at(-1).content,/9000000014/,'selected export preserves explicit off-filter selection');
 const beforeIds=f.context.filteredCustomers('customer').map(c=>c.id).join(',');await f.context.handleAction('toggle-customer-preview',{dataset:{}});assert.equal(f.state.customerPreviewCollapsed,true);assert.match(f.view.innerHTML,/is-preview-collapsed/);assert.doesNotMatch(f.view.innerHTML,/<aside id="customerCenterPreview"/);assert.match(f.view.innerHTML,/<div id="customerCenterPreview" hidden/,'collapsed aria-controls retains its hidden empty target without customer data');assert.match(f.view.innerHTML,/aria-expanded="false"/);assert.ok(f.toggle.focusCount>0);assert.equal(f.context.filteredCustomers('customer').map(c=>c.id).join(','),beforeIds);
 await f.context.handleAction('toggle-customer-preview',{dataset:{}});assert.equal(f.state.customerPreviewCollapsed,false);assert.match(f.view.innerHTML,/<aside id="customerCenterPreview"/);assert.match(f.view.innerHTML,/aria-expanded="true"/);f.state.view='ws-workbench';const count=f.context.renderCount;await f.context.handleAction('toggle-customer-preview',{dataset:{}});assert.equal(f.context.renderCount,count,'main CRM preview action cannot affect WS layout');
 console.log('S3 customers: real filters/export, page selection, hidden columns and UI-only preview close/restore passed');
}
async function verifyCustomerListFirstLayout(){
 const f=makeFixture();f.context.renderCustomers();const details=f.view.innerHTML.match(/<details class="customer-business-overview"[^>]*>/)?.[0];assert.ok(details,'all seven original metrics are in one native expandable overview');assert.doesNotMatch(details,/\sopen(?:\s|>)/,'overview is closed for the first customer-list view');assert.equal((f.view.innerHTML.match(/class="customer6-metric /g)||[]).length,7,'no business metric is deleted');assert.match(f.view.innerHTML,/全局 15 位 · 今日计划 10 位 · 逾期 5 位/);assert.equal(f.state.showFilters,false,'production initial customer filters are collapsed');assert.doesNotMatch(f.view.innerHTML,/class="quick-filters"/);assert.match(f.view.innerHTML,/<div id="customerAdvancedFilters" hidden/);assert.match(f.view.innerHTML,/data-action="toggle-filters"[^>]*aria-expanded="false"/);
 f.state.extraFilters={source:'单导',phase:'意向客户'};f.state.customerSearch='同名';f.context.renderCustomers();const before=JSON.stringify({filters:f.state.extraFilters,search:f.state.customerSearch,ids:f.context.filteredCustomers('customer').map(c=>c.id)});assert.match(f.view.innerHTML,/生效条件 3 项/,'known advanced filters plus the search are explicit');assert.match(f.view.innerHTML,/筛选（2）/,'button shows the actual active advanced dimensions');assert.match(f.view.innerHTML,/当前筛选 2 位客户/);
 triggerClick(f,'[data-action]',{dataset:{action:'toggle-filters'}});await Promise.resolve();assert.equal(f.state.showFilters,true);assert.match(f.view.innerHTML,/id="customerAdvancedFilters" class="quick-filters"/);assert.match(f.view.innerHTML,/data-extra-filter="source"/);assert.match(f.view.innerHTML,/data-extra-filter="phase"/);assert.equal(JSON.stringify({filters:f.state.extraFilters,search:f.state.customerSearch,ids:f.context.filteredCustomers('customer').map(c=>c.id)}),before,'opening advanced controls cannot reset effective filters/search');
 f.overview.open=true;f.overview.handlers.get('toggle')({currentTarget:f.overview});assert.equal(f.state.customerOverviewExpanded,true);assert.equal(f.overviewLabel.textContent,'收起指标');triggerClick(f,'[data-action]',{dataset:{action:'toggle-filters'}});await Promise.resolve();assert.equal(f.state.showFilters,false);assert.match(f.view.innerHTML,/<details class="customer-business-overview" open>/,'explicitly opened overview state survives a list refresh');assert.equal(JSON.stringify({filters:f.state.extraFilters,search:f.state.customerSearch,ids:f.context.filteredCustomers('customer').map(c=>c.id)}),before,'closing controls retains all predicates');f.context.exportCurrentView();assert.equal(f.downloads.at(-1).content.trim().split('\r\n').length,3,'folded controls still export the exact filtered collection');
 f.overview.open=false;f.overview.handlers.get('toggle')({currentTarget:f.overview});assert.equal(f.state.customerOverviewExpanded,false);assert.equal(f.overviewLabel.textContent,'展开7项指标');const oldHandler=f.overview.handlers.get('toggle'),originalQuery=f.context.$;f.overview.open=true;f.context.$=selector=>selector.includes('.customer-business-overview')?new Node('details'):originalQuery(selector);oldHandler({currentTarget:f.overview});assert.equal(f.state.customerOverviewExpanded,false,'late toggle from a replaced overview cannot overwrite current UI state');f.context.$=originalQuery;for(const action of ['go-data','new-customer','deduplicate-customers','toggle-customer-preview','export-filtered','columns'])assert.ok(f.view.innerHTML.includes(`data-action="${action}"`),'original customer action remains reachable: '+action);console.log('S3 list-first customer layout: native closed overview retains seven metrics; default filters fold without losing search/active predicates/export');
}
async function verifySelectionSetIdentity(){const f=makeFixture();const numeric={...f.state.customers[0],id:0,name:'数值ID客户'};f.state.customers.push(numeric);f.state.selected.add(0);assert.equal(f.state.selected.has('0'),true);await f.context.handleAction('export-selected',{dataset:{}});assert.match(f.downloads.at(-1).content,/数值ID客户/,'actual SelectionSet normalizes numeric IDs through the unchanged export path');f.state.selected.delete('0');assert.equal(f.state.selected.has(0),false);console.log('S3 selection identity: real SelectionSet add/has/delete and numeric-ID export retained');}
function verifyFollowupLabels(){const f=makeFixture();f.state.view='followups';f.context.renderFollowups();assert.match(f.view.innerHTML,/<h1 class="page-title">客户跟进<\/h1>/);assert.match(f.view.innerHTML,/<th>下次跟进<\/th>/);assert.doesNotMatch(f.view.innerHTML,/<th>登记日期<\/th>/);assert.match(f.view.innerHTML,/2026-11-19/);assert.match(f.view.innerHTML,/data-customer="CORE_1"/);assert.match(f.view.innerHTML,/data-action="export-filtered"/);assert.match(f.view.innerHTML,/已登记的跟进记录/);console.log('S3 followups: original route/data/record export retained; nextDate header and customer-vs-task scope are explicit');}
function verifyHomeHierarchy(){
 const f=makeFixture();f.state.view='home';const n=f.context.counts(),daily={singleJoined:0,singleLeft:0,groupJoined:0,groupLeft:0};let reminderReads=0;
 const prepared={n,list:f.context.activeCustomers(),daily,business:{},monday:'2026-11-16',registeredIds:new Set(),weekRegistrations:0,weekAmount:0,allDue:f.context.activeCustomers(),overdue:[],planned:f.context.activeCustomers(),rows:[],pendingRegistered:0,high:0,profileGaps:0,max:15,funnel:[['客户总数',15],['已进群',15],['热聊客户',0],['已报名',0],['入金客户',0]],horizonKpis:[['今日进群',0],['本周报名',0],['本周入金','¥0'],['今日待跟进',15],['高价值待安排',0],['档案待补齐',0]].map(([label,value])=>({label,value}))};
 const projection={scope:{label:'全局客户主档与既有业务记录'},sourceState:{status:'loaded',hasLastGood:true,lastLoadedAt:'2026-11-17T04:00:00.000Z',pendingLocalWrite:false,writeConflict:false},series:{sevenDayActivity:[]},seriesStatus:{sevenDayActivity:'empty'},seriesBasis:{sevenDayActivity:{notes:['登记客户与跟进记录分别统计']}}};
 Object.assign(f.context,{prepareHomeMetrics:()=>prepared,getMetricsProjection:()=>projection,homeTaskFilter:'all',renderStatusSummary:()=>'<p data-original-status-summary></p>',loadHomeWsFollowups:()=>{reminderReads++;},horizonProcessHtml:()=>'<div data-original-ai-process></div>',horizonSpotlightHtml:()=>'<div data-original-ai-spotlight></div>',horizonNodeHtml:()=>'',window:{ZhikeMetricsCharts:require('../resources/app/modules/metrics-charts.js')}});
 vm.runInContext(between('  const metric =','  function statusEventKind(')+between('  function renderHorizonHero(','  function ensureHomeWsFollowupPanel(')+between('  function homeMetricDisplay(','  function filteredCustomers('),f.context);
 f.context.renderHome();assert.match(f.view.innerHTML,/home-dashboard-grid home-dashboard-primary/);assert.match(f.view.innerHTML,/home-trend-panel/);assert.match(f.view.innerHTML,/home-activity-panel is-empty/);assert.match(f.view.innerHTML,/data-activity-state="empty"/);const banner=f.view.innerHTML.slice(0,f.view.innerHTML.indexOf('</section>'));
 assert.match(banner,/<p class="digital-horizon-reading" role="status">范围：全局客户主档与既有业务记录 · 本机业务数据 · 本机业务读取时间：<time datetime="2026-11-17T04:00:00.000Z">[^<]+<\/time><\/p>/,'source, scope and successful read time are in the brand banner before KPIs');
 assert.doesNotMatch(f.view.innerHTML,/class="muted-cell home-reading-context"/,'successful reads use only the inline banner status');assert.equal((f.view.innerHTML.match(/本机业务数据/g)||[]).length,1,'normal read provenance is not repeated in six KPI footers');
 for(const action of ['go-followups','go-quality','go-groups','go-registrations','go-activity'])assert.ok(f.view.innerHTML.includes(`data-action="${action}"`),'existing home action remains reachable: '+action);
 assert.match(f.view.innerHTML,/data-home-task-filter="today"/);assert.match(f.view.innerHTML,/周一至今日 · 含待确认/);assert.match(f.view.innerHTML,/客户计划概况/);assert.equal(reminderReads,1,'home render retains its one existing AI reminder load');
 projection.sourceState.status='loading';projection.sourceState.hasLastGood=false;projection.seriesStatus.sevenDayActivity='loading';f.context.renderHome();assert.match(f.view.innerHTML,/data-activity-state="loading"/);assert.match(f.view.innerHTML,/数据未确认/);assert.doesNotMatch(f.view.innerHTML,/data-activity-state="empty"/,'unread source is not a confirmed empty business history');assert.equal(reminderReads,2);
 assert.doesNotMatch(f.view.innerHTML,/class="digital-horizon-reading"/);
 assert.match(f.view.innerHTML,/<\/svg><\/section><p class="muted-cell home-reading-context" role="status">范围：全局客户主档与既有业务记录 · 加载中 · 数据未确认[\s\S]*?尚未确认的数值显示为—，不等同于零。可通过顶部同步状态重试。<\/p><section class="horizon-workbench-hero"/);
 projection.sourceState.status='error';projection.sourceState.hasLastGood=true;projection.sourceState.writeConflict=true;
 f.context.renderHome();
 assert.doesNotMatch(f.view.innerHTML,/class="digital-horizon-reading"/);
 assert.match(f.view.innerHTML,/<p class="muted-cell home-reading-context" role="status">范围：全局客户主档与既有业务记录 · 读取失败 · 指标暂不可用 · 存在保存冲突 · 本机业务读取时间：<time datetime="2026-11-17T04:00:00.000Z">[^<]+<\/time>。业务列表保留；指标不将本地待保存变更冒充已确认读取。可通过顶部同步状态重试。<\/p>/);
 assert.match(f.view.innerHTML,/<span class="horizon-kpi-heading">今日进群<\/span><strong>—<\/strong>/);
 assert.equal(reminderReads,3);
 projection.sourceState.status='loaded';projection.sourceState.writeConflict=false;projection.sourceState.pendingLocalWrite=true;
 f.context.renderHome();assert.match(f.view.innerHTML,/<p class="digital-horizon-reading" role="status">[^<]*本机业务数据 · 保存中 · 本机业务读取时间：/);assert.equal(reminderReads,4);
 console.log('S3 home: source-first hierarchy, wide-trend/compact-empty hooks, original actions and one reminder load retained');
}
async function verifyHomeFollowupDrilldown(){
 const f=makeFixture();f.state.view='home';f.state.customers[13].due='2026-11-20';f.state.customers[14].due='—';f.state.page=3;f.state.perPage=50;
 const stamp=new Date(2026,10,17,12).getTime();class FixedDate extends Date{constructor(...args){super(...(args.length?args:[stamp]));}static now(){return stamp;}}
 Object.assign(f.context,{Date:FixedDate,localDataRevision:0,stateVersion:'core-synthetic-read',homeTaskFilter:'all',horizonProcessHtml:()=>'',horizonSpotlightHtml:()=>'',horizonNodeHtml:()=>'',renderStatusSummary:()=>'',loadHomeWsFollowups(){},window:{ZhikeMetricsCharts:require('../resources/app/modules/metrics-charts.js')}});
 f.context.counts=()=>({total:15,joined:15,ticket:0,deposit:0,hot:0,vip:0,due:8,overdue:5});
 vm.runInContext(between('  const money =','  function backupHealth(')+between('  function smartPriority(','  function updateCounts(')+between('  function todayStatusCounts(','  function currentSourceStatusCounts(')+between('  let homeMetricsCache=','  function getMetricsProjection(')+between('  function renderHorizonHero(','  function ensureHomeWsFollowupPanel(')+between('  const metric =','  function statusEventKind(')+between('  function homeMetricDisplay(','  function filteredCustomers('),f.context);
 f.context.getMetricsProjection=()=>({scope:{label:'全局客户主档与既有业务记录'},sourceState:{status:'loaded',hasLastGood:true,lastLoadedAt:'2026-11-17T04:00:00Z'},series:{sevenDayActivity:f.context.prepareHomeMetrics().sevenDayActivity},seriesStatus:{sevenDayActivity:'available'},seriesBasis:{sevenDayActivity:{notes:['合成隔离夹具']}}});
 f.context.renderHome();const entries=[...f.view.innerHTML.matchAll(/<button\b[^>]*data-action="go-followups"[^>]*>/g)].map(match=>match[0]);assert.equal(entries.length,3,'all three actual home go-followups buttons are enumerated, not invented');
 const expectedIds=Array.from(f.context.prepareHomeMetrics().allDue,c=>String(c.id)).sort();assert.equal(expectedIds.length,13);
 for(const entry of entries){
  f.state.view='home';f.state.followTab='done';f.state.extraFilters={source:'不存在渠道',phase:'不存在阶段'};f.state.customerSearch='旧搜索无匹配';f.state.homeCustomerScope='high-value';f.state.selected.add('CORE_0');f.state.page=3;
  const action=entry.match(/data-action="([^"]+)"/)[1];const actualButton={dataset:{action}};f.view.handlers.get('click')({target:{closest:selector=>selector==='[data-action]'?actualButton:null}});await Promise.resolve();
  assert.equal(f.state.view,'followups','home pending-client action must enter existing plan route');assert.equal(f.state.followTab,'open');assert.equal(f.state.page,1);assert.equal(f.state.selected.size,0);
  assert.equal(f.context.document.documentElement.dataset.view,'followups');assert.equal(f.nodes.get('crumbCurrent').textContent,'客户跟进');assert.match(f.view.innerHTML,/<h1 class="page-title">客户跟进<\/h1>/);assert.match(f.view.innerHTML,/客户数，非任务数/);
  const ids=[...f.view.innerHTML.matchAll(/<tr data-customer="([^"]+)"/g)].map(match=>match[1]).sort();assert.deepEqual(ids,expectedIds,'plan IDs exactly equal actual home allDue despite stale customer filters/search');
  f.context.exportCurrentView();const csv=f.downloads.at(-1);assert.equal(csv.name,'跟进待处理.csv');assert.equal(csv.content.trim().split('\r\n').length,14);assert.doesNotMatch(csv.content,/9000000013|9000000014/,'future and unplanned customers stay outside open export');assert.match(csv.content,/9000000000/);
  f.state.followTab='done';f.context.renderFollowups();assert.match(f.view.innerHTML,/合成跟进结果/);f.context.exportCurrentView();assert.equal(f.downloads.at(-1).name,'已完成跟进.csv');assert.match(f.downloads.at(-1).content,/2026-11-19/);assert.equal(f.downloads.at(-1).content.trim().split('\r\n').length,2,'completed exports independent original event records');
 }
 const hostDeclaration=source.split('\n').find(line=>line.trimStart().startsWith('window.__zhikeRegistryHost='));assert.ok(hostDeclaration&&hostDeclaration.includes('restoreFollowupView'),'actual host declaration contains only the narrow restore hook');
 for(const name of ['activity','openModal','requestText','snapshotBeforeWrite','refreshSharedState','followupAction'])if(!f.context[name])f.context[name]=()=>{throw new Error('Route restoration must not call '+name);};
 vm.runInContext(hostDeclaration,f.context);
 const beforeBusiness=JSON.stringify({customers:f.state.customers,followups:f.state.followups,extraFilters:f.state.extraFilters,customerSearch:f.state.customerSearch});
 for(const tab of ['open','done']){f.state.view='ws-workbench';f.state.followTab=tab;f.context.window.__zhikeRegistryHost.restoreFollowupView('arbitrary-route');assert.equal(f.state.view,'followups','narrow host hook always reuses original setView for the existing route');assert.equal(f.state.followTab,tab,'restoration preserves active plan/history tab');assert.equal(f.context.document.documentElement.dataset.view,'followups');assert.equal(f.nodes.get('crumbCurrent').textContent,'客户跟进');}
 assert.equal(JSON.stringify({customers:f.state.customers,followups:f.state.followups,extraFilters:f.state.extraFilters,customerSearch:f.state.customerSearch}),beforeBusiness,'route restoration does not alter CRM, records or stored filters/search');
 const overdueIds=Array.from(f.context.prepareHomeMetrics().overdue,c=>String(c.id)).sort();await f.context.handleAction('home-overdue',{dataset:{}});assert.equal(f.state.view,'customers');assert.equal(f.state.homeCustomerScope,'overdue');assert.deepEqual(Array.from(f.context.filteredCustomers('customer'),c=>String(c.id)).sort(),overdueIds,'dedicated home overdue suggestion retains its original narrower customer scope');
 console.log('S3 home plan drilldown: every actual home button → existing open route, exact 13 IDs, stale filters ignored, title/route, open/completed exports retained');
}
function triggerClick(f,selector,node){f.view.handlers.get('click')({target:{closest:query=>query===selector?node:null}});}
function rowIds(html){return [...html.matchAll(/<tr data-customer="([^"]+)"/g)].map(match=>match[1]);}
function verifyPlanDateExportParity(){
 const f=makeFixture(),base=f.state.customers[0];f.state.view='followups';f.state.followTab='open';f.state.perPage=50;const dates=[['PREVIOUS','2026-11-16'],['TODAY','2026-11-17'],['FUTURE','2026-11-18'],['LEAP_VALID','2024-02-29'],['INVALID','2026-02-31'],['BAD_MONTH','2026-13-01'],['STAMP','2026-11-16T10:00'],['DASH','—'],['EMPTY','']];f.state.customers=dates.map(([id,due],index)=>({...base,id,name:'日期隔离 '+id,due,phone:String(9003000000+index),rawPhone:String(9003000000+index)}));const before=JSON.stringify(f.state.customers);f.context.renderFollowups();assert.deepEqual(rowIds(f.view.innerHTML).sort(),['LEAP_VALID','PREVIOUS','TODAY']);f.context.exportCurrentView();const csv=f.downloads.at(-1).content;assert.equal(csv.trim().split('\r\n').length,4,'open export must contain the same three valid plan dates as the existing list');for(const id of ['INVALID','BAD_MONTH','STAMP','DASH','EMPTY','FUTURE'])assert.ok(!csv.includes('日期隔离 '+id),'invalid/unplanned/future plan is not exported as open: '+id);assert.equal(JSON.stringify(f.state.customers),before,'bad dates remain in original records for governance, not erased');console.log('S3 plan date parity: previous/today/leap valid, future/dash/empty/malformed excluded without mutating records');
}
async function verifyFollowupPaginationAndExport(){
 const f=makeFixture(),base=f.state.customers[0];f.state.view='followups';f.state.followTab='open';f.state.perPage=50;
 const valid=Array.from({length:263},(_,index)=>({...base,id:'PAGE_'+index,name:'分页隔离客户 '+index,phone:String(9001000000+index),rawPhone:String(9001000000+index),due:index%3?'2026-11-17':'2026-11-16'}));
 const special=[{id:'FUTURE',due:'2026-11-18'},{id:'EMPTY',due:''},{id:'DASH',due:'—'},{id:'INVALID',due:'2026-02-31'},{id:'STAMP',due:'2026-11-17T08:00'},{id:'DELETED_PLAN',due:'2026-11-17',deleted:true}].map((row,index)=>({...base,name:'特殊隔离 '+row.id,phone:String(9002000000+index),rawPhone:String(9002000000+index),...row}));
 f.state.customers=[...valid,...special];const originalBusiness=JSON.stringify({customers:f.state.customers,followups:f.state.followups});const sorted=[...valid].sort((a,b)=>a.due.localeCompare(b.due)).map(c=>c.id),seen=[];
 for(let page=1;page<=6;page++){triggerClick(f,'[data-page]',{dataset:{page:String(page)}});assert.equal(f.state.page,page);const ids=rowIds(f.view.innerHTML);assert.deepEqual(ids,sorted.slice((page-1)*50,page*50),`existing followups route page ${page} is reachable without truncating later records`);seen.push(...ids);assert.ok(ids.length<=50,'DOM window follows existing perPage');}
 assert.deepEqual(seen,sorted,'all 263 valid planned customers are reachable exactly once');assert.match(f.view.innerHTML,/显示 251–263 条，共 263 位客户/);assert.match(f.view.innerHTML,/6 \/ 6/);assert.match(f.view.innerHTML,/data-action="export-filtered"/);
 triggerClick(f,'[data-page]',{dataset:{page:'999'}});assert.equal(f.state.page,6);assert.deepEqual(rowIds(f.view.innerHTML),sorted.slice(250));f.state.page=-10;f.context.renderFollowups();assert.equal(f.state.page,1);f.state.page=NaN;f.context.renderFollowups();assert.equal(f.state.page,1);
 f.state.page=6;triggerClick(f,'[data-follow-tab]',{dataset:{followTab:'today'}});assert.equal(f.state.page,1,'switching plan tab starts at its first page');assert.equal(f.state.followTab,'today');assert.ok(rowIds(f.view.innerHTML).every(id=>valid.find(c=>c.id===id)?.due==='2026-11-17'));
 triggerClick(f,'[data-follow-tab]',{dataset:{followTab:'done'}});assert.equal(f.state.page,1);assert.match(f.view.innerHTML,/合成跟进结果/);triggerClick(f,'[data-follow-tab]',{dataset:{followTab:'open'}});assert.equal(f.state.page,1);
 f.context.exportCurrentView();const exported=f.downloads.at(-1);assert.equal(exported.name,'跟进待处理.csv');assert.equal(exported.content.trim().split('\r\n').length,264,'export remains the full valid open collection regardless of current page');for(const bad of ['特殊隔离 FUTURE','特殊隔离 INVALID','特殊隔离 STAMP','特殊隔离 EMPTY','特殊隔离 DASH','特殊隔离 DELETED_PLAN'])assert.ok(!exported.content.includes(bad),'open export follows the same valid-date predicate: '+bad);assert.match(exported.content,/分页隔离客户 262/,'tail customers are not silently omitted');
 f.state.followTab='none';f.context.renderFollowups();assert.deepEqual(rowIds(f.view.innerHTML).sort(),['DASH','EMPTY']);f.context.exportCurrentView();assert.equal(f.downloads.at(-1).content.trim().split('\r\n').length,3,'unplanned export retains only the existing empty/dash rule');
 f.state.followTab='done';f.state.followups[0].nextDate='2026-02-31';f.context.renderFollowups();f.context.exportCurrentView();assert.match(f.downloads.at(-1).content,/2026-02-31/,'historical completed records are preserved, not filtered by plan-date validation');f.state.followups[0].nextDate='2026-11-19';assert.equal(JSON.stringify({customers:f.state.customers,followups:f.state.followups}),originalBusiness,'pagination/export never edits or removes business records');
 // The already-approved narrow restore uses the original setView reset.
 f.context.stateVersion='synthetic';f.context.getMetricsProjection=()=>({});for(const name of ['activity','openModal','requestText','snapshotBeforeWrite','refreshSharedState','followupAction'])if(!f.context[name])f.context[name]=()=>{throw new Error('UI restore must not call '+name);};vm.runInContext(source.split('\n').find(line=>line.trimStart().startsWith('window.__zhikeRegistryHost=')),f.context);f.state.view='ws-workbench';f.state.followTab='open';f.state.page=6;f.context.window.__zhikeRegistryHost.restoreFollowupView();assert.equal(f.state.page,1);assert.deepEqual(rowIds(f.view.innerHTML),sorted.slice(0,50));
 let preferenceWrites=0;f.context.persist=()=>{preferenceWrites++;};f.context.flushStateWrites=async()=>{};f.state.page=6;change(f,{value:'100',matches:selector=>selector==='.page-size'});await Promise.resolve();await Promise.resolve();assert.equal(f.state.perPage,100);assert.equal(f.state.settings.defaultPerPage,100);assert.equal(preferenceWrites,1,'page size reuses the existing preference persistence path');assert.equal(f.state.page,3);assert.deepEqual(rowIds(f.view.innerHTML),sorted.slice(200),'perPage change keeps the bounded final page reachable');
 f.state.page=999;f.state.followTab='done';f.context.renderFollowups();assert.equal(f.state.page,1);f.state.page=-20;f.context.renderFollowups();assert.equal(f.state.page,1,'completed history also clamps negative page indices');
 const savedCustomers=f.state.customers;f.state.customers=[];f.state.followTab='open';f.state.page=999;f.context.renderFollowups();assert.equal(f.state.page,1);assert.deepEqual(rowIds(f.view.innerHTML),[]);assert.match(f.view.innerHTML,/显示 0–0 条，共 0 位客户/);f.state.customers=savedCustomers;
 f.state.page=7;assert.equal(rowIds(f.context.simpleCustomerTable(valid,'vip')).length,100,'VIP renderer retains its original separate scope');assert.equal(f.state.page,7,'follow pagination cannot mutate another simple-table kind');assert.equal(rowIds(f.context.simpleCustomerTable(valid,'hot')).length,100,'hot renderer is unchanged by follow pagination');
 console.log('S3 followup paging/export: 263 customers all reachable, last page/bounds/tab/reset, valid-date parity, unplanned and completed history retained');
}
function prepareCustomerWrite(fields){
 const f=makeFixture(),customer=f.state.customers[0],lookup=f.context.$;
 const writes=[],savedPayloads=[],snapshots=[];
 f.state.qualityDecisions={[customer.id]:{invalid:true}};
 Object.assign(f.context,{
  $:selector=>Object.hasOwn(fields,selector)?{value:fields[selector]}:lookup(selector),
  localDateKey:()=>f.context.today,
  snapshotBeforeWrite:async reason=>{snapshots.push(reason);return true;},
  persist:()=>writes.push(structuredClone(customer)),
  flushStateWrites:async()=>savedPayloads.push(structuredClone(customer)),
 });
 vm.runInContext(
  between('  const linkedPhone=', '  function customerPhoneKeys(')+
  between('  function advanceCrm(', '  function smartFollowDays(')+
  between('  function statusEventKind(', '  function customerHasStatusEvent(')+
  between('  function activity(', '  function setView(')+
  between('  function restoreCustomerFields(', '  async function setCustomerDeleted('),
  f.context
 );
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../resources/app/modules/smart-import.js'),'utf8'),f.context);
 const action=name=>f.context.handleAction(name,{dataset:{id:customer.id}});
 return {...f,customer,action,writes,savedPayloads,snapshots};
}
async function verifyCustomerWriteBoundaries(){
 const fields={
  '#editName':'更新姓名','#editPhone':'+91 9000100000','#editSource':'单导','#editPage':'测试页面',
  '#editAssistant':'隔离助理','#editStatus':'已进群','#editPhase':'新客户','#editQualification':'B级｜中等',
  '#editVipNumber':' reserved-vip ','#editGroup':'测试群','#editNote':'手工备注',
 };
 const f=prepareCustomerWrite(fields);
 Object.assign(f.customer,{status:'未进群',manualLockedFields:['aiSummary'],aiSummary:'原人工摘要'});
 f.state.customers[1].vipNumber='RESERVED-VIP';
 const before=structuredClone(f.customer),review=structuredClone(f.state.qualityDecisions);
 await f.action('save-customer');
 assert.deepEqual(f.customer,before,'a duplicate VIP must leave the entire customer record untouched');
 assert.deepEqual(f.state.qualityDecisions,review);
 assert.deepEqual(f.writes,[]);
 assert.deepEqual(f.snapshots,[]);
 assert.match(f.toasts.at(-1),/VIP 编号已属于其他客户/);

 fields['#editVipNumber']='valid-vip';
 f.context.flushStateWrites=async()=>{throw new Error('synthetic save failure');};
 await f.action('save-customer');
 assert.deepEqual(f.customer,before,'rejected storage write restores fields that were introduced by the attempted edit');
 assert.deepEqual(f.writes.at(-1),before,'rollback persistence cannot include a false group event or phone alias');
 assert.deepEqual(f.state.qualityDecisions,review);
 assert.equal(f.state.activities.length,0);

 f.context.flushStateWrites=async()=>f.savedPayloads.push(structuredClone(f.customer));
 let release;
 const hold=new Promise(resolve=>{release=resolve;});
 const completedSnapshots=f.snapshots.length;
 f.context.snapshotBeforeWrite=reason=>{f.snapshots.push(reason);return hold;};
 const saving=f.action('save-customer');
 fields['#editName']='等待期间的输入改动';
 await f.action('save-customer');
 assert.equal(f.snapshots.length,completedSnapshots+1,'repeated saves cannot start another snapshot during the first submission');
 release(true);
 await saving;
 assert.equal(f.savedPayloads.at(-1).name,'更新姓名','the submitted draft is stable while waiting for a snapshot');
 assert.equal(f.customer.vipNumber,'valid-vip');
 assert.deepEqual([...f.customer.legacyPhones],[before.phone]);
 assert.equal(f.customer.statusHistory.length,1);
 assert.equal(f.customer.statusHistory[0].type,'joined');
 assert.equal(f.customer.phase,'意向客户','normal stage promotion stays wired');
 assert.equal(f.customer.aiSummary,'原人工摘要');
 assert.deepEqual(f.customer.manualLockedFields,['aiSummary']);
 assert.equal(f.state.activities.length,1);
 console.log('S3 customer save: duplicate VIP never mutates data, failed writes restore it exactly, and a valid retry keeps normal history');
}
async function verifyFollowupWriteDates(){
 const fields={
  '#followDate':'2026-11-12T10:20','#nextFollow':'2026-11-21','#followNote':'历史跟进',
  '#followRegistration':'已报名','#followMethod':'电话',
 };
 const f=prepareCustomerWrite(fields);
 f.customer.phase='新客户';
 const before=structuredClone(f.customer),previousFollowups=f.state.followups.slice();
 const flush=f.context.flushStateWrites;
 f.context.flushStateWrites=async()=>{throw new Error('synthetic follow-up save failure');};
 await f.action('save-follow');
 assert.deepEqual(f.customer,before,'failed follow-up save restores customer fields exactly');
 assert.deepEqual(f.state.followups,previousFollowups);
 assert.equal(f.state.registrations.length,0);
 assert.equal(f.state.activities.length,0);
 f.context.flushStateWrites=flush;
 await f.action('save-follow');
 assert.equal(f.savedPayloads.at(-1).lastFollow,'2026-11-12','saved customer date matches the backdated follow-up');
 assert.equal(f.customer.due,'2026-11-21');
 assert.equal(f.customer.phase,'潜在客户');
 assert.equal(f.state.followups[0].date,fields['#followDate']);
 assert.equal(f.state.registrations[0].followupId,f.state.followups[0].id);

 fields['#followDate']='2026-11-10T15:25';
 fields['#followRegistration']='';
 await f.action('save-follow');
 assert.equal(f.savedPayloads.at(-1).lastFollow,'2026-11-12','adding an older entry keeps the latest known follow-up date');
 assert.equal(f.state.followups[0].date,fields['#followDate']);
 assert.equal(f.state.registrations.length,1,'an unselected registration does not insert a record');
 console.log('S3 follow-up save: recorded date drives the customer summary without losing stage, next date or registration');
}
async function verifyFollowupSingleFlightAndRetry(){
 const fields={
  '#followDate':'2026-11-12T10:20','#nextFollow':'2026-11-21','#followNote':'合成跟进单飞',
  '#followRegistration':'已报名','#followMethod':'电话',
 };
 const f=prepareCustomerWrite(fields);
 const customerBefore=structuredClone(f.customer),followupsBefore=f.state.followups.slice();
 const registrationsBefore=f.state.registrations.slice(),activitiesBefore=f.state.activities.slice();
 const retryFlush=f.context.flushStateWrites;
 let completeFirst;
 let flushCalls=0;
 const held=new Promise((resolve,reject)=>{completeFirst=reject;});
 f.context.flushStateWrites=()=>{flushCalls++;return held;};
 const first=f.action('save-follow'),second=f.action('save-follow');
 try{
  assert.equal(flushCalls,1,'a second follow-up click cannot enqueue another write while the first is pending');
  assert.equal(f.state.followups.length,followupsBefore.length+1);
  assert.equal(f.state.registrations.length,registrationsBefore.length+1);
 }finally{
  completeFirst(new Error('synthetic pending save failure'));
  await Promise.all([first,second]);
 }
 assert.deepEqual(f.customer,customerBefore);
 assert.deepEqual(f.state.followups,followupsBefore);
 assert.deepEqual(f.state.registrations,registrationsBefore);
 assert.deepEqual(f.state.activities,activitiesBefore);
 f.context.flushStateWrites=retryFlush;
 await f.action('save-follow');
 assert.equal(f.state.followups.length,followupsBefore.length+1);
 assert.equal(f.state.registrations.length,registrationsBefore.length+1);
 assert.equal(f.state.registrations[0].followupId,f.state.followups[0].id);
 assert.equal(f.state.followups[0].date,fields['#followDate']);
 assert.equal(f.customer.lastFollow,'2026-11-12');
 assert.equal(f.customer.due,fields['#nextFollow']);
 assert.equal(f.toasts.at(-1),'跟进已保存 · 已报名');
 console.log('S3 follow-up single flight: one pending write and registration, exact rollback, and a successful explicit retry');
}
verifyDrawerIdentity().then(verifyCustomerScopes).then(verifyCustomerPreviewSelection).then(verifyCustomerListFirstLayout).then(verifySelectionSetIdentity).then(verifyFollowupLabels).then(verifyHomeHierarchy).then(verifyHomeFollowupDrilldown).then(verifyPlanDateExportParity).then(verifyFollowupPaginationAndExport).then(verifyCustomerWriteBoundaries).then(verifyFollowupWriteDates).then(verifyFollowupSingleFlightAndRetry).catch(error=>{console.error(error);process.exitCode=1;});
