'use strict';
// Explicit, opt-in visual evidence command. This is not native acceptance and
// is intentionally not a *.test.cjs: a full capture must not run in regression.
// Uses actual shipped renderers, isolated synthetic records and existing Edge
// ownership checks. No service, credentials, production profile or WS is opened.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url'),{createHash}=require('node:crypto');
const {runIsolatedEdge}=require('../../tests/helpers/isolated-edge-runner.cjs');
const {renderWsWorkbenchFixture}=require('../../tests/helpers/ws-workbench-render-fixture.cjs');
const { createContrastInspector } = require('../../tests/helpers/visual-contrast.cjs');
const repo=path.resolve(__dirname,'../..'),app=path.join(repo,'resources/app');
const evidence=path.resolve(process.env.ZHIKE_V4_EVIDENCE||path.join(repo,'.tools/dynamic-v4/actual-browser'));
fs.mkdirSync(evidence,{recursive:true});
const script=value=>'<script>'+value.replace(/<\/script/gi,'<\\/script')+'</script>';
const index=fs.readFileSync(path.join(app,'index.html'),'utf8');
const css=[...index.matchAll(/<link\s+rel="stylesheet"\s+href="\.\/([^"]+)"/g)].map(m=>fs.readFileSync(path.join(app,m[1]),'utf8')).join('\n');
const mainSourcePath=path.join(__dirname,'s1-main-visual.test.cjs');
let prefix=fs.readFileSync(mainSourcePath,'utf8').split('const prelude =')[0];
assert.ok(prefix.includes('const fixtureScript ='),'Reuse the actual S1 fixture builder');
prefix=prefix.replace('window.__visualFixture={state,render};','window.__visualFixture={state,render,showCustomer,newCustomerModal,editCustomerModal,followModal,businessModal,registrationModal,securitySettingsModal,shortcutHelpModal,globalSearchModal,notificationModal,workspaceProfileModal,profileAvatarModal};');
prefix=prefix.replace("const views=['home'","const views=['followups','home'");
const context={require:createRequire(mainSourcePath),__dirname:path.dirname(mainSourcePath),process,console,Buffer,URL};
vm.runInNewContext(prefix+'\nglobalThis.fixtureBuild={root,edge,shell,renderSource,fixtureScript,dependencies};',context,{filename:'dynamic-v4-actual-main-fixture-builder.cjs'});
const {root,edge,shell,renderSource,dependencies}=context.fixtureBuild;
let mainFixture=context.fixtureBuild.fixtureScript;
const injected=String.raw`
const v4query=new URLSearchParams(location.search);
fixture.state.phoneRegistry=Array.from({length:12},(_,i)=>({id:'V4_PHONE_'+i,device:i%2?'工作手机2':'工作手机1',code:'ISOLATED-'+i,phone:'919000'+String(i).padStart(6,'0'),role:'隔离测试',channel:'隔离样本'}));
fixture.state.customers.forEach((row,i)=>{row.phase=['新客户','潜在客户','意向客户'][i%3];row.vipNumber=i<2?'ISOLATED-VIP-'+i:'';row.group='ISOLATED-G'+(i%3);row.note='明确隔离视觉样本，不是真实客户';});
fixture.state.tickets=fixture.state.customers.slice(0,6).map((row,i)=>({id:'V4_TICKET_'+i,customerId:row.id,product:'ISOLATED-'+i,direction:'买入',buyDate:day,date:day,amount:(i+1)*100,status:i%2?'待确认':'已确认',note:'隔离视觉样本'}));
fixture.state.deposits=fixture.state.customers.slice(0,6).map((row,i)=>({id:'V4_DEPOSIT_'+i,customerId:row.id,date:day,amount:(i+1)*100,currency:'INR',status:i%2?'待确认':'已确认',note:'隔离视觉样本'}));
fixture.state.registrations=fixture.state.customers.slice(0,5).map((row,i)=>({id:'V4_REGISTRATION_'+i,customerId:row.id,date:day,status:'已报名',source:'隔离样本',note:'未执行真实报名'}));
fixture.state.settings.operatingTasks=['high','normal','low'].map((priority,i)=>({id:'V4_TASK_'+i,title:'ISOLATED 视觉任务 '+(i+1),status:i===2?'done':'pending',priority,stage:'待联系',customerId:'VISUAL_'+i,customerName:'隔离布局客户 '+(i+1),due:day,createdAt:new Date().toISOString()}));
if(v4query.get('state')==='empty'){fixture.state.customers=[];fixture.state.activities=[];fixture.state.settings.operatingTasks=[];fixture.state.phoneRegistry=[];fixture.state.tickets=[];fixture.state.deposits=[];fixture.state.registrations=[];}
if(v4query.get('density')==='compact'){document.documentElement.dataset.density='compact';fixture.state.settings.density='compact';}
`;
mainFixture=mainFixture.replace('const screenshotView=query.get',injected+'\nconst screenshotView=query.get');
mainFixture=mainFixture.replace('// Single-fixture and matrix invocations',String.raw`
const v4dialog=v4query.get('dialog');
if(v4dialog){
 const customer=fixture.state.customers[0];
 if(v4dialog==='appearance')document.getElementById('appearanceButton').click();
 else if(v4dialog==='customer')fixture.showCustomer(customer);
 else if(v4dialog==='new-customer')fixture.newCustomerModal();
 else if(v4dialog==='edit-customer')fixture.editCustomerModal(customer);
 else if(v4dialog==='follow')fixture.followModal(customer);
 else if(v4dialog==='ticket')fixture.businessModal('ticket',customer.id);
 else if(v4dialog==='deposit')fixture.businessModal('deposit',customer.id);
 else if(v4dialog==='registration')fixture.registrationModal();
 else if(v4dialog==='security')fixture.securitySettingsModal();
 else if(v4dialog==='help')fixture.shortcutHelpModal();
 else if(v4dialog==='search')fixture.globalSearchModal('隔离');
 else if(v4dialog==='notification')fixture.notificationModal();
 else if(v4dialog==='workspace')fixture.workspaceProfileModal();
 else if(v4dialog==='avatar')fixture.profileAvatarModal();
 else if(v4dialog==='phone-new')document.querySelector('[data-registry-action="new"]').click();
 else throw new Error('Unknown actual dialog '+v4dialog);
}
if(v4query.get('collapsed')==='1')document.getElementById('sidebar').classList.add('collapsed');
result.v4={route:screenshotView,dialog:v4dialog||null,density:document.documentElement.dataset.density||'comfortable',state:v4query.get('state')||'synthetic',mode:'BrowserOnly',actualRenderer:true};
const specimen=document.querySelector(v4dialog==='customer'?'#customerDrawer.open':v4dialog?'#modal:not(.hidden)':'#viewContainer');
result.v4.contentPresent=Boolean(specimen&&specimen.getClientRects().length&&specimen.textContent.trim());
result.v4.heading=specimen?.querySelector('h1,h2,h3')?.textContent.trim()||'';
result.v4.visibleText=specimen?.textContent.trim().slice(0,120)||'';
result.v4.contentBounds=rect(specimen);
result.v4.registry=[...document.querySelectorAll('[data-registry-field],.registry-table input[type="checkbox"],.registry-table select')].slice(0,24).map(e=>({tag:e.tagName,type:e.type,field:e.dataset.registryField,font:type(e).font,color:type(e).color,background:type(e).background,bounds:rect(e)}));
result.v4.stagePanels=[...document.querySelectorAll('.ops6-stage-preview,.ops-stage-open,.ops-priority,.ops-task.done')].slice(0,24).map(e=>({selector:e.className,background:type(e).background,image:type(e).backgroundImage,color:type(e).color,shadow:getComputedStyle(e).boxShadow}));
result.v4.motionOff=[...document.querySelectorAll('#viewContainer button,#mainNav button')].filter(visible).every(e=>getComputedStyle(e).animationName==='none');
// Single-fixture and matrix invocations`);
const prelude=script(`window.__LOCAL_DB__=false;window.__visualErrors=[];window.addEventListener('error',e=>window.__visualErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__visualErrors.push(String(e.reason)));window.fetch=async()=>({ok:false,status:503,json:async()=>({error:'隔离视觉夹具不连接任何服务'})});`);
const mainScripts=prelude+dependencies.map(file=>script(fs.readFileSync(path.join(app,'modules',file),'utf8'))).join('')+script(renderSource)+['operations-core.cjs','operations-ui.js','phone-registry.js','workspace-shell.js'].map(file=>script(fs.readFileSync(path.join(app,'modules',file),'utf8'))).join('')+'<pre id="result" hidden></pre>'+script(mainFixture);
// Freeze the actual stylesheet bytes for this evidence run. Product edits in
// another task cannot change half of a running matrix through file: links.
const frozenMainShell=shell.replace(/<link\s+rel="stylesheet"[^>]*>/g,'').replace('</head>','<style>'+css+'</style></head>');
fs.writeFileSync(path.join(root,'main.html'),frozenMainShell.replace('</body>',()=>mainScripts+'</body>'));

