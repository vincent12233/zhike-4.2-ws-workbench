'use strict';
// Actual shipped shell, main renderers and stylesheet order in an isolated
// browser profile. Fixtures are explicitly synthetic; no service is started.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createContrastInspector } = require('../../tests/helpers/visual-contrast.cjs');
const { runIsolatedRenderer, recordVisualAssertions } = require('../../tests/helpers/isolated-renderer.cjs');
const repo = path.resolve(__dirname, '../..');
const app = path.join(repo, 'resources/app');
const evidence = path.resolve(process.env.ZHIKE_VISUAL_EVIDENCE || path.join(repo, '.tools/visual-usability/main-visual'));
fs.mkdirSync(evidence, { recursive: true });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhike-s1-main-style-'));
const edge = [process.env.ZHIKE_TEST_EDGE, path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'), path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe')].filter(Boolean).find(fs.existsSync);
if (process.env.ZHIKE_VISUAL_BACKEND === 'edge' || process.env.ZHIKE_GPT_VISUAL_ONLY === '1') assert.ok(edge, 'Real Edge required for computed style and visibility checks');
const source = fs.readFileSync(path.join(app, 'app.js'), 'utf8');
const boot = /  initializeBackend\(\);\s*  startDataSync\(\);/;
assert.match(source, boot, 'Only the real backend bootstrap may be suppressed');
const renderSource = source.replace(boot, '  window.__visualFixture={state,render,today,markMetricsFixtureLoaded:()=>completeMetricsRead(beginMetricsRead(),\'applied\')};');
const original = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
let shell = original.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
shell = shell.replace('<head>', '<head><base href="' + pathToFileURL(app + path.sep).href + '">');
const dependencies = ['customer-avatar.js', 'ticket-record-core.js', 'business-rule-core.js', 'metrics-charts.js'];
const safeScript = value => value.replace(/<\/script/gi, '<\\/script');
const script = value => '<script>' + safeScript(value) + '</script>';
const fixtureScript = createContrastInspector.toString() + "\n" + String.raw`
const fixture=window.__visualFixture;
const query=new URLSearchParams(location.search);
const palette=query.get('palette')||'atelier-dawn';
const legacyTheme=query.get('legacyTheme')||(palette==='horizon-night'?'dark':'light');
const day=fixture.today;
const fixtureRows=Array.from({length:18},(_,i)=>({id:'VISUAL_'+i,name:'隔离布局客户 '+(i+1),phone:'91900'+String(i).padStart(7,'0'),rawPhone:'+91 900 '+String(i).padStart(7,'0'),source:i%2?'单导':'群粉',page:'隔离布局',assistant:'布局测试',phase:i%2?'意向客户':'新客户',qualification:'B级｜中等',status:'未进群',registered:day,due:day,deleted:false,vip:i<2,hot:i<4,notes:'仅用于字体、表格和布局验收，不是真实客户资料。'}));
Object.assign(fixture.state,{customers:fixtureRows,activities:[{id:'visual-event',time:'10:30',text:'隔离视觉夹具已加载；无生产数据库、WS 或 AI 连接。'}],followups:[],tickets:[],deposits:[{id:'VISUAL_DEPOSIT',customerId:fixtureRows[0].id,date:day,amount:1250,currency:'INR',status:'已确认'}],registrations:[]});
// Simulate the fixture state being accepted through the existing provenance path.
fixture.markMetricsFixtureLoaded();
fixture.state.settings={...fixture.state.settings,theme:'light',density:'comfortable',motion:'off',operatingTasks:[{id:'VISUAL_TASK',title:'隔离布局任务',status:'pending',stage:'待联系',customerId:'VISUAL_0',customerName:'隔离布局客户 1',due:day,createdAt:new Date().toISOString()}]};
document.documentElement.dataset.palette=palette;
document.documentElement.dataset.theme=legacyTheme;
document.documentElement.dataset.motion='off';
window.ZhikeWorkspaceShell.setPalette(palette);
const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
const type=e=>{if(!e)return null;const s=getComputedStyle(e);return {font:s.fontSize,color:s.color,background:s.backgroundColor,backgroundImage:s.backgroundImage,radius:s.borderRadius,display:s.display,visibility:s.visibility}};
const visible=e=>!!e&&rect(e).width>0&&rect(e).height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
// Inspect computed background layers using the shared WS/GPT sampler.
const {backgroundColors:backgroundSamples}=createContrastInspector(node=>getComputedStyle(node));
const contrastSelectors='.metric-label,.metric-value,.metric-note,.metric-foot,.digital-horizon-brand,.digital-horizon-context span,.digital-horizon-context time,.digital-horizon-reading,.digital-horizon-reading time,.horizon-kpi-heading,.horizon-kpi strong,.horizon-kpi small,.governance-hero-signal span,.governance-hero-signal strong,.governance-hero-signal small,.business6-signal span,.business6-signal strong,.business6-signal small,.business-kpi span,.business-kpi strong,.summary-tile span,.summary-tile strong,.summary-tile small,.ops-stage-open strong,.btn.primary,.table-action,.page-btn.active,.ops-priority,.ops-card-link,.ops-card strong,.ops-card-meta .overdue,.ops-task-copy>strong,.ops-task-copy p,.ops-task-meta,.data-table th,.task-table th,.data-table td,.status-tag,.tag,.quality-tag,.panel-note,.page-subtitle,.rule-hint,.muted-cell,.empty-state,.empty-state p,.empty-state span,.notice-line,.filter-field>span,.filter-field>label,.source-defaults>label,.settings-section label,.settings-section p,.funnel-bar,.horizon-flow-source,.horizon-flow-description,.horizon-process-step span,.horizon-spotlight-capabilities small,.ops6-command-rule p,.ops6-command-rule summary,.ops6-task-insight-rows span,.ops6-task-insight-rows strong,.ops6-column-more,.ops-stage-open small,.ops-stage-open em';
function contrastSamples(container,selectors=contrastSelectors){return [...container.querySelectorAll(selectors)].filter(e=>visible(e)&&!e.closest(':disabled,[aria-disabled="true"]')&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>({selector:e.tagName.toLowerCase()+'.'+e.className,text:e.textContent.trim().slice(0,40),foreground:getComputedStyle(e).color,backgrounds:backgroundSamples(e)}));}
function componentSamples(){const probe=document.createElement('section');probe.dataset.synthetic='isolated-component-cascade';probe.innerHTML='<div class="ops-card"><strong>隔离任务卡片</strong><a class="ops-card-link">任务链接</a><div class="ops-card-meta"><span class="overdue">逾期待办</span></div></div><div class="ops-task done"><div class="ops-task-copy"><strong>隔离已完成任务</strong><p>完成结果仍应清晰可读</p></div></div>'+['high','normal','low'].map(value=>'<span class="ops-priority '+value+'">隔离优先级 '+value+'</span>').join('')+['blue','green','amber','red','coral','gray'].map(value=>'<span class="status-tag tag-'+value+'">隔离状态 '+value+'</span>').join('');document.getElementById('viewContainer').appendChild(probe);const result=contrastSamples(probe);const completedOpacity=getComputedStyle(probe.querySelector('.ops-task.done .ops-task-copy')).opacity;probe.remove();return {samples:result,completedOpacity};}
function collectDensity(){display('customers');const root=document.documentElement,original=root.getAttribute('data-density');const sample=density=>{root.dataset.density=density;const row=document.querySelector('.data-table tbody tr'),cell=row?.querySelector('td');return {row:rect(row),font:type(cell)?.font,cellPadding:getComputedStyle(cell).paddingTop};};const result={comfortable:sample('comfortable'),compact:sample('compact')};if(original===null)root.removeAttribute('data-density');else root.dataset.density=original;return result;}
function collectEnabledMotion(){const root=document.documentElement,original=fixture.state.settings.motion;fixture.state.settings.motion='on';display('home');root.dataset.motion='on';const sample=element=>{const style=getComputedStyle(element);return {name:style.animationName,iterations:style.animationIterationCount,duration:style.animationDuration,transform:style.transform};};const result={cards:[...document.querySelectorAll('.horizon-kpi')].map(sample),shell:[...document.querySelectorAll('#sidebar .brand-mark,#mainNav .nav-item.active svg,.btn.primary')].map(sample),ancestors:['#viewContainer','.main-area','.horizon-workbench-hero','.home-dashboard-grid'].map(selector=>({selector,transform:getComputedStyle(document.querySelector(selector)).transform}))};fixture.state.settings.motion=original;root.dataset.motion='off';return result;}
function display(view){fixture.state.view=view;fixture.render();document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=legacyTheme;document.getElementById('crumbCurrent').textContent=view;document.querySelectorAll('#mainNav [data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));}
function collect(view){display(view);const container=document.getElementById('viewContainer');const nav=document.getElementById('mainNav');nav.scrollTop=nav.scrollHeight;const last=nav.querySelector('.nav-item:last-child');const navLastReachable=last&&rect(last).bottom<=rect(nav).bottom+1;nav.scrollTop=0;return {view,palette,body:type(document.body),nav:type(nav.querySelector('.nav-item')),sidebar:rect(document.getElementById('sidebar')),title:type(container.querySelector('.page-title')),titleVisible:visible(container.querySelector('.page-title')),button:rect(container.querySelector('.btn')),buttonType:type(container.querySelector('.btn')),search:rect(container.querySelector('input:not([type=checkbox])')),table:type(container.querySelector('.data-table td')),row:rect(container.querySelector('.data-table tbody tr')),panel:type(container.querySelector('.panel,.table-panel,.ops-task')),navLastReachable,docOverflow:document.documentElement.scrollWidth>innerWidth,container:rect(container),childrenOutside:[...container.children].filter(e=>getComputedStyle(e).position!=='fixed'&&getComputedStyle(e).display!=='none'&&rect(e).right>rect(container).right+2).map(e=>e.className),controls:[...container.querySelectorAll('.btn,input:not([type=checkbox]):not([type=radio]),select')].filter(visible).map(e=>({tag:e.tagName,font:type(e).font,height:rect(e).height})),markupLength:container.innerHTML.length};}
const views=['home','customers','intake','segments','vip','hot','groups','tickets','registrations','deposits','analytics','automation','quality','data','activity','recycle','settings','operations','stage-board','phone-registry'];
const collectBase=collect;
collect=function(view){const result=collectBase(view);const container=document.getElementById('viewContainer');result.smallText=[...container.querySelectorAll('*')].filter(e=>visible(e)&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<14).map(e=>({selector:e.tagName.toLowerCase()+'.'+e.className,parent:String(e.parentElement.className),secondary:e.matches('th,.panel-note,.rule-hint,.muted-cell,.table-context span,.customer-footer-note,.status-tag,.tag,.quality-tag,.digital-horizon-brand,.digital-horizon-context :is(span,time),.horizon-flow-source,.horizon-node-copy span,.horizon-node-grade,.horizon-process-step small,.horizon-spotlight-badge,.horizon-spotlight-capabilities :is(small,p)'),font:getComputedStyle(e).fontSize,text:e.textContent.trim().slice(0,28)})).slice(0,40);result.special=Object.fromEntries(['.customer6-focus','.customer6-focus-field strong','.saved-view','.ops6-task-insight','.ops6-task-insight-rows strong','.ops6-task-stage-list strong','.ops6-task-tabs button','.subnav button','.preview-table td','.source-defaults>label','.activity-text','.horizon-spotlight-capabilities small'].map(selector=>[selector,type(container.querySelector(selector))]));return result;};
const collectContent=collect;
collect=function(view){const result=collectContent(view);result.special['.ops6-task-board']=type(document.querySelector('.ops6-task-board'));const switcher=document.querySelector('.workspace-switcher');result.workspaces=switcher?{rect:rect(switcher),tabs:[...switcher.querySelectorAll('button,a')].map(e=>({rect:rect(e),font:type(e).font,visible:visible(e)})),topbar:rect(document.querySelector('.topbar')),actions:[...document.querySelectorAll('.topbar button')].map(e=>({id:e.id,rect:rect(e),visible:visible(e)}))}:null;return result;};
function collectHomeKpis(){
 const grid=document.querySelector('.horizon-kpis'),workspace=grid.closest('.main-area');
 const columns=getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length;
 let amount;
 const cards=[...grid.children].map(card=>{
  const value=card.querySelector('strong'),style=getComputedStyle(value);
  const label=card.querySelector('.horizon-kpi-heading').textContent.trim();
  if(label==='本周入金')amount=value;
  return {label,value:value.textContent.trim(),font:style.fontSize,whiteSpace:style.whiteSpace,overflowX:style.overflowX,overflowY:style.overflowY,lineHeight:parseFloat(style.lineHeight),height:rect(value).height,width:value.clientWidth,scrollWidth:value.scrollWidth};
 });
 let longAmount;
 if(amount){
  const original=amount.textContent;
  try{
   amount.textContent='¥1'+',234'.repeat(24);
   amount.scrollLeft=amount.scrollWidth;
   longAmount={width:amount.clientWidth,scrollWidth:amount.scrollWidth,scrollLeft:amount.scrollLeft};
  }finally{amount.textContent=original;amount.scrollLeft=0;}
 }
 return {workspaceWidth:rect(workspace).width,columns,cards,longAmount};
}
const collectChrome=collect;
collect=function(view){const result=collectChrome(view);if(view==='home')result.homeKpis=collectHomeKpis();const active=document.querySelector('#mainNav .nav-item.active');result.activeNav=type(active);result.activeNavIcon=type(active?.querySelector('svg'));result.chromeContrast=contrastSamples(document.querySelector('.topbar'),'.breadcrumbs,.breadcrumbs strong,.workspace-switcher button,.workspace-switcher a,.global-search span,.offline-pill,.sync-status,.top-icon');result.activeNavContrast={foreground:getComputedStyle(active?.querySelector('span:not(.nav-count)')||active).color,backgrounds:backgroundSamples(active)};result.contrastSamples=contrastSamples(document.getElementById('viewContainer'));result.progressTracks=[...document.querySelectorAll('.zk-metrics-progress-track')].map(element=>({viewport:rect(element),background:rect(element.querySelector('.zk-metrics-progress-background')),stroke:getComputedStyle(element).stroke}));result.motion={preference:document.documentElement.dataset.motion,kpis:[...document.querySelectorAll('.horizon-kpi')].map(element=>({transform:getComputedStyle(element).transform,transitionDuration:getComputedStyle(element).transitionDuration}))};return result;};
function collectAppearance(){
 document.getElementById('appearanceButton').click();
 const fieldset=document.querySelector('#modal [data-shell-appearance] .appearance-palettes');
 if(!fieldset)return {missing:true};
 const wrapper=fieldset.closest('[data-shell-appearance]'),labels=[...fieldset.querySelectorAll('label')],inputs=[...fieldset.querySelectorAll('input[type="radio"]')];
 const result={border:getComputedStyle(fieldset).borderTopWidth,columns:getComputedStyle(fieldset).gridTemplateColumns,fieldset:rect(fieldset),legend:{rect:rect(fieldset.querySelector('legend')),style:type(fieldset.querySelector('legend'))},gap:parseFloat(getComputedStyle(fieldset).columnGap),labels:labels.map(e=>({value:e.querySelector('input').value,rect:rect(e),style:type(e),description:type(e.querySelector('span'))})),checked:inputs.find(e=>e.checked)?.value,selectedBorder:getComputedStyle(inputs.find(e=>e.checked).closest('label')).borderTopColor};
 inputs[0].focus();result.focus={matches:inputs[0].matches(':focus-visible'),outline:getComputedStyle(labels[0]).outlineWidth};
 inputs[1].disabled=true;result.disabled={opacity:getComputedStyle(labels[1]).opacity,cursor:getComputedStyle(labels[1]).cursor};inputs[1].disabled=false;
 wrapper.style.width='360px';result.narrow={columns:getComputedStyle(fieldset).gridTemplateColumns,fieldset:rect(fieldset),legend:rect(fieldset.querySelector('legend')),labels:labels.map(rect)};wrapper.style.removeProperty('width');
 const storageBefore=localStorage.getItem('zhike.workspace-shell.v1');const alternate=inputs.find(e=>e.value!==palette);alternate.checked=true;alternate.dispatchEvent(new Event('change',{bubbles:true}));
 result.preview={selected:alternate.value,rendered:document.documentElement.dataset.palette,saved:window.ZhikeWorkspaceShell.getPalette(),storageUnchanged:localStorage.getItem('zhike.workspace-shell.v1')===storageBefore};
 document.querySelector('#modal [data-shell-action="cancel"]').click();result.preview.cancelled=document.documentElement.dataset.palette;result.closed=document.getElementById('modalBackdrop').classList.contains('hidden');
 document.getElementById('appearanceButton').click();const confirm=document.querySelector('#modal input[value="'+alternate.value+'"]');confirm.checked=true;confirm.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#modal [data-shell-action="close"]').click();result.preview.confirmed=window.ZhikeWorkspaceShell.getPalette();window.ZhikeWorkspaceShell.setPalette(palette);return result;
}
const screenshotView=query.get('screenshot');
if(screenshotView&&!views.includes(screenshotView))throw new Error('Unknown screenshot view');
let result;
if(screenshotView){
 document.body.dataset.synthetic='isolated-layout-fixture';
 // A screenshot is also a completed, strongly checked one-view result. The
 // browser owner captures only after this actual renderer reports completion.
 result={viewport:{width:innerWidth,height:innerHeight},results:[collect(screenshotView)],appearance:null,collapsed:null,errors:window.__visualErrors};
}else{
 const results=views.map(collect),componentResult=componentSamples(),enabledMotion=collectEnabledMotion(),density=collectDensity();const appearance=collectAppearance();const collapse=document.getElementById('sidebar');collapse.classList.add('collapsed');const collapsed={width:rect(collapse).width,restore:visible(document.getElementById('collapseNav'))};collapse.classList.remove('collapsed');
 result={viewport:{width:innerWidth,height:innerHeight},results,components:componentResult.samples,completedOpacity:componentResult.completedOpacity,enabledMotion,density,appearance,collapsed,errors:window.__visualErrors};
}
// Single-fixture and matrix invocations share the same array protocol. Matrix
// children still send exactly one DTO to their own parent collector.
document.getElementById('result').textContent=JSON.stringify([result]);
document.documentElement.dataset.visualComplete='true';
parent.postMessage({kind:'main-visual',index:Number(query.get('case')||0),payload:result},'*');
`;
const prelude = script(`window.__LOCAL_DB__=false;window.__visualErrors=[];window.addEventListener('error',e=>{window.__visualErrors.push(e.message);parent.postMessage({kind:'main-visual',index:Number(new URLSearchParams(location.search).get('case')||0),payload:{failure:e.message,errors:window.__visualErrors}},'*')});window.fetch=async()=>({ok:false,status:503,json:async()=>({error:'隔离视觉夹具不连接服务'})});`);
const scripts = prelude + dependencies.map(file => script(fs.readFileSync(path.join(app, 'modules', file), 'utf8'))).join('') + script(renderSource) + ['operations-core.cjs', 'operations-ui.js', 'phone-registry.js', 'workspace-shell.js'].map(file => script(fs.readFileSync(path.join(app, 'modules', file), 'utf8'))).join('') + '<pre id="result" hidden></pre>' + script(fixtureScript);
fs.writeFileSync(path.join(root, 'fixture.html'), shell.replace('</body>', () => scripts + '</body>'));
const cases = [[1920,1080,1], [2560,1440,1], [1920,1080,1.25], [2560,1440,1.25], [1920,1080,1.5], [2560,1440,1.5], [820,540,1], [1280,720,1.25]];
fs.writeFileSync(path.join(root, 'matrix.html'), '<!doctype html><meta charset="utf-8"><pre id="result" hidden></pre>' + script(`const cases=${JSON.stringify(cases)},results=[];addEventListener('message',e=>{if(e.data?.kind!=='main-visual')return;results[e.data.index]=e.data.payload;if(results.filter(Boolean).length===cases.length)document.getElementById('result').textContent=JSON.stringify(results)});cases.forEach((c,i)=>{const f=document.createElement('iframe');f.style.cssText='position:absolute;left:0;top:0;border:0;opacity:0;pointer-events:none;width:'+Math.round(c[0]/c[2])+'px;height:'+Math.round(c[1]/c[2])+'px';f.src='fixture.html?case='+i;document.body.appendChild(f)});`));
let cleanupSafe = true;
async function run({ fixture, query = '', viewport, expectedViewports, screenshotPath }) {
  const url = pathToFileURL(path.join(root, fixture)).href + (query ? '?' + query : '');
  try {
    // One owner is responsible for CDP result validation, Browser.close,
    // process identities, stream closure and optional PNG capture.
    const output = await runIsolatedRenderer({ edge, root, url, expectedViewports, evidenceDirectory: evidence, viewport, screenshotPath });
    assert.equal(output.metadata.cleanupSafe, true, 'Every observed test process must exit before returning');
    return output;
  } catch (error) {
    // A failed close cannot be turned into a passing DOM result or followed
    // by deleting a profile whose process ownership has not been released.
    if (error.cleanupSafe !== true) cleanupSafe = false;
    throw error;
  }
}
function contrast(a,b){const lum=value=>{const c=value.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return c[0]*.2126+c[1]*.7152+c[2]*.0722};return (Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);}
function verifyTwoCardGeometry(value){
  const [first,second]=value.labels.map(label=>label.rect);
  const close=(a,b)=>Math.abs(a-b)<=1;
  assert.ok(close(first.y,second.y),'Two palette cards occupy the same row');
  assert.ok(close(first.width,second.width),'Two palette cards have equal widths');
  assert.ok(close(second.x-first.right,value.gap),'Two palette cards retain their declared gap');
  assert.ok(close(first.x,value.fieldset.x)&&close(second.right,value.fieldset.right),'Exactly two palette cards fill the complete fieldset row with no implicit empty third track');
  assert.ok(value.legend.rect.bottom<=first.y,'Legend stays above both cards instead of consuming a card track');
}
function verifyAppearance(result,palette){
  const value=result.appearance;
  assert.ok(value&&!value.missing,'Existing workspace-shell appearance action opens its real modal');
  assert.equal(value.border,'0px','Appearance fieldset has no traditional frame');
  assert.equal(value.labels.length,2);
  // Native fieldset grids can return the specified repeat() value rather
  // than pixel tracks. Geometry proves two columns without misparsing CSSOM.
  verifyTwoCardGeometry(value);
  const misplaced=structuredClone(value);misplaced.labels[1].rect.y+=40;
  assert.throws(()=>verifyTwoCardGeometry(misplaced),/same row/,'A wrapped second card cannot pass the two-column contract');
  const extraTrack=structuredClone(value);extraTrack.fieldset.right+=extraTrack.labels[0].rect.width+extraTrack.gap;
  assert.throws(()=>verifyTwoCardGeometry(extraTrack),/implicit empty third track/,'A real empty third column cannot pass by merely declaring repeat(2)');
  for(const label of value.labels){assert.ok(label.rect.height>=44);assert.equal(label.style.font,'16px');assert.equal(label.description.display,'block');assert.equal(label.description.font,'14px');}
  assert.equal(value.checked,palette,'The actual settings owner restores the selected palette');
  assert.notEqual(value.labels.find(label=>label.value===palette).style.background,value.labels.find(label=>label.value!==palette).style.background,'Checked palette has a distinct visible selected surface');
  assert.equal(value.focus.matches,true);assert.equal(value.focus.outline,'3px','Keyboard focus is visible on the complete selectable card');
  assert.equal(value.disabled.cursor,'not-allowed');assert.ok(Number(value.disabled.opacity)<1);
  assert.ok(value.narrow.labels[1].y>=value.narrow.labels[0].bottom+value.gap-1,'Narrow modal cards occupy separate rows');
  for(const label of value.narrow.labels)assert.ok(Math.abs(label.x-value.narrow.fieldset.x)<=1&&Math.abs(label.right-value.narrow.fieldset.right)<=1,'Each narrow card fills one complete row');
  assert.ok(value.narrow.legend.bottom<=value.narrow.labels[0].y,'Narrow legend remains above the card rows');
  assert.equal(value.closed,true,'The original modal close action remains operable');
  assert.equal(value.preview.rendered,value.preview.selected,'Selecting a theme previews the actual cascade');
  assert.equal(value.preview.saved,palette,'Draft preview does not change the committed preference');
  assert.equal(value.preview.storageUnchanged,true,'Draft preview does not write local preferences');
  assert.equal(value.preview.cancelled,palette,'Cancel restores the original theme');
  assert.equal(value.preview.confirmed,value.preview.selected,'Complete commits the selected theme');
}
function verifyHomeKpis(result){
  const home=result.results.find(page=>page.view==='home');
  if(!home)return;
  const {workspaceWidth,columns,cards,longAmount}=home.homeKpis;
  assert.equal(columns,workspaceWidth<=370?1:workspaceWidth<=600?2:workspaceWidth<=1240?3:6,
    'Home KPI columns follow the effective workspace width');
  assert.equal(cards.length,6);
  assert.equal(cards.find(card=>card.label==='本周入金')?.value,'¥1,250','The actual renderer formats the synthetic deposit');
  for(const card of cards){
    assert.equal(card.font,'26px');
    assert.equal(card.whiteSpace,'nowrap');
    assert.equal(card.overflowX,'auto');
    assert.equal(card.overflowY,'hidden',card.label+' has no vertical scrollbar');
    assert.ok(Math.abs(card.lineHeight-31.2)<.1,card.label+' gives the 26px figures room in a single line');
    assert.ok(card.height<=card.lineHeight+1&&card.scrollWidth<=card.width+1,card.label+' fits on one visible line: '+JSON.stringify(card));
  }
  assert.ok(longAmount&&longAmount.scrollWidth>longAmount.width&&longAmount.scrollLeft>0&&longAmount.scrollLeft+longAmount.width>=longAmount.scrollWidth-1,
    'The full synthetic long amount remains horizontally reachable: '+JSON.stringify(longAmount));
}
function verifyContrast(result){
  verifyHomeKpis(result);
  const samples=result.results.flatMap(page=>page.contrastSamples.concat(page.chromeContrast||[]).map(sample=>({view:page.view,...sample}))).concat((result.components||[]).map(sample=>({view:'explicit-isolated-components',...sample})));
  assert.ok(samples.length>150,'Real page labels, table headers, states and controls are represented');
  assert.equal(result.components?.length,14,'All task priority, completed copy and semantic state variants are checked');
  assert.equal(result.completedOpacity,'1','Completed tasks retain clear text instead of fading body copy');
  assert.equal(result.enabledMotion.cards.length,6,'The real homepage KPIs are represented with motion enabled');
  for(const sample of result.enabledMotion.cards.concat(result.enabledMotion.shell)){assert.ok(!sample.iterations.split(',').some(value=>value.trim()==='infinite'),'Refined effects never restore old infinite animations');if(sample.name!=='none')for(const duration of sample.duration.split(','))assert.ok(parseFloat(duration)<=.22,'Enabled effects stay finite and short');}
  for(const card of result.enabledMotion.cards)assert.equal(card.transform,'none','KPIs have no permanent transform at rest');
  for(const ancestor of result.enabledMotion.ancestors)assert.equal(ancestor.transform,'none','No transformed layout ancestor: '+ancestor.selector);
  const failures=samples.flatMap(sample=>sample.backgrounds.map(background=>({view:sample.view,selector:sample.selector,text:sample.text,foreground:sample.foreground,background,ratio:Number(contrast(sample.foreground,background).toFixed(3))}))).filter(sample=>sample.ratio<4.5);
  assert.deepEqual(failures.slice(0,30),[],'Ordinary text contrast stays at least 4.5:1 under the actual full legacy + current cascade');
  assert.equal(result.density.comfortable.font,'14px');assert.equal(result.density.compact.font,'14px','Compact density does not shrink the text');
  assert.ok(result.density.comfortable.row.height>=50&&result.density.comfortable.row.height<=56,'Comfortable rows remain 50–56 effective pixels');
  assert.ok(result.density.compact.row.height>=46&&result.density.compact.row.height<=48,'Compact rows remain 46–48 effective pixels');
  assert.ok(result.density.compact.row.height<result.density.comfortable.row.height,'The existing density attribute changes actual row geometry');
  assert.ok(parseFloat(result.density.compact.cellPadding)<parseFloat(result.density.comfortable.cellPadding),'Compactness comes from cell spacing');
  verifyProgressTracks(result);
}
function verifyProgressTracks(result){
  const tracks=result.results.flatMap(page=>page.progressTracks);
  assert.ok(tracks.length>0,'The real task renderer includes a progress track');
  for(const track of tracks){assert.ok(Math.abs(track.background.width-track.viewport.width)<=1,'Progress background fills its responsive SVG viewport instead of a centered fixed-aspect pill');assert.equal(track.stroke,'none','Chart surfaces do not inherit decorative icon strokes');}
}
async function captureMainScreenshots(){
  if(process.env.ZHIKE_VISUAL_SNAPSHOTS==='0')return;
  for(const [view,palette] of [['home','atelier-dawn'],['customers','atelier-dawn'],['operations','atelier-dawn'],['home','horizon-night']]){
    const file=path.join(evidence,view+'-'+palette+'.png');
    const {results:[result],metadata}=await run({fixture:'fixture.html',query:'palette='+palette+'&screenshot='+view,viewport:{width:1920,height:1080},expectedViewports:[{width:1920,height:1080}],screenshotPath:file});
    assert.deepEqual(result.errors,[],'Screenshot renderer must finish without errors');
    assert.equal(result.results.length,1,'A screenshot result contains only its actual displayed route');
    assert.equal(result.results[0].view,view,'Screenshot completion belongs to the requested route');
    verifyHomeKpis(result);
    assert.ok(result.results[0].chromeContrast.length>=3,'Actual topbar text and workspace controls are represented');
    for(const sample of result.results[0].chromeContrast)for(const background of sample.backgrounds)assert.ok(contrast(sample.foreground,background)>=4.5,'Final topbar text remains readable: '+sample.selector);
    assert.ok(fs.statSync(file).size>10000);
    recordVisualAssertions(metadata);
  }
}
async function main() {
try {
  if(process.env.ZHIKE_VISUAL_ONLY==='snapshots'){
    assert.notEqual(process.env.ZHIKE_VISUAL_SNAPSHOTS,'0','A focused screenshot follow-up must actually capture its pages');
    await captureMainScreenshots();console.log('Final Pro screenshots: 4 real routes and actual topbar text contrast PASS');return;
  }
  if(process.env.ZHIKE_VISUAL_ONLY==='palette-contrast'){
    for(const [name,query,palette] of [['night','palette=horizon-night','horizon-night'],['dawn-dark-legacy','palette=atelier-dawn&legacyTheme=dark','atelier-dawn']]){
      const {results:[result],metadata}=await run({fixture:'fixture.html',query,viewport:{width:1920,height:1080},expectedViewports:[{width:1920,height:1080}]});
      fs.writeFileSync(path.join(evidence,name+'-computed.json'),JSON.stringify(result,null,2));
      assert.deepEqual(result.errors,[]);assert.equal(result.results.length,20);verifyAppearance(result,palette);verifyContrast(result);
      for(const page of result.results){assert.equal(page.body.font,'14px');assert.equal(page.docOverflow,false);assert.deepEqual(page.childrenOutside,[]);}
      recordVisualAssertions(metadata);
    }
    await captureMainScreenshots();
    console.log('Pro final palette contrast: night + legacy-dark × 20 real routes PASS; 4 current screenshots captured; prior matrix geometry remains separately versioned');
    return;
  }
  // An explicit focused follow-up reuses this fixture and the same strict
  // process owner. The default command still runs every matrix assertion.
  if(process.env.ZHIKE_VISUAL_ONLY){
    assert.equal(process.env.ZHIKE_VISUAL_ONLY,'operations-progress','Only the documented focused follow-up is supported');
    for(const palette of ['atelier-dawn','horizon-night']){
      const {results:[result],metadata}=await run({fixture:'fixture.html',query:'palette='+palette+'&screenshot=operations',viewport:{width:1920,height:1080},expectedViewports:[{width:1920,height:1080}],screenshotPath:palette==='atelier-dawn'?path.join(evidence,'operations-atelier-dawn.png'):undefined});
      assert.deepEqual(result.errors,[]);assert.equal(result.results.length,1);assert.equal(result.results[0].view,'operations');verifyProgressTracks(result);
      fs.writeFileSync(path.join(evidence,'operations-progress-'+palette+'-computed.json'),JSON.stringify(result,null,2));
      recordVisualAssertions(metadata);
    }
    console.log('Operations progress actual SVG geometry: dawn + night PASS; existing full matrix evidence remains separately identified');
    return;
  }
  const expectedViewports=cases.map(([width,height,scale])=>({width:Math.round(width/scale),height:Math.round(height/scale)}));
  const {results,metadata}=await run({fixture:'matrix.html',viewport:{width:1280,height:720},expectedViewports});
  fs.writeFileSync(path.join(evidence,'computed-styles.json'),JSON.stringify({environment:'Isolated Edge CSS viewport/DPI model; synthetic records; not native WinUI acceptance',cases,results},null,2));
  for(const item of results){
    assert.deepEqual(item.errors,[],'All shipped renderers must run in the isolated fixture');
    verifyAppearance(item,'atelier-dawn');
    verifyContrast(item);
    assert.ok(item.collapsed.restore,'Collapsed rail retains a visible restore control');
    assert.equal(item.collapsed.width,72);
    for(const page of item.results){
      assert.ok(page.markupLength>250,page.view+' must use actual renderer output');
      assert.equal(page.body.font,'14px',page.view+' body size');
      assert.equal(page.body.background,'rgb(245, 247, 250)',page.view+' V4 near-white workspace background');
      assert.equal(page.nav.font,'14px',page.view+' navigation size');
      assert.ok(page.activeNav&&page.activeNavContrast.backgrounds.every(background=>contrast(page.activeNavContrast.foreground,background)>=4.5),'Active navigation text contrast over both opaque gradient endpoints');
      assert.equal(page.activeNavIcon.color,page.activeNav.color,'The active navigation icon follows its readable text foreground');
      assert.equal(page.motion.preference,'off');for(const card of page.motion.kpis){assert.equal(card.transform,'none');assert.equal(card.transitionDuration,'0s','Snapshots respect existing reduce-motion preference');}
      assert.ok(page.navLastReachable,page.view+' final navigation item reachable');
      assert.equal(page.docOverflow,false,page.view+' document has no horizontal overflow');
      assert.ok(page.workspaces,'Actual shipped shared workspace switcher is represented');
      assert.equal(page.workspaces.tabs.length,2);
      for(const tab of page.workspaces.tabs){assert.equal(tab.font,'14px');assert.ok(tab.visible&&tab.rect.height>=44);assert.ok(tab.rect.right<=page.workspaces.topbar.right&&tab.rect.x>=page.workspaces.topbar.x,'Workspace tabs remain inside the actual topbar');}
      for(const action of page.workspaces.actions){assert.ok(action.visible&&action.rect.height>=44&&action.rect.width>=44,'Topbar action reachable: '+action.id);assert.ok(action.rect.right<=page.workspaces.topbar.right+1&&action.rect.x>=page.workspaces.topbar.x-1&&action.rect.bottom<=page.workspaces.topbar.bottom+1,'Topbar does not clip '+action.id);}
      assert.deepEqual(page.childrenOutside,[],page.view+' major surfaces stay inside content');
      const unreadable=page.smallText.filter(item=>item.secondary?parseFloat(item.font)!==13:!(/eyebrow|metric|kpi|legend|activity-time|SVG|ops6-card-tags/.test(item.selector+' '+item.parent)));
      assert.deepEqual(unreadable,[],page.view+' body copy cannot retain old 9–12px declarations');
      if(page.title){assert.equal(page.title.font,'20px',page.view+' V4.1 page title');assert.ok(page.titleVisible,page.view+' title visible');}
      for(const control of page.controls) {assert.ok(parseFloat(control.font)>=14,page.view+' control font '+control.font);assert.ok(control.height>=44,page.view+' control height '+control.height);}
      if(page.table){assert.equal(page.table.font,'14px');if(['customers','segments','hot','vip'].includes(page.view))assert.ok(page.row.height>=46&&page.row.height<=58,page.view+' regular customer row height '+page.row.height);}
      for(const [selector,style] of Object.entries(page.special)){if(!style)continue;if(selector==='.horizon-spotlight-capabilities small')assert.equal(style.font,'13px');else assert.ok(parseFloat(style.font)>=14,page.view+' '+selector+' readable body copy');if(['.customer6-focus','.ops6-task-insight','.ops6-task-board'].includes(selector))assert.ok(style.background==='rgb(255, 255, 255)'||(style.background==='rgba(0, 0, 0, 0)'&&style.backgroundImage.includes('rgb(255, 255, 255)')),selector+' follows V4 white content surfaces rather than the old hardcoded night gradient');}
    }
  }
  recordVisualAssertions(metadata);
  for(const [name,query] of [['night','palette=horizon-night'],['dawn-dark-legacy','palette=atelier-dawn&legacyTheme=dark']]){
    const {results:[result],metadata}=await run({fixture:'fixture.html',query,viewport:{width:1920,height:1080},expectedViewports:[{width:1920,height:1080}]});
    assert.ok(result,'Real '+name+' result required');
    fs.writeFileSync(path.join(evidence,name+'-computed.json'),JSON.stringify(result,null,2));assert.deepEqual(result.errors,[]);verifyAppearance(result,name==='night'?'horizon-night':'atelier-dawn');verifyContrast(result);
    for(const page of result.results){assert.equal(page.body.font,'14px');assert.equal(page.nav.font,'14px');assert.equal(page.body.background,name==='night'?'rgb(16, 24, 43)':'rgb(245, 247, 250)');assert.equal(page.body.color,name==='night'?'rgb(238, 242, 255)':'rgb(30, 47, 80)');assert.equal(page.docOverflow,false);}
    recordVisualAssertions(metadata);
  }
  await captureMainScreenshots();
  console.log('S1 main visual actual-render/full-CSS computed styles: '+results.length+' viewports × 20 routes PASS; screenshots: '+evidence);
} catch (error) {
  cleanupSafe = false;
  throw error;
} finally {
  assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('zhike-s1-main-style-'));
  if(cleanupSafe)fs.rmSync(root,{recursive:true,force:false,maxRetries:20,retryDelay:100});
  else console.error('Isolated visual failure root retained: '+root);
}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
