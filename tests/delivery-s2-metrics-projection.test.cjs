'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../resources/app/app.js'),'utf8').replace(/\r\n/g,'\n');
function between(a,b){const start=source.indexOf(a),end=source.indexOf(b,start);assert.ok(start>=0&&end>start,`production boundary missing: ${a}`);return source.slice(start,end);}
const at={value:new Date(2026,10,17,12).getTime()};
class TestDate extends Date{constructor(...args){super(...(args.length?args:[at.value]));}static now(){return at.value;}}
const state={dataRevision:0,customers:[],tickets:[],deposits:[],followups:[],registrations:[],activities:[],settings:{}};
const context={state,Date:TestDate,window:{__LOCAL_DB__:true},console,homeTaskFilter:'all',localDataRevision:0,stateVersion:'',pendingStateData:null,queuedWriteCount:0,writeConflict:null,
  normalizeObjectRows:rows=>Array.isArray(rows)?rows:[],activeCustomers:()=>state.customers.filter(c=>!c.deleted),isGroupFanSource:s=>['群粉','FB群粉'].includes(s),
  isStatusBaseline:e=>Boolean(e?.initial||(!e?.from&&e?.initial!==false)),
  fetch(){throw new Error('projection must not access network');},persist(){throw new Error('projection must not write');},statePayload(){throw new Error('projection must not rebuild mutable ledger');},
  esc:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),icons:()=>'',
};
const production=between('  let metricsReadState=', '  const cloneStateData=')
  +between('  const money =','  function backupHealth(')
  +between('  const buildCounts =','  function updateCounts(')
  +between('  function todayStatusCounts(', '  function currentSourceStatusCounts(')
  +between('  let homeMetricsCache=', '  function renderHome()');
vm.createContext(context);
vm.runInContext(production+'\nthis.api={getMetricsProjection,prepareHomeMetrics,beginMetricsRead,completeMetricsRead,buildHomeTrendSeries,counts,read:()=>metricsReadState,setToday:v=>{today=v;}};',context);
const api=context.api;
function loaded(){const token=api.beginMetricsRead();api.completeMetricsRead(token,'applied');}
function metric(dto,id){return dto.metrics[id];}
function touch(){state.dataRevision++;context.localDataRevision++;}