const wsSource=fs.readFileSync(path.join(app,'modules/ws-workbench.js'),'utf8');
const mountStart=wsSource.indexOf('  function syncWorkbenchAttributes('),mountEnd=wsSource.indexOf('  function render(options = {})',mountStart);
assert.ok(mountStart>=0&&mountEnd>mountStart);
const mounts=wsSource.slice(mountStart,mountEnd),icons=index.match(/<svg class="svg-defs"[\s\S]*?<\/svg>/)[0],topbar=index.match(/<header class="topbar">[\s\S]*?<\/header>/)[0];
const wsViews=['overview','accounts','chat','groups','members','collection','contacts','ai','crm','tasks','logs','settings'];
const groupCatalog=Array.from({length:12},(_,i)=>({accountId:'default',groupJid:'v4-isolated-'+i+'@g.us',groupName:'ISOLATED 视觉群 '+(i+1),participantCount:12+i,permissions:'未提供',collectionStatus:'后台采集不可用',lastSyncAt:''}));
const wsFixtures=Object.fromEntries(wsViews.map(view=>[view,renderWsWorkbenchFixture({view,groupCatalog,assistOpen:true,backgroundActive:false,wsStatus:'隔离未连接'})]));
wsFixtures['chat-closed']=renderWsWorkbenchFixture({view:'chat',assistOpen:false,wsStatus:'隔离未连接'});
wsFixtures['chat-compact']=renderWsWorkbenchFixture({view:'chat',navCollapsed:true,assistOpen:false,wsStatus:'隔离未连接'});
async function wsCapture(fixtures){
 const q=new URLSearchParams(location.search),view=q.get('view')||'chat';
 document.documentElement.dataset.palette=q.get('palette')||'atelier-dawn';document.documentElement.dataset.motion='off';document.documentElement.dataset.theme=document.documentElement.dataset.palette==='horizon-night'?'dark':'light';
 const target=document.getElementById('viewContainer');mountWsWorkbenchShell(target,fixtures[view]);
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
 const page=target.querySelector('.ws-workbench-shell'),host=target.querySelector('#wsBrowserHost'),p=target.querySelector('[data-ws-workspace-page]')||target.querySelector('.workspace-chat');
 const result={viewport:{width:innerWidth,height:innerHeight},errors:[],v4:{route:view,mode:'BrowserOnly',actualRenderer:true,contentPresent:Boolean(p?.textContent.trim()),heading:p?.querySelector('h1,h2,h3')?.textContent.trim(),contentBounds:rect(page),nativeAnchor:host?rect(host):null,overflow:document.documentElement.scrollWidth>innerWidth,palette:document.documentElement.dataset.palette,capabilityBlocked:page.textContent.includes('后台采集不可用'),motionOff:[...target.querySelectorAll('button')].every(e=>getComputedStyle(e).animationName==='none')}};
 document.getElementById('result').textContent=JSON.stringify([result]);document.documentElement.dataset.visualComplete='true';
}
fs.writeFileSync(path.join(root,'ws.html'),'<!doctype html><html lang="zh-CN" data-view="ws-workbench" data-desktop-host="webview2"><meta charset="utf-8"><style>'+css+'</style><body class="ws-mode ws-workspace-active">'+icons+'<div class="app-shell"><aside id="sidebar"></aside><main class="main-area">'+topbar+'<section id="viewContainer" class="view-container">'+wsFixtures.chat+'</section></main></div><pre id="result" hidden></pre>'+script(mounts+'\n('+wsCapture.toString()+')('+JSON.stringify(wsFixtures)+').catch(e=>{document.getElementById("result").textContent=JSON.stringify([{viewport:{width:innerWidth,height:innerHeight},errors:[String(e)]}]);});')+'</body></html>');

