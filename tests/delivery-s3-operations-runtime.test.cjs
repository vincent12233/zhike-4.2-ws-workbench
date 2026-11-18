'use strict';
// Execute the shipped UI modules and their registered event handlers against
// explicit synthetic host state. No browser/WS/Worker/service/database is used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const repo=path.resolve(__dirname,'..');
const core=require('../resources/app/modules/operations-core.cjs');
const charts=require('../resources/app/modules/metrics-charts.js');
const source=file=>fs.readFileSync(path.join(repo,'resources/app/modules',file),'utf8').replace(/\r\n/g,'\n');
class Node {
 constructor(dataset={},classes=[]){this.dataset={...dataset};this.listeners=new Map();this.isConnected=true;this.parentElement=null;this.children=[];this.tagName='BUTTON';this.captured=new Set();const values=new Set(classes);this.classList={add:value=>values.add(value),remove:value=>values.delete(value),contains:value=>values.has(value)}}
 addEventListener(name,handler,options={}){const list=this.listeners.get(name)||[];list.push({handler,capture:options===true||options.capture===true});this.listeners.set(name,list)}
 removeEventListener(name,handler,options={}){const capture=options===true||options.capture===true;this.listeners.set(name,(this.listeners.get(name)||[]).filter(entry=>entry.handler!==handler||entry.capture!==capture))}
 async fire(name,extra={}){const event={type:name,target:this,currentTarget:this,button:0,buttons:1,isPrimary:true,pointerId:1,clientX:0,clientY:0,cancelable:true,detail:1,defaultPrevented:false,preventDefault(){this.defaultPrevented=true},stopImmediatePropagation(){this.stopped=true},dataTransfer:{setData(){}},...extra};for(const entry of [...(this.listeners.get(name)||[])].sort((a,b)=>Number(b.capture)-Number(a.capture))){if(event.stopped)break;await entry.handler(event)}return event}
 contains(node){for(let current=node;current;current=current.parentElement)if(current===this)return true;return false}
 matches(selector){if(selector.includes(','))return selector.split(',').some(value=>this.matches(value.trim()));return selector==='.ops-card[data-ops-customer]'?this.classList.contains('ops-card')&&this.dataset.opsCustomer!==undefined:selector==='[data-ops-customer]'?this.dataset.opsCustomer!==undefined:selector.startsWith('.')?this.classList.contains(selector.slice(1)):/^[a-z]+$/i.test(selector)?this.tagName.toLowerCase()===selector.toLowerCase():false}
 closest(selector){for(let current=this;current;current=current.parentElement)if(current.matches(selector))return current;return null}
 setPointerCapture(id){this.captured.add(id)}
 hasPointerCapture(id){return this.captured.has(id)}
 releasePointerCapture(id){this.captured.delete(id)}
 append(node){if(node.parentElement){const siblings=node.parentElement.children,index=siblings.indexOf(node);if(index>=0)siblings.splice(index,1)}this.children.push(node);node.parentElement=this}
 prepend(node){this.append(node);this.children.splice(this.children.indexOf(node),1);this.children.unshift(node)}
 insertBefore(node,target){assert.ok(this.children.includes(target),'The real target must be in this parent');if(node===target)return;this.append(node);this.children.splice(this.children.indexOf(node),1);this.children.splice(this.children.indexOf(target),0,node)}
 querySelector(){return null}
}
function homeHarness(options={}){
 const view=new Node(),document=new Node(),window=new Node(),main=new Node({},['home-main-grid']),bottom=new Node({},['home-bottom-grid']),actions=new Node(),calls={writes:[],persist:0,flush:0,snapshot:0,activity:0,render:0,close:0};view.tagName=main.tagName=bottom.tagName='DIV';main.parentElement=bottom.parentElement=view;
 const makeCard=(name,parent)=>{const card=new Node({},['panel']),heading=new Node({},['panel-heading']);card.tagName='SECTION';heading.tagName='DIV';heading.parentElement=card;heading.textContent=name;card.querySelector=selector=>selector==='.panel-heading'?heading:selector==='.panel-title,.metric-label'?{textContent:name}:null;parent.append(card);return {card,heading}};
 const first=makeCard('今日待跟进',main),second=makeCard('运营提醒',main),bottomA=makeCard('动态',bottom),bottomB=makeCard('健康',bottom),all=[first,second,bottomA,bottomB],storage=new Map(Object.entries(options.storage||{}).map(([key,value])=>[key,JSON.stringify(value)]));let pointTarget=first.card,observer,layoutButton,reset,save,choices=[];
 const host={state:{view:'home',customers:[],activities:[],settings:{}},persist(){calls.persist++},async flushStateWrites(){calls.flush++},async snapshotBeforeWrite(){calls.snapshot++;return true},activity(){calls.activity++},render(){calls.render++},toast(){},closeModal(){calls.close++},openModal(){reset=new Node();save=new Node()}};
 view.querySelector=selector=>selector==='.home-main-grid'?main:selector==='.home-bottom-grid'?bottom:selector==='#homeLayoutButton'?layoutButton:selector==='.heading-actions'?actions:null;
 view.querySelectorAll=selector=>selector==='[data-layout-key]'||selector==='.metric-grid>.metric-card,.home-main-grid>.panel,.home-bottom-grid>.panel'?all.map(row=>row.card):[];
 actions.prepend=node=>{layoutButton=node;node.parentElement=actions};
 document.createElement=()=>new Node();document.querySelector=selector=>selector==='#viewContainer'?view:selector==='#resetHomeLayout'?reset:selector==='#saveHomeLayout'?save:null;
 document.querySelectorAll=selector=>selector==='[data-home-module]'?choices:[];document.elementFromPoint=()=>pointTarget;
 window.zhikeDesktop={onCustomer(){},onError(){}};window.__zhikeRegistryHost=host;
 vm.runInNewContext(source('productivity.js'),{window,document,localStorage:{getItem:key=>storage.get(key)??null,setItem(key,value){storage.set(key,value);calls.writes.push({key,value:JSON.parse(value)})}},MutationObserver:class{constructor(handler){observer=handler}observe(){}},requestAnimationFrame:handler=>handler(),clearInterval(){},setInterval(){throw Error('Native home fixture must not create fallback reminder timers')},Date,JSON,Set,Map,console});
 const route=async(name,hit,extra={})=>{pointTarget=hit;const pointerId=extra.pointerId??1,captured=all.map(row=>row.heading).find(heading=>heading.hasPointerCapture(pointerId)),target=captured||hit,values={target,pointerId,...extra},observed=await document.fire(name,values);let owner=target;while(owner&&!all.some(row=>row.heading===owner))owner=owner.parentElement;const event=owner?await owner.fire(name,{...values,defaultPrevented:observed.defaultPrevented}):observed;return {target,event}};
 return {host,view,document,window,main,bottom,first,second,all,calls,storage,refresh:()=>observer(),route,point:node=>{pointTarget=node},
  async drag(sourceRow=second,target=first.card){await route('pointerdown',sourceRow.heading);await route('pointermove',target,{clientX:12});await route('pointerup',target,{clientX:12,buttons:0})},
  openLayout(){layoutButton.onclick()},reset(){reset.onclick()},saveHidden(hidden){choices=all.map(row=>({checked:!hidden.includes(row.card.dataset.layoutKey),dataset:{homeModule:row.card.dataset.layoutKey}}));save.onclick()}};
}
function stageHarness(options={}){
 const c={id:'customer-a',name:'隔离客户',phase:'新客户',phaseHistory:[],...options.customer};
 const customers=[c,...(options.otherCustomers||[])],view=new Node(),document=new Node(),calls={snapshot:0,persist:0,flush:0,render:0,open:0,close:0,toast:[]};
 const makeGraph=()=>{
  const board=new Node({},['ops-board']);board.parentElement=view;
  const columns=(options.targets||[options.target===undefined?'成交客户':options.target]).map(stageName=>new Node({stageName},['ops-column']));
  for(const column of columns){column.parentElement=board;column.querySelector=selector=>selector==='.ops-stage-open strong'?{textContent:options.label??column.dataset.stageName}:null}
  const sourceColumns=[];
  const cards=customers.map(row=>{const card=new Node({opsCustomer:String(row.id)},['ops-card','ops-customer-open']);const phase=String(row.phase||'未设置');let column=columns.find(item=>item.dataset.stageName===phase)||sourceColumns.find(item=>item.dataset.stageName===phase);if(!column){column=new Node({stageName:phase},['ops-column']);column.parentElement=board;sourceColumns.push(column)}card.parentElement=column;return card});
  return {board,columns,cards,allColumns:[...columns,...sourceColumns]};
 };
 let graph=makeGraph(),pointTarget=graph.columns[0];
 view.querySelectorAll=selector=>selector==='[data-ops-customer]'||selector==='.ops-card[data-ops-customer]'?graph.cards:selector==='.ops-column'?graph.allColumns:[];
 view.querySelector=selector=>selector==='.ops-board'?graph.board:null;
 document.querySelector=selector=>selector==='#viewContainer'?view:null;
 document.querySelectorAll=selector=>selector==='.drag-target'?graph.allColumns.filter(column=>column.classList.contains('drag-target')):[];
 document.elementFromPoint=()=>pointTarget;
 const host={state:{view:'stage-board',customers,activities:[{kind:'existing'}],settings:{}},
  async snapshotBeforeWrite(){calls.snapshot++;return options.snapshot?options.snapshot(calls.snapshot):options.authorized!==false},persist(){calls.persist++},activity(label){host.state.activities.push({label})},
  async flushStateWrites(){calls.flush++;if(options.flush)return options.flush(calls.flush);if(options.failWrite)throw new Error('isolated-write-failure')},render(){calls.render++},toast(...args){calls.toast.push(args)},closeModal(){calls.close++},showCustomer(){calls.open++}};
 let observer;
 const desktop={onCustomer(){},onError(){}},window=new Node();window.zhikeDesktop=desktop;window.__zhikeRegistryHost=host;
 const context={window,document,host,localStorage:{getItem:()=>null,setItem(){}},MutationObserver:class{constructor(handler){observer=handler}observe(){}},requestAnimationFrame:handler=>handler(),clearInterval(){},setInterval(){throw Error('Native-mode UI runtime must not create reminder timers')},Date,JSON,Set,Map,console};
 vm.runInNewContext(source('productivity.js'),context);
 const uiSource=source('operations-ui.js'),clickStart=uiSource.indexOf("  document.addEventListener('click', event => {\n    const button = event.target.closest('[data-ops-customer]');"),clickEnd=uiSource.indexOf('\n\n  function render(',clickStart);
 assert.ok(clickStart>=0&&clickEnd>clickStart,'Use the actual original operations customer click handler.');
 vm.runInNewContext(uiSource.slice(clickStart,clickEnd),context);
 const start=async(cardIndex=0,extra={})=>{const card=graph.cards[cardIndex];await document.fire('pointerdown',{target:card,...extra});return card.fire('pointerdown',extra)};
 const move=async(x=12,y=0,extra={})=>graph.cards[0].fire('pointermove',{clientX:x,clientY:y,...extra});
 return {c,host,get columns(){return graph.columns},get card(){return graph.cards[0]},get cards(){return graph.cards},get board(){return graph.board},view,window,calls,document,refresh:()=>observer(),point:node=>{pointTarget=node},start,move,
  async drop(cardIndex=0,columnIndex=0){const card=graph.cards[cardIndex];await start(cardIndex);pointTarget=graph.columns[columnIndex];await card.fire('pointermove',{clientX:12});await card.fire('pointerup',{clientX:12,buttons:0})},
  async click(card=graph.cards[0],extra={}){return document.fire('click',{target:card,...extra})},
  async routePointer(name,hit,extra={}){pointTarget=hit;const pointerId=extra.pointerId??1,captured=graph.cards.find(card=>card.hasPointerCapture(pointerId)),target=captured||hit,values={target,pointerId,...extra};const observed=await document.fire(name,values);const card=target?.closest?.('.ops-card[data-ops-customer]');const delivered=card?await card.fire(name,{...values,defaultPrevented:observed.defaultPrevented}):observed;return {target,event:delivered}},
  replace(){for(const node of [graph.board,...graph.allColumns,...graph.cards])node.isConnected=false;graph=makeGraph();pointTarget=graph.columns[0];observer()}};
}
function taskHarness(task,options={}){
 const view=new Node(),document=new Node();let markup='',buttons=[];
 Object.defineProperty(view,'innerHTML',{get:()=>markup,set:value=>{markup=value;buttons=[...value.matchAll(/data-ops="toggle" data-id="([^"]+)"/g)].map(match=>new Node({id:match[1]}));buttons.push(...[...value.matchAll(/data-ops-ai-action="([^"]+)" data-id="([^"]+)"/g)].map(match=>new Node({opsAiAction:match[1],id:match[2]})))}});
 view.querySelectorAll=selector=>selector==='[data-ops="toggle"]'?buttons.filter(button=>!button.dataset.opsAiAction):selector==='[data-ops-ai-action]'?buttons.filter(button=>button.dataset.opsAiAction):[];
 view.querySelector=selector=>selector==='.ops-task-list'?{}:null;
 document.querySelector=selector=>selector==='#viewContainer'?view:null;
 const calls={persist:0,flush:0,action:[],toast:[]};
 const host={state:{view:options.view||'operations',settings:{operatingTasks:options.tasks||(task?[task]:[]),optionLists:{phases:options.phases||[]}},customers:options.customers||[],...(options.state||{})},persist(){calls.persist++},async flushStateWrites(){calls.flush++;if(options.failWrite)throw new Error('isolated-write-failure')},toast(...args){calls.toast.push(args)},async requestText(){return '隔离人工确认的实际结果'},async followupAction(payload){calls.action.push(payload);if(options.action) return options.action(payload);if(options.failAction)throw Error('isolated-action-failure');return {task:core.applyFollowupAction(task,payload.action,{result:payload.result})}},closeModal(){}};
 const chartCalls=[];
 const window=new Node();window.__zhikeRegistryHost=host;window.ZhikeOperationsCore=core;window.ZhikeMetricsCharts=Object.fromEntries(Object.entries(charts).map(([kind,render])=>[kind,input=>{chartCalls.push({kind,input:structuredClone(input)});return render(input)}]));
 const clock=options.now?class extends Date{constructor(...args){super(...(args.length?args:[options.now]))}static now(){return new Date(options.now).getTime()}}:Date;
 vm.runInNewContext(source('operations-ui.js'),{window,document,Date:clock,structuredClone,setTimeout,clearTimeout,requestAnimationFrame:handler=>handler(),console});
 return {task,host,calls,chartCalls,markup:()=>markup,button:action=>buttons.find(button=>action?button.dataset.opsAiAction===action:!button.dataset.opsAiAction)};
}
function taskInsight(harness){const match=harness.markup().match(/<aside class="ops6-task-insight">([\s\S]*?)<\/aside>/);assert.ok(match,'actual task page renders its insight panel');return match[1]}
const completed=[];
async function test(name,run){await run();completed.push(name);console.log('[PASS] '+name)}
(async()=>{
 await test('actual pointer drag stores the canonical stage data, independent of decorated visible label',async()=>{
  const h=stageHarness({label:'● 成交客户 · 7 位 / 查看全部'});await h.drop();assert.equal(h.c.phase,'成交客户');assert.equal(h.c.phaseHistory[0].to,'成交客户');assert.equal(h.calls.snapshot,1);assert.equal(h.calls.flush,1);
 });
 await test('same canonical stage is a no-op with no snapshot, persistence or activity',async()=>{
  const h=stageHarness({customer:{phase:'成交客户'},label:'● 成交客户 · 1 位'});await h.drop();assert.equal(h.calls.snapshot,0);assert.equal(h.calls.persist,0);assert.equal(h.calls.flush,0);assert.equal(h.host.state.activities.length,1);
 });
 await test('unset stage follows the existing core stageColumns identity and is a no-op',async()=>{
  const h=stageHarness({target:'未设置',label:'未设置',customer:{phase:''}});assert.equal(core.stageColumns([h.c],[])[0].name,'未设置');await h.drop();assert.equal(h.calls.flush,0);assert.equal(h.c.phase,'');
 });
 await test('a target lacking its canonical stage cannot derive a writable stage from text',async()=>{
  const h=stageHarness({label:'成交客户'});delete h.columns[0].dataset.stageName;await h.drop();assert.equal(h.calls.flush,0);assert.equal(h.c.phase,'新客户');
 });
 await test('snapshot refusal makes no customer, history or activity changes',async()=>{
  const h=stageHarness({authorized:false});const before=JSON.stringify(h.host.state);await h.drop();assert.equal(JSON.stringify(h.host.state),before);assert.equal(h.calls.persist,0);assert.equal(h.calls.flush,0);
 });
 await test('failed existing flush restores the entire customer and activity history',async()=>{
  const h=stageHarness({failWrite:true});const before=JSON.stringify(h.host.state);await h.drop();assert.equal(JSON.stringify(h.host.state),before);assert.equal(h.calls.flush,1);assert.ok(h.calls.toast.some(row=>row[1]==='x'));assert.equal(h.c.touched,undefined);
 });
 await test('external drops and deleted customer cards cannot trigger a write',async()=>{
  const h=stageHarness();await h.columns[0].fire('drop');assert.equal(h.calls.snapshot,0);h.c.deleted=true;await h.drop();assert.equal(h.calls.snapshot,0);
 });
 await test('repeated real refresh does not multiply pointer subscriptions or retain a native stage drag engine',async()=>{
  const h=stageHarness();for(let index=0;index<20;index++)h.refresh();assert.equal(h.card.listeners.get('pointerdown').length,1);assert.equal(h.card.listeners.get('pointermove').length,1);assert.equal(h.card.listeners.get('pointerup').length,1);assert.equal(h.card.draggable,false);assert.equal(h.card.listeners.get('dragstart'),undefined);assert.equal(h.columns[0].listeners.get('drop'),undefined);await h.drop();assert.equal(h.calls.flush,1);
 });
 await test('overlapping drops for one customer have one in-flight snapshot and commit',async()=>{
  let release,started;const gate=new Promise(resolve=>{release=resolve}),snapshotStarted=new Promise(resolve=>{started=resolve}),h=stageHarness({snapshot:()=>{started();return gate}});
  const first=h.drop();let second;
  try{await snapshotStarted;second=h.drop();await second;assert.equal(h.calls.snapshot,1,'A second drag while the first awaits authorization must not initiate another write')}
  finally{release(true);await Promise.all([first,second].filter(Boolean))}
  assert.equal(h.calls.flush,1);assert.equal(h.c.phaseHistory.length,1);
  h.columns[0].dataset.stageName='意向客户';await h.drop();assert.equal(h.calls.flush,2,'A completed save releases the single-flight guard');assert.equal(h.c.phase,'意向客户');
 });
 await test('failed stage persistence releases its guard for a later valid retry',async()=>{
  const options={failWrite:true},h=stageHarness(options);await h.drop();assert.equal(h.c.phase,'新客户');options.failWrite=false;await h.drop();assert.equal(h.c.phase,'成交客户');assert.equal(h.calls.flush,2);assert.equal(h.c.phaseHistory.length,1);
 });
 await test('different-customer drops cannot overlap an activity snapshot rollback',async()=>{
  let started,failFirst;const firstStarted=new Promise(resolve=>{started=resolve}),firstWrite=new Promise((resolve,reject)=>{failFirst=reject});firstWrite.catch(()=>{});
  const other={id:'customer-b',name:'隔离客户B',phase:'新客户',phaseHistory:[]},h=stageHarness({otherCustomers:[other],targets:['成交客户','意向客户'],flush:count=>{if(count===1){started();return firstWrite}return Promise.resolve()}});
  const first=h.drop();await firstStarted;await h.drop(1,1);const concurrentCommit=h.calls.flush>1;failFirst(Error('isolated-first-write-failure'));await first;
  console.log(JSON.stringify({observation:'actual-stage-overlap',concurrentCommit,otherPhase:other.phase,otherAuditPresent:h.host.state.activities.some(row=>row.label?.includes('隔离客户B'))}));
  assert.equal(h.calls.snapshot,1,'Stage writes must have one global in-flight boundary because rollback restores the shared activity snapshot');
  assert.equal(other.phase,'新客户');assert.equal(h.c.phase,'新客户');assert.equal(h.host.state.activities.length,1);
  await h.drop(1,1);assert.equal(other.phase,'意向客户');assert.equal(h.calls.flush,2);assert.ok(h.host.state.activities.some(row=>row.label?.includes('隔离客户B')));
 });
 await test('subthreshold pointer movement preserves the original button click and never captures or writes',async()=>{
  const h=stageHarness(),down=await h.start(),move=await h.move(5,0),up=await h.card.fire('pointerup',{clientX:5,buttons:0});
  assert.equal(down.defaultPrevented,false);assert.equal(move.defaultPrevented,false);assert.equal(up.defaultPrevented,false);assert.equal(h.card.captured.size,0);assert.equal(h.card.tagName,'BUTTON');
  await h.click();assert.equal(h.calls.open,1);assert.equal(h.calls.snapshot,0);assert.equal(h.card.classList.contains('is-stage-dragging'),false);
 });
 await test('actual uncaptured edge-leave routing ends outside release and cannot strand the next customer gesture',async()=>{
  const h=stageHarness({otherCustomers:[{id:'edge-b',name:'边缘后另一个合成客户',phase:'新客户',phaseHistory:[]}]}),outside=new Node();
  await h.routePointer('pointerdown',h.card,{clientX:95});const moved=await h.routePointer('pointermove',outside,{clientX:98});const released=await h.routePointer('pointerup',outside,{clientX:98,buttons:0});
  assert.equal(moved.target,outside,'Before capture the pointer move belongs to the actual outside hit, not the source card');assert.equal(released.target,outside);assert.equal(moved.event.defaultPrevented,false);assert.equal(released.event.defaultPrevented,false);assert.equal(h.card.captured.size,0);await h.click(outside);assert.equal(h.calls.open,0,'Releasing outside before the threshold must not become a source-card activation');
  await h.drop(1,0);assert.equal(h.calls.flush,1,'The outside pointerup must clear the pending gesture so another customer can drag');assert.equal(h.host.state.customers[1].phase,'成交客户');assert.equal(h.c.phase,'新客户');assert.equal((h.document.listeners.get('pointermove')||[]).length,0);assert.equal((h.document.listeners.get('pointerup')||[]).length,0);
 });
 await test('an outside first sample may cross the threshold; subsequent events route by capture and cancellation removes pending listeners',async()=>{
  const h=stageHarness();await h.routePointer('pointerdown',h.card,{clientX:95});await h.routePointer('pointermove',h.columns[0],{clientX:104});assert.equal(h.card.hasPointerCapture(1),true);assert.equal((h.document.listeners.get('pointermove')||[]).length,0);const released=await h.routePointer('pointerup',h.columns[0],{clientX:104,buttons:0});assert.equal(released.target,h.card);assert.equal(h.calls.flush,1);
  const x=stageHarness(),outside=new Node();await x.routePointer('pointerdown',x.card,{clientX:95});await x.routePointer('pointercancel',outside,{clientX:98,buttons:0});assert.equal((x.document.listeners.get('pointermove')||[]).length,0);assert.equal((x.document.listeners.get('pointerup')||[]).length,0);assert.equal((x.document.listeners.get('pointercancel')||[]).length,0);await x.drop();assert.equal(x.calls.flush,1);
 });
 await test('six effective pixels starts capture and source-only drag feedback without moving DOM nodes',async()=>{
  const h=stageHarness(),parent=h.card.parentElement;await h.start();const move=await h.move(6,0);
  assert.equal(move.defaultPrevented,true);assert.equal(h.card.hasPointerCapture(1),true);assert.equal(h.card.classList.contains('is-stage-dragging'),true);assert.equal(h.columns[0].classList.contains('drag-target'),true);assert.equal(h.card.parentElement,parent);
  await h.card.fire('pointerup',{clientX:6,buttons:0});assert.equal(h.calls.flush,1);assert.equal(h.card.captured.size,0);assert.equal(h.card.classList.contains('is-stage-dragging'),false);assert.equal(h.columns[0].classList.contains('drag-target'),false);
 });
 await test('only the immediate source post-drag click is suppressed; the next normal tap still opens',async()=>{
  const h=stageHarness();await h.drop();const dragClick=await h.click();assert.equal(dragClick.defaultPrevented,true);assert.equal(dragClick.stopped,true);assert.equal(h.calls.open,0);
  await h.start();await h.card.fire('pointerup',{buttons:0});await h.click();assert.equal(h.calls.open,1);assert.equal(h.calls.flush,1);
 });
 await test('a drag without browser click cannot consume a later genuine tap or keyboard activation',async()=>{
  const h=stageHarness();await h.drop();await h.start();await h.card.fire('pointerup',{buttons:0});await h.click();assert.equal(h.calls.open,1);
  h.columns[0].dataset.stageName='意向客户';await h.drop();await h.document.fire('keydown',{key:'Enter'});const keyboard=await h.click(h.card,{detail:0});assert.equal(keyboard.defaultPrevented,false);assert.equal(h.calls.open,2);
 });
 await test('right-button and nonprimary pointers retain ordinary input and never start a stage move',async()=>{
  for(const extra of [{button:2},{isPrimary:false}]){const h=stageHarness();const down=await h.start(0,extra);await h.move();await h.card.fire('pointerup',{clientX:12,buttons:0});assert.equal(down.defaultPrevented,false);assert.equal(h.calls.snapshot,0);assert.equal(h.card.captured.size,0)}
 });
 await test('hit testing accepts a target child but never an outside board or detached column',async()=>{
  const h=stageHarness(),child=new Node();child.parentElement=h.columns[0];await h.start();h.point(child);await h.move();await h.card.fire('pointerup',{clientX:12,buttons:0});assert.equal(h.c.phase,'成交客户');
  for(const outside of ['not-column','other-board','detached']){const x=stageHarness();let target=new Node({},['ops-column']);target.dataset.stageName='意向客户';if(outside==='other-board'){target.parentElement=new Node({},['ops-board']);target.parentElement.parentElement=x.view}else if(outside==='detached'){target=x.columns[0];target.isConnected=false}else target=new Node();await x.start();x.point(target);await x.move();await x.card.fire('pointerup',{clientX:12,buttons:0});assert.equal(x.calls.snapshot,0,outside)}
 });
 await test('release rechecks its actual location and cannot reuse a previously highlighted column',async()=>{
  const h=stageHarness();await h.start();await h.move();assert.equal(h.columns[0].classList.contains('drag-target'),true);h.point(null);await h.card.fire('pointerup',{clientX:900,clientY:800,buttons:0});assert.equal(h.calls.snapshot,0);assert.equal(h.columns[0].classList.contains('drag-target'),false);assert.equal(h.card.captured.size,0);
 });
 await test('pointercancel, lost capture, blur, Escape and hidden document cancel with full feedback cleanup',async()=>{
  for(const reason of ['pointercancel','lostpointercapture','blur','Escape','hidden']){const h=stageHarness();await h.start();await h.move();if(reason==='blur')await h.window.fire('blur');else if(reason==='Escape')await h.document.fire('keydown',{key:'Escape'});else if(reason==='hidden'){h.document.hidden=true;await h.document.fire('visibilitychange')}else await h.card.fire(reason);await h.card.fire('pointerup',{clientX:12,buttons:0});assert.equal(h.calls.snapshot,0,reason);assert.equal(h.card.captured.size,0,reason);assert.equal(h.card.classList.contains('is-stage-dragging'),false,reason);assert.equal(h.columns[0].classList.contains('drag-target'),false,reason);await h.click();assert.equal(h.calls.open,0,reason)}
 });
 await test('pointer identity and captured source ownership reject unrelated move, up and lost-capture events',async()=>{
  const other={id:'customer-b',name:'另一个合成客户',phase:'新客户'},h=stageHarness({otherCustomers:[other]});await h.start();await h.card.fire('pointermove',{pointerId:2,clientX:12});assert.equal(h.card.captured.size,0);await h.move();await h.cards[1].fire('lostpointercapture');await h.cards[1].fire('pointerup',{clientX:12,buttons:0});assert.equal(h.calls.snapshot,0);assert.equal(h.card.hasPointerCapture(1),true);await h.card.fire('pointerup',{clientX:12,buttons:0});assert.equal(h.calls.flush,1);assert.equal(other.phase,'新客户');
 });
 await test('a replaced view cancels its old captured card and late pointerup while fresh cards remain usable',async()=>{
  const h=stageHarness();await h.start();await h.move();const old=h.card,oldTarget=h.columns[0];h.replace();assert.equal(old.captured.size,0);assert.equal(old.classList.contains('is-stage-dragging'),false);assert.equal(oldTarget.classList.contains('drag-target'),false);await old.fire('pointerup',{clientX:12,buttons:0});assert.equal(h.calls.snapshot,0);await h.drop();assert.equal(h.calls.flush,1);
 });
 await test('changed phase, removed identity and deleted records invalidate an in-progress pointer gesture',async()=>{
  for(const reason of ['phase','identity','deleted']){const h=stageHarness();await h.start();await h.move();if(reason==='phase')h.c.phase='人工已调整';else if(reason==='identity')h.host.state.customers=[{...h.c}];else h.c.deleted=true;await h.card.fire('pointerup',{clientX:12,buttons:0});assert.equal(h.calls.snapshot,0,reason);assert.equal(h.card.captured.size,0,reason)}
 });
 await test('snapshot await cannot commit after board replacement, route exit, identity replacement or independent phase change',async()=>{
  for(const reason of ['board','route','identity','phase','target']){let release,started;const gate=new Promise(resolve=>{release=resolve}),begin=new Promise(resolve=>{started=resolve}),h=stageHarness({snapshot:()=>{started();return gate}}),pending=h.drop();await begin;if(reason==='board')h.replace();else if(reason==='route')h.host.state.view='customers';else if(reason==='identity')h.host.state.customers=[{...h.c}];else if(reason==='phase')h.c.phase='人工已调整';else h.columns[0].dataset.stageName='其他阶段';release(true);await pending;assert.equal(h.calls.snapshot,1,reason);assert.equal(h.calls.persist,0,reason);assert.equal(h.calls.flush,0,reason);assert.equal(h.c.phaseHistory.length,0,reason);assert.equal(h.host.state.activities.length,1,reason)}
 });
 await test('failed pointer capture cancels safely without consuming a normal button activation',async()=>{
  const h=stageHarness();h.card.setPointerCapture=()=>{throw Error('isolated-capture-failure')};await h.start();const move=await h.move();await h.card.fire('pointerup',{clientX:12,buttons:0});assert.equal(move.defaultPrevented,false);assert.equal(h.calls.snapshot,0);assert.equal(h.card.classList.contains('is-stage-dragging'),false);await h.click();assert.equal(h.calls.open,1);
 });
 await test('duplicate pointerup cannot commit twice and snapshot rejection releases the shared guard',async()=>{
  let fail=true;const h=stageHarness({snapshot:()=>{if(fail)throw Error('isolated-snapshot-failure');return true}});await h.drop();assert.equal(h.calls.flush,0);assert.equal(h.c.phase,'新客户');assert.ok(h.calls.toast.some(row=>row[1]==='x'));fail=false;await h.drop();await h.card.fire('pointerup',{clientX:12,buttons:0});assert.equal(h.calls.snapshot,2);assert.equal(h.calls.flush,1);assert.equal(h.c.phaseHistory.length,1);
 });
 await test('the existing phase-history cap and complete original activity/persistence chain are preserved',async()=>{
  const history=Array.from({length:105},(_,index)=>({from:'旧'+index,to:'新客户',at:'2026-01-01'})),h=stageHarness({customer:{phaseHistory:history}});await h.drop();assert.equal(h.c.phaseHistory.length,100);assert.equal(h.c.phaseHistory[0].from,'旧6');assert.equal(h.c.phaseHistory.at(-1).from,'新客户');assert.equal(h.c.phaseHistory.at(-1).to,'成交客户');assert.equal(h.calls.persist,1);assert.equal(h.calls.flush,1);assert.equal(h.calls.render,1);assert.equal(h.host.state.activities.length,2);
 });
 await test('eligible home second heading moves before the first with the exact existing local preference key and no business writes',async()=>{
  const h=homeHarness();await h.drag();assert.deepEqual(h.main.children,[h.second.card,h.first.card]);assert.deepEqual(h.calls.writes,[{key:'zhike-layout-home-main',value:['home-main-1','home-main-0']}]);assert.equal(h.first.heading.draggable,false);assert.equal(h.second.heading.draggable,false);assert.deepEqual([h.calls.persist,h.calls.flush,h.calls.snapshot,h.calls.activity],[0,0,0,0]);
 });
 await test('home bottom reordering keeps insertBefore semantics and cannot target the other layout group',async()=>{
  const h=homeHarness();await h.drag(h.all[3],h.all[2].card);assert.deepEqual(h.bottom.children,[h.all[3].card,h.all[2].card]);assert.equal(h.calls.writes[0].key,'zhike-layout-home-bottom');const count=h.calls.writes.length;await h.drag(h.second,h.all[2].card);assert.equal(h.calls.writes.length,count);assert.deepEqual(h.main.children,[h.first.card,h.second.card]);
 });
 await test('home subthreshold tap, outside release, cancellation and route exit preserve layout and clear the shared gesture',async()=>{
  for(const reason of ['tap','outside','cancel','blur','Escape','route']){const h=homeHarness(),outside=new Node();await h.route('pointerdown',h.second.heading,{clientX:95});if(reason==='tap'||reason==='outside'){const hit=reason==='tap'?h.second.heading:outside;const moved=await h.route('pointermove',hit,{clientX:98});const released=await h.route('pointerup',hit,{clientX:98,buttons:0});assert.equal(moved.event.defaultPrevented,false);assert.equal(released.event.defaultPrevented,false)}else{await h.route('pointermove',h.first.card,{clientX:104});if(reason==='cancel')await h.route('pointercancel',h.first.card);else if(reason==='blur')await h.window.fire('blur');else if(reason==='Escape')await h.document.fire('keydown',{key:'Escape'});else{h.host.state.view='customers';h.refresh()}await h.route('pointerup',h.first.card,{clientX:104,buttons:0})}assert.equal(h.calls.writes.length,0,reason);assert.equal(h.second.heading.captured.size,0,reason);assert.equal(h.second.heading.classList.contains('is-home-dragging'),false,reason);assert.equal(h.first.card.classList.contains('home-drag-target'),false,reason);h.host.state.view='home';h.refresh();await h.drag();assert.equal(h.calls.writes.length,1,reason)}
 });
 await test('home pointer feedback uses only eligible headings and no native HTML drag handlers',async()=>{
  const h=homeHarness();for(let index=0;index<20;index++)h.refresh();assert.equal(h.second.heading.listeners.get('pointerdown').length,1);assert.equal(h.second.heading.listeners.get('dragstart'),undefined);assert.equal(h.first.card.listeners.get('drop'),undefined);await h.route('pointerdown',h.second.heading);await h.route('pointermove',h.first.card,{clientX:6});assert.equal(h.second.heading.classList.contains('is-home-dragging'),true);assert.equal(h.first.card.classList.contains('home-drag-target'),true);await h.route('pointerup',h.first.card,{clientX:6,buttons:0});const postClick=await h.document.fire('click',{target:h.second.heading,detail:1});assert.equal(postClick.defaultPrevented,true);await h.route('pointerdown',h.second.heading);await h.route('pointerup',h.second.heading,{buttons:0});const tap=await h.document.fire('click',{target:h.second.heading,detail:1});assert.equal(tap.defaultPrevented,false);
 });
 await test('home existing saved order, hide/save and reset handlers retain exact local keys without CRM persistence',async()=>{
  const h=homeHarness({storage:{'zhike-layout-home-main':['home-main-1','home-main-0'],'zhike-home-hidden':['home-bottom-0']}});assert.deepEqual(h.main.children,[h.second.card,h.first.card]);assert.equal(h.all[2].card.hidden,true);h.openLayout();h.saveHidden(['home-main-0']);assert.deepEqual(JSON.parse(h.storage.get('zhike-home-hidden')),['home-main-0']);h.openLayout();h.reset();assert.deepEqual(JSON.parse(h.storage.get('zhike-layout-home-main')),[]);assert.deepEqual(JSON.parse(h.storage.get('zhike-layout-home-bottom')),[]);assert.deepEqual(JSON.parse(h.storage.get('zhike-home-hidden')),[]);assert.equal(h.calls.render,2);assert.deepEqual([h.calls.persist,h.calls.flush,h.calls.snapshot,h.calls.activity],[0,0,0,0]);
 });
 await test('home stale replaced owner cannot persist a pending move or make unrelated dashboard content reorderable',async()=>{
  const h=homeHarness(),dashboard=new Node({},['home-dashboard-grid']);dashboard.parentElement=h.view;const unrelated=new Node({},['panel']);unrelated.parentElement=dashboard;await h.route('pointerdown',h.second.heading);h.second.heading.isConnected=false;h.refresh();await h.route('pointermove',h.first.card,{clientX:12});await h.route('pointerup',h.first.card,{clientX:12,buttons:0});assert.equal(h.calls.writes.length,0);h.second.heading.isConnected=true;await h.drag(h.second,unrelated);assert.equal(h.calls.writes.length,0);assert.equal(dashboard.dataset.reorderReady,undefined);
 });
 await test('home nested heading buttons and card body keep their original input instead of starting a layout gesture',async()=>{
  const h=homeHarness(),action=new Node();action.parentElement=h.second.heading;
  for(const sourceNode of [action,h.second.card]){const down=await h.route('pointerdown',sourceNode);const moved=await h.route('pointermove',h.first.card,{clientX:12});const released=await h.route('pointerup',h.first.card,{clientX:12,buttons:0});assert.equal(down.event.defaultPrevented,false);assert.equal(moved.event.defaultPrevented,false);assert.equal(released.event.defaultPrevented,false);assert.equal(h.calls.writes.length,0);assert.equal(h.second.heading.captured.size,0)}
 });
 await test('one shared home gesture owns its source until cancellation and cannot begin a second layout write',async()=>{
  const h=homeHarness();await h.route('pointerdown',h.second.heading);await h.route('pointerdown',h.all[3].heading);await h.route('pointermove',h.all[2].card,{clientX:12});await h.route('pointerup',h.all[2].card,{clientX:12,buttons:0});assert.equal(h.calls.writes.length,0);assert.deepEqual(h.bottom.children,[h.all[2].card,h.all[3].card]);await h.drag(h.all[3],h.all[2].card);assert.equal(h.calls.writes.length,1);assert.equal(h.calls.writes[0].key,'zhike-layout-home-bottom');
 });
 await test('manual task registered action uses the existing status fields and persists once',async()=>{
  const task={id:'manual-a',title:'隔离人工任务',done:false,status:'open',updatedAt:'before'};const h=taskHarness(task);await h.button().fire('click');assert.equal(task.done,true);assert.equal(task.status,'done');assert.equal(h.calls.flush,1);assert.equal(h.calls.action.length,0);
 });
 await test('manual task failure restores its original completion state',async()=>{
  const task={id:'manual-a',title:'隔离人工任务',done:false,status:'open',updatedAt:'before'};const before=JSON.stringify(task),h=taskHarness(task,{failWrite:true});await h.button().fire('click');assert.equal(JSON.stringify(task),before);assert.equal(h.calls.flush,1);assert.ok(h.calls.toast.some(row=>row[1]==='x'));
 });
 await test('AI action uses the original follow-up boundary without local task writes',async()=>{
  const task={id:'ai-a',title:'隔离AI任务',aiGenerated:true,status:'open',done:false,customerId:'known',wsAccountId:'isolated-a'};const h=taskHarness(task);await h.button('dismiss').fire('click');assert.equal(h.calls.action.length,1);assert.equal(h.calls.action[0].accountId,'isolated-a');assert.equal(h.calls.action[0].customerId,'known');assert.equal(task.status,'dismissed');assert.equal(h.calls.flush,0);
 });
 await test('AI action failure restores all original task fields',async()=>{
  const task={id:'ai-a',title:'隔离AI任务',aiGenerated:true,status:'open',done:false,nested:{stable:true}};const before=JSON.stringify(task),h=taskHarness(task,{failAction:true});await h.button('dismiss').fire('click');assert.equal(JSON.stringify(task),before);assert.equal(h.calls.action.length,1);assert.ok(h.calls.toast.some(row=>row[1]==='x'));
 });
 await test('actual empty stage board has no fabricated positive distribution lengths',async()=>{
  const h=taskHarness(null,{view:'stage-board',phases:['新客户','成交客户']});const shares=[...h.markup().matchAll(/--ops-stage-share:([\d.]+)%/g)].map(match=>Number(match[1]));assert.deepEqual(shares,[0,0]);
 });
 await test('actual populated board distribution preserves true counts and zero-member stages',async()=>{
  const h=taskHarness(null,{view:'stage-board',phases:['新客户','成交客户','暂停跟进'],customers:[{id:'a',name:'A',phase:'新客户'},{id:'b',name:'B',phase:'成交客户'}]});const shares=[...h.markup().matchAll(/--ops-stage-share:([\d.]+)%/g)].map(match=>Number(match[1]));assert.deepEqual(shares,[50,50,0]);assert.ok(h.markup().includes('2 位客户 · 3 个阶段'));
 });
 await test('manual task insight identifies human provenance and labels its due value as a deadline',async()=>{
  const task={id:'manual-insight',title:'人工核对资料',due:'2020-01-02',note:'本人安排 <资料核对>',objective:'确认登记',done:false,status:'open'},before=JSON.stringify(task),h=taskHarness(task),html=taskInsight(h);
  assert.match(html,/<strong>任务详情<\/strong>/);assert.match(html,/人工创建/);assert.match(html,/任务备注[\s\S]*本人安排 &lt;资料核对&gt;/);assert.match(html,/任务目标[\s\S]*确认登记/);assert.match(html,/<span>截止日期<\/span><strong>2020-01-02<\/strong>/);
  assert.doesNotMatch(html,/AI 跟进建议|最佳联系窗口|AI 提供的联系窗口|建议话题|避免重复/);assert.equal(JSON.stringify(task),before);assert.equal(h.calls.persist,0);assert.equal(h.calls.action.length,0);
 });
 await test('manual task missing details do not become invented AI advice',async()=>{
  const h=taskHarness({id:'manual-empty',title:'人工待安排',aiGenerated:false,done:false,status:'open'}),html=taskInsight(h);
  assert.match(html,/<strong>任务详情<\/strong>/);assert.match(html,/人工创建/);assert.match(html,/<span>截止日期<\/span><strong>未设置<\/strong>/);
  assert.doesNotMatch(html,/AI 跟进建议|最佳联系窗口|按客户当前状态安排沟通|查看档案中的已知信息/);assert.equal(h.calls.persist,0);
 });
 await test('AI task keeps provided advice but a task deadline is not an inferred contact window',async()=>{
  const task={id:'ai-insight',title:'已有分析形成的任务',aiGenerated:true,due:'2026-12-03',scoreReason:'客户明确要求回复',suggestedOpener:'已核实的话题 <方案>',avoidTopics:['已询问职业'],done:false,status:'open'},before=JSON.stringify(task),h=taskHarness(task),html=taskInsight(h);
  assert.match(html,/<strong>AI 跟进建议<\/strong>/);assert.match(html,/AI 生成/);assert.match(html,/客户明确要求回复/);assert.match(html,/已核实的话题 &lt;方案&gt;/);assert.match(html,/已询问职业/);assert.match(html,/<span>截止日期<\/span><strong>2026-12-03<\/strong>/);
  assert.doesNotMatch(html,/最佳联系窗口|AI 提供的联系窗口|人工创建/);assert.equal(JSON.stringify(task),before);assert.equal(h.calls.action.length,0);
 });
 await test('AI task absent evidence stays explicitly unprovided instead of default generated advice',async()=>{
  const h=taskHarness({id:'ai-empty',title:'缺少详情的既有AI任务',aiGenerated:true,done:false,status:'open'}),html=taskInsight(h);
  assert.match(html,/<strong>AI 跟进建议<\/strong>/);assert.match(html,/<span>建议话题<\/span><strong>未提供<\/strong>/);assert.match(html,/<span>避免重复<\/span><strong>未提供<\/strong>/);assert.match(html,/<span>截止日期<\/span><strong>未设置<\/strong>/);
  assert.doesNotMatch(html,/最佳联系窗口|AI 提供的联系窗口|按客户当前状态安排沟通|查看档案中的已知信息/);assert.equal(h.calls.persist,0);
 });
 await test('no selected task does not imply an AI recommendation exists',async()=>{
  const h=taskHarness(null),html=taskInsight(h);assert.match(html,/<strong>任务详情<\/strong>/);assert.match(html,/当前没有待处理任务/);assert.doesNotMatch(html,/AI 跟进建议|最佳联系窗口/);assert.equal(h.calls.persist,0);
 });
 await test('task completion uses the exact existing completed/open boundary, excludes dismissed and remains global under filtering',async()=>{
  const tasks=[{id:'done',done:true,status:'done'},{id:'completed',done:false,status:'completed'},{id:'closed',done:false,status:'closed'},{id:'legacy',done:true,status:'open'},{id:'open',done:false,status:'open'},{id:'snoozed',done:false,status:'snoozed'},{id:'queued',done:false,status:'queued'},{id:'dismissed',done:true,status:'dismissed'},{id:'ignored',done:false,status:'ignored'}].map(task=>({...task,title:'合成任务 '+task.id}));
  const before=JSON.stringify(tasks),h=taskHarness(null,{tasks,state:{opsTaskFilter:'done'}}),call=h.chartCalls.find(row=>row.kind==='renderProgress'&&row.input.id==='operations-task-completion');
  assert.ok(call,'The actual task page must call the shipped S2 progress renderer.');assert.equal(call.input.current,4);assert.equal(call.input.total,7);assert.equal(call.input.status,'available');assert.match(h.markup(),/任务完成率/);assert.match(h.markup(),/已忽略.*2.*不计入分母/);assert.match(h.markup(),/aria-valuenow="57\.142857/);assert.equal(JSON.stringify(tasks),before);assert.equal(h.calls.persist,0);assert.equal(h.calls.flush,0);
 });
 await test('zero task denominator is explicitly uncomputable and cannot draw a fabricated zero-percent progress',async()=>{
  for(const tasks of [[],[{id:'excluded',title:'合成忽略',done:true,status:'dismissed'}]]){const h=taskHarness(null,{tasks}),call=h.chartCalls.find(row=>row.kind==='renderProgress');assert.ok(call);assert.equal(call.input.current,0);assert.equal(call.input.total,0);assert.equal(call.input.status,'empty');assert.match(h.markup(),/暂无可计算/);assert.doesNotMatch(h.markup(),/role="progressbar"/);assert.equal(h.calls.persist,0)}
 });
 await test('stage recorded activity aggregates only verified local-window transitions and preserves legacy stage names without writes',async()=>{
  const at=(day,hour=10)=>new Date(2026,10,day,hour,0,0).toISOString(),now=at(17,12),history=[{from:'新客户',to:'潜在客户',at:at(11)},{from:'旧阶段名',to:'已归档旧阶段',at:at(17)},{from:'新客户',to:'潜在客户',at:at(10)},{from:'新客户',to:'潜在客户',at:at(18)},{from:'新客户',to:'潜在客户',at:at(17,23)},{from:'新客户',to:'潜在客户',at:'2026-02-31T10:00:00Z'},{from:'新客户',to:'潜在客户',at:'2026-11-17T24:00:00Z'},{from:'',to:'潜在客户',at:at(17)},{from:'新客户',to:'新客户',at:at(17)},{from:'新客户',to:'潜在客户',at:'2026-11-17'},{from:'新客户',to:'潜在客户',at:'2026-11-17T10:00:60Z'}],customers=[{id:'active',name:'合成有效客户',phase:'潜在客户',phaseHistory:history},{id:'deleted',name:'合成已删除',deleted:true,phaseHistory:[{from:'新客户',to:'成交客户',at:at(17)}]}],before=JSON.stringify(customers),h=taskHarness(null,{view:'stage-board',customers,now,phases:['新客户','潜在客户']}),call=h.chartCalls.find(row=>row.kind==='renderBars'&&row.input.id==='stage-recorded-activity');
  assert.ok(call,'The actual stage page must use the existing S2 SVG renderer.');assert.equal(call.input.status,'available');assert.deepEqual(call.input.items.map(row=>row.label),['11-11','11-12','11-13','11-14','11-15','11-16','11-17']);assert.deepEqual(call.input.items.map(row=>row.value),[1,0,0,0,0,0,1]);assert.match(h.markup(),/已记录流转/);assert.match(h.markup(),/不代表完整历史/);assert.match(h.markup(),/非去重人数/);assert.equal(JSON.stringify(customers),before);assert.deepEqual([h.calls.persist,h.calls.flush,h.calls.action.length],[0,0,0]);
 });
 await test('stage history absent or entirely invalid stays empty without inventing a seven-day baseline',async()=>{
  for(const phaseHistory of [undefined,[],[{from:'新客户',to:'潜在客户',at:'bad'}],[{from:'新客户',to:'潜在客户',at:'2026-11-17'}]]){const customers=[{id:'known',name:'合成既有客户',phase:'成交客户',phaseHistory}],h=taskHarness(null,{view:'stage-board',customers,now:new Date(2026,10,17,12).toISOString()}),call=h.chartCalls.find(row=>row.kind==='renderBars');assert.ok(call);assert.equal(call.input.status,'empty');assert.deepEqual(call.input.items,[]);assert.match(h.markup(),/暂无.*记录/);assert.doesNotMatch(h.markup(),/class="zk-metrics-bar"|data-value="[1-9]/);assert.equal(h.calls.persist,0)}
 });
 console.log(JSON.stringify({suite:'delivery-s3-actual-operations-handlers',passed:completed.length,actualShippedModules:true,syntheticHostOnly:true,realBrowser:false,realService:false,realDatabase:false,realWhatsApp:false}));
})().catch(error=>{console.error(error);process.exitCode=1});