const initial=api.getMetricsProjection();assert.equal(initial.sourceState.status,'loading');assert.equal(metric(initial,'customers.total').value,null,'unloaded empty arrays are not confirmed zero');
assert.equal(initial.seriesStatus.sevenDayActivity,'loading');
for(const scope of [{scope:'ws-account'},{scope:'global-crm',accountId:'other'},{scope:'global-crm',from:'2026-01-01'},{filters:{channel:'FB'}}])assert.throws(()=>api.getMetricsProjection(scope),/scope/i);
loaded();const empty=api.getMetricsProjection();assert.equal(metric(empty,'customers.total').value,0);assert.equal(metric(empty,'customers.total').status,'empty');assert.equal(empty.seriesStatus.sevenDayActivity,'empty');
assert.equal(metric(empty,'customers.joined').basis.denominator,0);assert.equal(metric(empty,'customers.joined').basis.numerator,0);assert.equal(metric(empty,'customers.joined').basis.ratioDefined,false);
state.customers=[
 {id:'a',name:'甲',phone:'9000000001',source:'单导',registered:'2026-11-17',status:'在群',hot:true,vipId:'legacy-vip',ticket:true,deposit:true,amount:500,due:'2026-11-17',occupation:'职员',country:'印度',assistant:'助理',statusHistory:[{initial:false,from:'未进群',type:'joined',date:'2026-11-17',source:'单导'},{initial:false,from:'未进群',type:'joined',date:'2026-11-17',source:'单导'}]},
 {id:'b',name:'乙',phone:'9000000002',source:'FB群粉',registered:'2026-11-16T23:59:59Z',status:'未进群',due:'2026-11-16',job:'工程师',region:'印度',lastFollow:'2026-11-16'},
 {id:'deleted',deleted:true,name:'忽略',registered:'2026-11-17',status:'在群'},
 {id:'c',name:'未命名客户',source:'群粉',registered:'2026-11-11',due:'2026-02-31',status:'已退群'},
];
state.registrations=[{id:'r1',customerId:'a',date:'2026-11-16',status:'已报名'},{id:'r2',customerId:'a',date:'2026-11-17',status:'已报名'},{id:'r3',customerId:'b',date:'2026-11-15',status:'已报名'},{id:'r4',customerId:'deleted',date:'2026-11-17',status:'已报名'}];
state.deposits=[{id:'d1',customerId:'a',date:'2026-11-16',amount:30,status:'待确认'},{id:'d2',customerId:'b',date:'2026-11-17',amount:70,status:'已入金'},{id:'d3',customerId:'b',date:'2026-11-15',amount:900,status:'已入金'},{id:'d4',customerId:'deleted',date:'2026-11-17',amount:900,status:'已入金'}];
state.followups=[{id:'f1',customerId:'a',date:'2026-11-17'},{id:'f2',customerId:'deleted',date:'2026-11-17'},{id:'f3',customerId:'unknown',date:'2026-11-11'}];touch();
const populated=api.getMetricsProjection(),prepared=api.prepareHomeMetrics();
assert.equal(metric(populated,'customers.total').value,3);assert.equal(metric(populated,'customers.joined').value,1);assert.equal(metric(populated,'customers.vip').value,1,'legacy VIP aliases keep existing business truth');
assert.equal(metric(populated,'customers.ticket').value,1);assert.equal(metric(populated,'customers.deposit').value,1,'pending deposit record suppresses legacy fallback exactly as owner');
assert.equal(metric(populated,'home.joinedToday').value,1,'duplicate daily source+event per customer is deduplicated');
assert.equal(metric(populated,'home.weekRegistrations').value,1,'calendar-week distinct active customers, not record count');
assert.equal(metric(populated,'home.weekDeposit').value,100,'existing home includes pending deposit status, no new filtering');
assert.equal(metric(populated,'home.dueToday').value,1);assert.equal(metric(populated,'home.overdue').value,1);assert.equal(metric(populated,'home.profileGaps').value,1);
assert.equal(metric(populated,'home.pendingRegistered').value,1);
for(const [id,key] of [['customers.total','total'],['customers.joined','joined'],['customers.hot','hot'],['customers.vip','vip'],['customers.ticket','ticket'],['customers.deposit','deposit']])assert.equal(metric(populated,id).value,api.counts()[key],'projection shares existing counts owner');
assert.equal(prepared.weekAmount,metric(populated,'home.weekDeposit').value);assert.equal(prepared.high,metric(populated,'home.highUnplanned').value);assert.equal(prepared.pendingRegistered,metric(populated,'home.pendingRegistered').value);
assert.equal(populated.series.sevenDayActivity.at(-1).followups,2,'trend preserves all existing followup rows including deleted/unlinked customer');assert.equal(populated.series.sevenDayActivity[0].followups,1);
assert.equal(populated.series.sevenDayActivity.at(-2).customers,1,'trend slices registered timestamp while counts exact today rule stays distinct');
assert.equal(metric(populated,'home.weekDeposit').basis.from,'2026-11-16');assert.match(metric(populated,'home.weekDeposit').basis.statusRule,/不额外排除/);
assert.equal(populated.scope.kind,'global-crm');assert.equal(populated.version.stateVersion,'');assert.equal(Object.isFrozen(populated),true);assert.equal(Object.isFrozen(populated.series.sevenDayActivity[0]),true);
assert.equal(Object.isFrozen(state.customers[0]),false,'read-only DTO must never freeze live CRM records');assert.equal('customers' in populated,false,'public DTO contains no CRM record collection');
assert.equal(api.getMetricsProjection(),populated,'same revision/read state/day reuses projection');
const before=JSON.stringify(state);api.getMetricsProjection();assert.equal(JSON.stringify(state),before,'projection does not mutate business state or ledger');
const failed=api.beginMetricsRead();api.completeMetricsRead(failed,'error');const stale=api.getMetricsProjection();assert.equal(stale.sourceState.status,'error');assert.equal(stale.sourceState.hasLastGood,true);assert.equal(metric(stale,'customers.total').value,null);assert.equal('previousValue' in metric(stale,'customers.total'),false,'no optimistic value is mislabeled as last-read snapshot');assert.equal(stale.seriesStatus.sevenDayActivity,'error');
const oldRead=api.beginMetricsRead(),newRead=api.beginMetricsRead();api.completeMetricsRead(newRead,'applied');api.completeMetricsRead(oldRead,'error');assert.equal(api.read().status,'loaded','older read failure cannot override newer successful read');
loaded();const recovered=api.getMetricsProjection();assert.equal(metric(recovered,'customers.total').value,3);
state.deposits.push({id:'bad',customerId:'a',date:'2026-11-17',amount:'Infinity'});touch();const invalid=api.getMetricsProjection();assert.equal(metric(invalid,'home.weekDeposit').status,'invalid');assert.equal(metric(invalid,'home.weekDeposit').value,null,'nonfinite original sum cannot become a chart number');
state.deposits.pop();touch();at.value=new Date(2026,10,18,12).getTime();api.setToday('2026-11-18');const tomorrow=api.getMetricsProjection();assert.notEqual(tomorrow,recovered);assert.equal(metric(tomorrow,'home.dueToday').value,0);assert.equal(metric(tomorrow,'home.overdue').value,2);assert.equal(tomorrow.series.sevenDayActivity.at(-1).date,'2026-11-18');
assert.ok(source.includes('getMetricsProjection,getStateVersion:')||source.includes('getMetricsProjection,showCustomer'),'host exposes only read projection getter');
// Baseline computation assertions above intentionally use real production owners.
console.log('S2 main metrics: loaded/unknown/error, original-owner equivalence, calendar/date/legacy/zero/nonfinite, cache/read-only/scope passed');