const originalWsTest=fs.readFileSync(path.join(__dirname,'s1-ws-visual.test.cjs'),'utf8');
const gptStart=originalWsTest.indexOf('async function gptBrowserCase()'),gptEnd=originalWsTest.indexOf('function runGptVisual()',gptStart);
assert.ok(gptStart>=0&&gptEnd>gptStart,'Reuse the real existing async GPT renderer fixture');
const gptFunction=originalWsTest.slice(gptStart,gptEnd).replace("document.getElementById('result').textContent=JSON.stringify(result);","window.__v4GptResult=result;");
const gptShell=index.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\s+rel="stylesheet"[^>]*>/g,'').replace('<head>','<head><base href="'+pathToFileURL(app+path.sep).href+'">');
const gptScript=script('window.__gptSource='+JSON.stringify(fs.readFileSync(path.join(app,'modules/gpt-assistant.js'),'utf8'))+';'+createContrastInspector.toString()+';'+gptFunction+';gptBrowserCase().then(()=>{const result=window.__v4GptResult;result.v4={route:"gpt",mode:"BrowserOnly",actualRenderer:true,contentPresent:!!document.querySelector(".gpt-page")};document.getElementById("result").textContent=JSON.stringify([result]);document.documentElement.dataset.visualComplete="true";}).catch(error=>{document.getElementById("result").textContent=JSON.stringify([{viewport:{width:innerWidth,height:innerHeight},errors:[String(error)]}]);});');
fs.writeFileSync(path.join(root,'gpt.html'),gptShell.replace('</head>','<style>'+css+'</style></head>').replace('</body>','<pre id="result" hidden></pre>'+gptScript+'</body>'));