function readFixture(){
  const calls={apply:0,persist:0,render:0,fetch:0};
  const runtime={window:{__LOCAL_DB__:true},state:{view:'ws-workbench'},Date:TestDate,console,
    syncBusy:false,destructiveWriteBusy:false,pendingStateData:null,writeConflict:null,queuedWriteCount:0,localDataRevision:0,stateVersion:'',dbWriteFailure:null,syncReadFailure:null,lastCommittedState:null,
    applySharedData(){calls.apply++;},cloneStateData:x=>x,statePayload:()=>({}),persist(){calls.persist++;},flushStateWrites:async()=>{},markSyncVersion(v){if(v)runtime.stateVersion=String(v);},render(){calls.render++;},toast(){},scheduleHomeRefresh(){},$:()=>({classList:{contains:()=>true}}),
    fetch:async()=>{calls.fetch++;return {ok:true,json:async()=>({initialized:true,version:'read-v1'})};}
  };
  vm.createContext(runtime);
  vm.runInContext(between('  let metricsReadState=','  const cloneStateData=')+between('  async function syncFromBackend(force=false){','  function clearDataSyncTimer(')+between('  async function initializeBackend(){','  async function followupAction(')+';this.readState=()=>metricsReadState;',runtime);
  return {runtime,calls};
}
async function verifyLifecycle(){
  let f=readFixture();await f.runtime.initializeBackend();assert.equal(f.calls.apply,1);assert.equal(f.runtime.readState().status,'loaded');assert.ok(f.runtime.readState().lastLoadedAt);
  f.runtime.fetch=async()=>{throw new Error('synthetic read failure contains secret-like material; must not enter DTO');};
  assert.equal(await f.runtime.syncFromBackend(true),false);assert.equal(f.runtime.readState().status,'error');assert.equal(f.runtime.readState().hasLastGood,true);assert.equal(f.runtime.readState().errorCode,'STATE_READ_FAILED');assert.equal(f.runtime.readState().pending.size,0);
  f.runtime.fetch=async()=>({ok:true,json:async()=>({initialized:true,version:'read-v2'})});await f.runtime.refreshSharedState();assert.equal(f.calls.apply,2);assert.equal(f.runtime.readState().status,'loaded');
  f=readFixture();f.runtime.fetch=async()=>{throw new Error('initial offline');};await f.runtime.initializeBackend();assert.equal(f.runtime.readState().status,'error');assert.equal(f.runtime.readState().hasLastGood,false);assert.equal(f.calls.persist,0);
  f.runtime.fetch=async()=>({ok:true,json:async()=>({initialized:true,version:'delayed-v1'})});await f.runtime.syncFromBackend(true);assert.equal(f.calls.apply,1,'full initialized recovery uses the existing apply path');assert.equal(f.runtime.readState().hasLastGood,true);assert.equal(f.runtime.readState().status,'loaded');assert.equal(f.calls.persist,0,'recovery never initializes or writes data');
  f=readFixture();f.runtime.window.__LOCAL_DB__=false;await f.runtime.initializeBackend();assert.equal(f.calls.fetch,0);assert.equal(f.runtime.readState().status,'error');assert.equal(f.runtime.readState().errorCode,'LOCAL_SOURCE_UNAVAILABLE');assert.equal(f.runtime.readState().hasLastGood,false,'no localStorage/source fallback invents loaded state');
  f=readFixture();f.runtime.fetch=async()=>({ok:true,json:async()=>({initialized:false,version:'new-empty'})});await f.runtime.initializeBackend();assert.equal(f.calls.persist,1,'existing first-workspace initialization remains unchanged');assert.equal(f.runtime.readState().status,'loaded','confirmed initialized empty workspace is a real zero');
  f=readFixture();let resolve;f.runtime.fetch=()=>new Promise(r=>{resolve=r;});const pending=f.runtime.refreshSharedState();f.runtime.localDataRevision++;resolve({ok:true,json:async()=>({initialized:true,version:'discard'})});assert.equal(await pending,null);assert.equal(f.calls.apply,0);assert.equal(f.runtime.readState().hasLastGood,false);assert.equal(f.runtime.readState().pending.size,0);
  console.log('S2 actual read lifecycle: initial success/empty/error, full-read recovery and discarded read guards, refresh/discard, unavailable static source passed');
}
function verifyHomeRendering(){
  const rendered={innerHTML:''};let reminderReads=0,chartCalls=[];
  Object.assign(context,{$:selector=>selector==='#viewContainer'?rendered:null,document:{querySelectorAll:()=>[]},heading:()=>'',btn:()=>'',metric:(label,value)=>`<div data-metric="${label}">${value}</div>`,suggestion:(icon,tone,title,desc,label)=>`<div>${title}${desc}${label}</div>`,renderStatusSummary:()=>'<p>existing status summary</p>',homeDetailExpanded:false,loadHomeWsFollowups:()=>{reminderReads++;},horizonProcessHtml:()=>'',horizonSpotlightHtml:()=>'',horizonNodeHtml:()=>'',
    window:{__LOCAL_DB__:true,ZhikeMetricsCharts:{renderTrend:options=>{chartCalls.push(options);return '<div data-real-chart></div>';}}}});
  vm.runInContext(between('  function renderHorizonHero(', '  function ensureHomeWsFollowupPanel(')+between('  function renderHome() {','  function suggestion(')+';this.renderHome=renderHome;',context);
  vm.runInContext("metricsReadState.status='loading';metricsReadState.hasLastGood=false;metricsReadState.revision++;",context);context.renderHome();
  assert.match(rendered.innerHTML,/加载中 · 数据未确认/);assert.doesNotMatch(rendered.innerHTML,/<small>实时数据<\/small>/);assert.match(rendered.innerHTML,/data-metric="客户总数">—/);assert.equal(chartCalls.at(-1).status,'loading');assert.equal(chartCalls.at(-1).points.length,0);assert.equal(reminderReads,1,'projection must not add a second reminder fetch');
  loaded();const actualReadAt=api.read().lastLoadedAt;at.value+=61000;state.customers[0].hot=false;touch();context.renderHome();assert.match(rendered.innerHTML,/周一至今日 · 含待确认/,'weekly deposit card honestly includes pending status');assert.match(rendered.innerHTML,/<strong>¥100<\/strong>/,'original weekly amount remains 100');assert.match(rendered.innerHTML,/范围：全局客户主档与既有业务记录/);assert.ok(rendered.innerHTML.includes(`datetime="${actualReadAt}"`),'visible read timestamp is the actual successful read time');assert.notEqual(api.getMetricsProjection().calculatedAt,actualReadAt,'projection calculation time is not read time');assert.match(rendered.innerHTML,/data-metric="客户总数">3/);assert.equal(chartCalls.at(-1).status,'available');assert.equal(chartCalls.at(-1).points.length,7);assert.match(rendered.innerHTML,/客户状态覆盖度/);assert.match(rendered.innerHTML,/style="width:0%"/,'true zero coverage has no positive-length bar');
  const acceptedAmount=api.getMetricsProjection().metrics['home.weekDeposit'].value;assert.equal(acceptedAmount,100);state.deposits[0].amount=80;touch();context.pendingStateData={synthetic:true};assert.equal(api.getMetricsProjection().metrics['home.weekDeposit'].value,150,'loaded owner keeps optimistic current-state semantics');context.renderHome();assert.match(rendered.innerHTML,/保存中/,'optimistic local values show pending save');assert.doesNotMatch(rendered.innerHTML,/已保存/);context.writeConflict={synthetic:true};context.renderHome();assert.match(rendered.innerHTML,/存在保存冲突/,'write conflict is visible instead of an unconditional saved label');context.writeConflict=null;const request=api.beginMetricsRead();api.completeMetricsRead(request,'error');context.renderHome();assert.equal(api.getMetricsProjection().metrics['home.weekDeposit'].value,null);assert.equal('previousValue' in api.getMetricsProjection().metrics['home.weekDeposit'],false,'150 is not the previously-read 100 snapshot');assert.doesNotMatch(rendered.innerHTML,/<strong>¥150<\/strong>/);assert.match(rendered.innerHTML,/读取失败 · 指标暂不可用/);assert.match(rendered.innerHTML,/data-metric="客户总数">—/);assert.equal(chartCalls.at(-1).status,'error');assert.equal(chartCalls.at(-1).points.length,0);assert.equal(reminderReads,5);
  console.log('S2 actual home rendering: loaded values preserved, unknown is dash, failed metrics unavailable, shared series renderer, zero-width coverage and reminder count passed');
}
const originalPriorityRows="    const rows=(homeTaskFilter==='overdue'?overdue:homeTaskFilter==='today'?planned:allDue).sort((a,b)=>smartPriority(b,business)-smartPriority(a,business)||String(a.due).localeCompare(String(b.due))).slice(0,5);";
const memoPriorityRows="    const selectedRows=homeTaskFilter==='overdue'?overdue:homeTaskFilter==='today'?planned:allDue;\n    const priorityByCustomer=new Map(selectedRows.map(customer=>[customer,smartPriority(customer,business)]));\n    const rows=selectedRows.sort((a,b)=>priorityByCustomer.get(b)-priorityByCustomer.get(a)||String(a.due).localeCompare(String(b.due))).slice(0,5);";
function projectionFixture(date=new Date(2026,10,15,23,59),legacyComparator=false){
  const clock={now:date.getTime()};class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock.now]));}static now(){return clock.now;}}
  const model={dataRevision:0,customers:[],tickets:[],deposits:[],followups:[],registrations:[],activities:[],settings:{}};
  const sandbox={...context,state:model,Date:ClockDate,window:{__LOCAL_DB__:true},stateVersion:'',localDataRevision:0,pendingStateData:null,queuedWriteCount:0,writeConflict:null,activeCustomers:()=>model.customers.filter(c=>!c.deleted)};
  const code=legacyComparator?production.replace(memoPriorityRows,originalPriorityRows):production;assert.ok(code.includes(legacyComparator?originalPriorityRows:(production.includes(memoPriorityRows)?memoPriorityRows:originalPriorityRows)),'actual comparator boundary remains explicit');
  vm.createContext(sandbox);vm.runInContext(code+';this.api={getMetricsProjection,prepareHomeMetrics,beginMetricsRead,completeMetricsRead,read:()=>metricsReadState,setToday:v=>{today=v;},setFilter:v=>{homeTaskFilter=v;},installPriorityCounter:()=>{let calls=0;const original=smartPriority;smartPriority=(...args)=>{calls++;return original(...args);};return ()=>calls;}};',sandbox);
  const ready=()=>{const token=sandbox.api.beginMetricsRead();sandbox.api.completeMetricsRead(token,'applied');};
  return {state:model,api:sandbox.api,clock,ready,sandbox};
}
async function verifyRequiredCorrections(){
  const cases=[
    ['first-read recovery and pending/revision guards',async()=>{
      let f=readFixture();f.runtime.fetch=async()=>{throw new Error('initial offline');};await f.runtime.initializeBackend();f.runtime.fetch=async()=>({ok:true,json:async()=>({initialized:true,version:'recover'})});await f.runtime.syncFromBackend(true);assert.equal(f.calls.apply,1,'full initialized response after first-read failure must apply existing read path');assert.equal(f.calls.persist,0,'recovery must not initialize/write a workspace');assert.equal(f.runtime.readState().status,'loaded');
      for(const guard of ['localDataRevision','pendingStateData','writeConflict','queuedWriteCount']){f=readFixture();let release;f.runtime.fetch=()=>new Promise(resolve=>{release=resolve;});const request=f.runtime.syncFromBackend(true);if(guard==='localDataRevision')f.runtime.localDataRevision++;else if(guard==='queuedWriteCount')f.runtime.queuedWriteCount=1;else f.runtime[guard]={synthetic:true};release({ok:true,json:async()=>({initialized:true,version:'late'})});assert.equal(await request,null);assert.equal(f.calls.apply,0,`late ${guard} must not be overwritten`);assert.equal(f.runtime.readState().hasLastGood,false);}
      for(const guard of ['pendingStateData','writeConflict','queuedWriteCount']){f=readFixture();f.runtime[guard]=guard==='queuedWriteCount'?1:{synthetic:true};assert.equal(await f.runtime.syncFromBackend(true),null);assert.equal(f.calls.fetch,0);}
    }],
    ['single asOfDay across midnight before existing tick',()=>{
      const f=projectionFixture();f.state.customers=[{id:'day',registered:'2026-11-15',due:'2026-11-15',status:'在群'}];f.state.deposits=[{customerId:'day',date:'2026-11-15',amount:30},{customerId:'day',date:'2026-11-16',amount:70}];f.state.dataRevision++;f.ready();const before=f.api.getMetricsProjection();assert.equal(metric(before,'home.weekDeposit').value,30);f.clock.now=new Date(2026,10,16,0,0,10).getTime();const midnight=f.api.getMetricsProjection();assert.equal(midnight.series.sevenDayActivity.at(-1).date,'2026-11-15','trend must stay with existing today until minute tick');assert.equal(metric(midnight,'home.weekDeposit').basis.from,'2026-11-09');assert.equal(metric(midnight,'home.weekDeposit').basis.to,'2026-11-15');assert.equal(metric(midnight,'home.weekDeposit').value,30);assert.equal(metric(midnight,'home.dueToday').value,1);assert.equal(midnight,before,'clock alone must not invalidate until existing today tick');f.api.setToday('2026-11-16');const tick=f.api.getMetricsProjection();assert.equal(tick.series.sevenDayActivity.at(-1).date,'2026-11-16');assert.equal(metric(tick,'home.weekDeposit').value,70);assert.equal(metric(tick,'home.dueToday').value,0);assert.equal(metric(tick,'home.overdue').value,1);
    }],
    ['unknown/error coverage basis cannot leak numeric zero',()=>{
      const f=projectionFixture();for(const phase of ['loading','error']){if(phase==='error'){const token=f.api.beginMetricsRead();f.api.completeMetricsRead(token,'error');}const dto=f.api.getMetricsProjection();for(const id of ['customers.joined','customers.hot','customers.vip','customers.ticket','customers.deposit']){const basis=metric(dto,id).basis;assert.equal(basis.numerator,null,`${phase} numerator is not a confirmed zero`);assert.equal(basis.denominator,null,`${phase} denominator is not a confirmed zero`);assert.equal(basis.ratioDefined,false);}}f.ready();const loaded=f.api.getMetricsProjection();assert.equal(metric(loaded,'customers.joined').basis.numerator,0);assert.equal(metric(loaded,'customers.joined').basis.denominator,0);assert.equal(metric(loaded,'customers.joined').basis.ratioDefined,false);
    }],
    ['out-of-order request cannot bless provenance or rewrite timestamp',()=>{
      const f=projectionFixture();let old=f.api.beginMetricsRead(),current=f.api.beginMetricsRead();f.api.completeMetricsRead(current,'error');f.clock.now+=1000;f.api.completeMetricsRead(old,'applied');assert.equal(f.api.read().hasLastGood,false,'older completion cannot create last-good read after newer failure');assert.equal(f.api.read().lastLoadedAt,null);old=f.api.beginMetricsRead();current=f.api.beginMetricsRead();f.api.completeMetricsRead(current,'applied');const accepted=f.api.read().lastLoadedAt;f.clock.now+=1000;f.api.completeMetricsRead(old,'applied');assert.equal(f.api.read().lastLoadedAt,accepted,'older completion cannot replace accepted read timestamp');
    }],
  ];
  let failures=0;for(const [name,run] of cases){try{await run();console.log(`S2 correction Passed: ${name}`);}catch(error){failures++;console.error(`S2 correction Failed: ${name}: ${error.message}`);}}
  if(failures)throw new Error(`${failures}/4 S2 correction vectors failed`);
}
function verifyPriorityMemoSnapshot(){
  const dayKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const rowsFor=(date,count,ties=false)=>Array.from({length:count},(_,index)=>({id:'PRIORITY_'+index,name:'合成排序客户',phone:String(9000000000+index),source:index%2?'单导':'群粉',status:ties?'在群':index%3?'在群':'未进群',hot:ties?false:index%7===0,vipCode:ties?'':index%13===0?'legacy-vip':'',registered:dayKey(date),due:dayKey(new Date(date.getFullYear(),date.getMonth(),date.getDate()+(ties?0:index%5-3),12)),assistant:'合成助理',country:'合成国家',occupation:'合成职业'}));
  const vectors=[
    {name:'zero',count:0,date:new Date(2026,10,17,12)},
    {name:'one',count:1,date:new Date(2026,10,17,12)},
    {name:'exact-priority-and-date-ties',count:80,ties:true,date:new Date(2026,10,17,12)},
    {name:'legacy-missing-fields',count:31,legacy:true,date:new Date(2026,10,17,12)},
    {name:'sort-call-expansion',count:240,date:new Date(2026,10,17,12)},
    ...[new Date(2026,10,15,23,59,59),new Date(2026,10,16,0,0,0),new Date(2026,10,17,11,59,59),new Date(2026,10,17,12,0,1),new Date(2026,11,31,23,59,59),new Date(2024,1,29,12)].map((date,index)=>({name:'fixed-clock-boundary-'+index,count:35,date})),
  ];
  let checked=0,legacyComparisonExpands=false;
  for(const vector of vectors)for(const filter of ['all','today','overdue']){
    const modelRows=rowsFor(vector.date,vector.count,vector.ties);
    if(vector.legacy)for(let i=0;i<modelRows.length;i++){const row=modelRows[i];delete row.name;delete row.country;delete row.occupation;row.rawPhone=row.phone;delete row.phone;row.legacyPhones=[row.rawPhone];row.job=i%3?'旧职业':'';row.region=i%2?'旧地区':'';row.ticket=i%4===0;row.deposit=i%5===0;row.amount=25;if(i%6===0)row.due='2026-02-31';}
    const stateData={customers:modelRows,followups:modelRows.filter((_,i)=>i%3===0).map((row,i)=>({id:'PF_'+i,customerId:row.id,date:dayKey(vector.date)})),registrations:modelRows.filter((_,i)=>i%4===0).map((row,i)=>({id:'PR_'+i,customerId:row.id,date:dayKey(vector.date),status:'已报名'})),deposits:modelRows.filter((_,i)=>i%6===0).map((row,i)=>({id:'PD_'+i,customerId:row.id,date:dayKey(vector.date),amount:i*3,status:i%2?'待确认':'已确认'}))};
    if(vector.ties){stateData.followups=[];stateData.registrations=[];stateData.deposits=[];}
    const fixture=projectionFixture(vector.date),oracle=projectionFixture(vector.date,true);
    for(const item of [fixture,oracle]){Object.assign(item.state,JSON.parse(JSON.stringify(stateData)));item.state.dataRevision++;item.api.setFilter(filter);item.ready();}
    const calls=fixture.api.installPriorityCounter(),oldCalls=oracle.api.installPriorityCounter(),actual=fixture.api.prepareHomeMetrics(),expected=oracle.api.prepareHomeMetrics();
    const selected=value=>filter==='overdue'?value.overdue:filter==='today'?value.planned:value.allDue;
    const fingerprint=value=>JSON.stringify({counts:value.n,daily:value.daily,weekRegistrations:value.weekRegistrations,weekAmount:value.weekAmount,allDue:value.allDue.map(c=>c.id),overdue:value.overdue.map(c=>c.id),planned:value.planned.map(c=>c.id),rows:value.rows.map(c=>c.id),pendingRegistered:value.pendingRegistered,high:value.high,profileGaps:value.profileGaps,trend:value.sevenDayActivity});
    assert.equal(JSON.stringify(selected(actual).map(c=>c.id)),JSON.stringify(selected(expected).map(c=>c.id)),`${vector.name}/${filter}: complete sorted array preserves old comparator order`);
    assert.equal(fingerprint(actual),fingerprint(expected),`${vector.name}/${filter}: all amounts, dates, statuses, counts and top-five digest remain identical`);
    const firstCalls=calls();assert.ok(firstCalls<=selected(actual).length,`${vector.name}/${filter}: priority evaluations ${firstCalls} must not grow with sort comparisons for ${selected(actual).length} selected rows`);
    if(vector.ties&&filter!=='overdue')assert.equal(JSON.stringify(selected(actual).map(c=>c.id)),JSON.stringify(modelRows.map(c=>c.id)),'equal priority/date rows retain original stable order');
    fixture.api.getMetricsProjection();fixture.api.prepareHomeMetrics();assert.equal(calls(),firstCalls,'same revision reuses already prepared order');
    fixture.state.dataRevision++;fixture.api.prepareHomeMetrics();assert.equal(calls()-firstCalls,firstCalls,'priority evaluation snapshot is rebuilt for each new revision, not shared across calculations');
    if(vector.name==='sort-call-expansion'&&filter==='all'){assert.ok(oldCalls()>selected(expected).length*2,'legacy negative control proves comparator repeatedly scores the same rows');legacyComparisonExpands=true;}
    checked++;
  }
  assert.equal(legacyComparisonExpands,true);console.log(`S2 priority memo: ${checked} actual-versus-old full-sort/digest vectors passed; all/today/overdue, 0/1/ties/legacy/fixed-clock boundaries and bounded calls`);
}
verifyRequiredCorrections().then(()=>verifyPriorityMemoSnapshot()).then(()=>verifyLifecycle()).then(()=>verifyHomeRendering()).catch(error=>{console.error(error);process.exitCode=1;});