const mainRoutes=['home','intake','operations','stage-board','customers','segments','hot','groups','vip','tickets','registrations','deposits','analytics','automation','quality','data','activity','recycle','settings','phone-registry','followups'];
const cases=[];
for(const palette of ['atelier-dawn','horizon-night']){
 for(const view of mainRoutes)cases.push({name:'main-'+view+'-'+palette,file:'main.html',query:{palette,screenshot:view}});
 cases.push({name:'main-gpt-'+palette,file:'gpt.html',query:{palette}});
 cases.push({name:'main-ws-entry-'+palette,file:'ws.html',query:{palette,view:'chat'}});
 for(const view of wsViews)cases.push({name:'ws-'+view+'-'+palette,file:'ws.html',query:{palette,view}});
}
for(const palette of ['atelier-dawn','horizon-night']){
 for(const dialog of ['appearance','customer','new-customer','edit-customer','follow','ticket','deposit','registration','security','help','search','notification','workspace','avatar','phone-new'])cases.push({name:'dialog-'+dialog+'-'+palette,file:'main.html',query:{palette,screenshot:dialog==='phone-new'?'phone-registry':'customers',dialog}});
 for(const view of ['customers','operations','recycle','phone-registry'])cases.push({name:'empty-'+view+'-'+palette,file:'main.html',query:{palette,screenshot:view,state:'empty'}});
 for(const view of ['customers','operations','stage-board','phone-registry','settings'])cases.push({name:'compact-small-'+view+'-'+palette,file:'main.html',width:820,height:540,query:{palette,screenshot:view,density:'compact',collapsed:'1'}});
 cases.push({name:'gpt-setup-small-'+palette,file:'gpt.html',width:820,height:540,query:{palette,configured:'false'}});
 cases.push({name:'ws-chat-compact-small-'+palette,file:'ws.html',width:820,height:540,query:{palette,view:'chat-compact'}});
}
const filter=process.env.ZHIKE_V4_CASE_FILTER;
const selected=filter?cases.filter(c=>new RegExp(filter).test(c.name)):cases;
assert.ok(selected.length,'Explicit case filter must match at least one actual renderer');
const inputFiles=['resources/app/index.html','resources/app/app.js',...index.matchAll(/<link\s+rel="stylesheet"\s+href="\.\/([^"]+)"/g)].map(value=>typeof value==='string'?value:'resources/app/'+value[1]).concat(['resources/app/modules/ws-workbench.js','resources/app/modules/ws-business-pages.js','resources/app/modules/gpt-assistant.js','resources/app/modules/operations-ui.js','resources/app/modules/phone-registry.js','resources/app/modules/workspace-shell.js']);
const manifest={schemaVersion:1,scope:'BrowserOnly actual production renderers with explicitly synthetic records; no native acceptance',fixtureRoot:root,createdAt:new Date().toISOString(),inputSha256:inputFiles.map(file=>({file,sha256:createHash('sha256').update(fs.readFileSync(path.join(repo,file))).digest('hex')})),cases:selected,loadedMainModules:dependencies.concat(['app.js','operations-core.cjs','operations-ui.js','phone-registry.js','workspace-shell.js']),limits:['Native Core lifecycle, real WS and AI are not tested.','Optional late enhancement scripts not loaded by existing S1 fixture are source-audited, not asserted as native/browser functional acceptance.','Previous historical screenshots may be used only with their original commit/date.'],results:[],status:'Prepared'};
const manifestPath=path.join(evidence,'capture-manifest.json');
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
if(process.argv.includes('--prepare-only')){const checked=path.resolve(root),parent=path.resolve(os.tmpdir())+path.sep;assert.ok(checked.toLowerCase().startsWith(parent.toLowerCase())&&path.basename(checked).startsWith('zhike-s1-main-style-'));fs.rmSync(checked,{recursive:true,force:false});manifest.fixtureCleaned=true;fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));console.log(JSON.stringify({status:'Prepared',cases:selected.length,fixtureCleaned:true,manifest:manifestPath}));process.exit(0);}
let cleanupSafe=true;
(async()=>{
 try{
  for(const item of selected){
   const url=pathToFileURL(path.join(root,item.file));for(const [key,value]of Object.entries(item.query))url.searchParams.set(key,value);
   const viewport={width:item.width||1920,height:item.height||1080},screenshotPath=path.join(evidence,item.name+'.png');
   let output;
   try{output=await runIsolatedEdge({edge,root,url:url.href,viewport,expectedViewports:[viewport],evidenceDirectory:evidence,screenshotPath});}catch(error){if(error.cleanupSafe!==true)cleanupSafe=false;manifest.results.push({name:item.name,status:'Failed',error:{message:error.message,code:error.code,phase:error.phase,cleanupSafe:error.cleanupSafe}});throw error;}
   assert.equal(output.metadata.cleanupSafe,true,'Owned real Edge processes must exit');
   const [result]=output.results;assert.deepEqual(result.errors,[],'Actual renderer must finish without errors: '+item.name);assert.equal(result.v4?.actualRenderer,true);assert.equal(result.v4.contentPresent,true,'Actual content must exist: '+item.name);
   if(result.v4.overflow!==undefined)assert.equal(result.v4.overflow,false,'No outer document overflow: '+item.name);
   const record={name:item.name,status:'Passed-browser-capture',bytes:fs.statSync(screenshotPath).size,sha256:createHash('sha256').update(fs.readFileSync(screenshotPath)).digest('hex'),result,processInvocation:output.metadata.invocation};manifest.results.push(record);fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));console.log(JSON.stringify({name:item.name,status:record.status,bytes:record.bytes}));
  }
  manifest.status='Passed-browser-capture';
 }catch(error){manifest.status='Failed';manifest.failure=String(error.stack||error);process.exitCode=1;console.error(error.stack||error);}
 finally{
  manifest.cleanupSafe=cleanupSafe;fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
  if(cleanupSafe){const checked=path.resolve(root),parent=path.resolve(os.tmpdir())+path.sep;assert.ok(checked.toLowerCase().startsWith(parent.toLowerCase())&&path.basename(checked).startsWith('zhike-s1-main-style-'));fs.rmSync(checked,{recursive:true,force:false});manifest.fixtureCleaned=true;fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));}else console.error('Fixture retained for unresolved owned process: '+root);
 }
})();
