'use strict';
// Real Chromium layout/color evaluation of production WS markup and CSS order.
// No WhatsApp, Worker, database, API or native profile is used. This is an
// HTML/CSS contract, not native Windows monitor/DPI acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { createContrastInspector } = require('../../tests/helpers/visual-contrast.cjs');
const { renderWsWorkbenchFixture } = require('../../tests/helpers/ws-workbench-render-fixture.cjs');
const { runIsolatedRenderer, recordVisualAssertions } = require('../../tests/helpers/isolated-renderer.cjs');
const repo = path.resolve(__dirname, '../..');
const edge = [process.env.ZHIKE_TEST_EDGE, path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'), path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe')].filter(Boolean).find(file => fs.existsSync(file));
if (process.env.ZHIKE_VISUAL_BACKEND === 'edge' || process.env.ZHIKE_GPT_VISUAL_ONLY === '1') assert.ok(edge, 'Real isolated Edge is required for computed style acceptance');
const index = fs.readFileSync(path.join(repo, 'resources/app/index.html'), 'utf8');
const css = [...index.matchAll(/<link\s+rel="stylesheet"\s+href="\.\/([^"]+)"/g)].map(match => fs.readFileSync(path.join(repo, 'resources/app', match[1]), 'utf8')).join('\n');
const topbar = index.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0];
assert.ok(topbar, 'Use the real application topbar, not substitute chrome');
const icons = index.match(/<svg class="svg-defs"[\s\S]*?<\/svg>/)?.[0] || '';
const source = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.js'), 'utf8');
const start = source.indexOf('  function syncWorkbenchAttributes('), end = source.indexOf('  function render(options = {})', start);
assert.ok(start >= 0 && end > start, 'Use production incremental mount helpers');
const mounts = source.slice(start, end);
const views = ['overview','accounts','chat','groups','members','collection','contacts','ai','crm','tasks','logs','settings'];
const groupCatalog = Array.from({ length:30 }, (_, index) => ({ accountId:'default',groupJid:'s1-layout-'+index+'@g.us',groupName:'隔离布局群 '+(index+1),participantCount:42,permissions:'所有成员',collectionStatus:'已同步',lastSyncAt:'2026-11-17T10:00:00Z' }));
const options = { groupCatalog, assistOpen:true, backgroundActive:true, groupMonitor:{lastLoadedAt:'2026-11-17T10:00:00Z'} };
const fixtures = Object.fromEntries(views.map(view => [view,renderWsWorkbenchFixture({...options,view})]));
fixtures.closedChat = renderWsWorkbenchFixture({...options,view:'chat',assistOpen:false});
fixtures.compactChat = renderWsWorkbenchFixture({...options,view:'chat',navCollapsed:true});
const tempParent = path.resolve(os.tmpdir()), root = fs.mkdtempSync(path.join(tempParent,'zhike-delivery-s1-ws-'));
const dimensions = [[1920,1080,1],[1920,1080,1.25],[1920,1080,1.5],[2560,1440,1],[2560,1440,1.25],[2560,1440,1.5],[1920,1080,1,'horizon-night']];
async function browserCase(fixtures, views) {
 document.documentElement.dataset.palette=new URLSearchParams(location.search).get('palette')||'atelier-dawn';
 const target=document.getElementById('viewContainer');
 const rect=element=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}};
 const {normalizedColor,contrast,textSample}=createContrastInspector(node=>getComputedStyle(node));
 const paintToken=(shell,name)=>{const probe=document.createElement('span');probe.style.cssText='position:fixed;left:-10000px';probe.style.background='var('+name+')';shell.appendChild(probe);const style=getComputedStyle(probe),result={color:style.backgroundColor,image:style.backgroundImage};probe.remove();return result};

 const results=[],initialHost=target.querySelector('#wsBrowserHost'),baseline=rect(initialHost);
 for(const view of views){
  mountWsWorkbenchShell(target,fixtures[view]);
  await new Promise(resolve=>setTimeout(resolve,200));
  const shell=target.querySelector('.ws-workbench-shell'),page=shell.querySelector('.ws-workbench-page'),content=view==='chat'?page:page.querySelector('[data-ws-workspace-page="'+view+'"]'),nav=shell.querySelector('.ws-workspace-nav'),active=nav.querySelector('.ws-workspace-nav-item.active');
  const panel=content.querySelector('.ws-workspace-card,.ws-card,.ws-login-toolbar'),controls=[...content.querySelectorAll('button.btn,.ws-assist-drawer-close,.ws-assist-tab,input:not([type="checkbox"]):not([type="radio"]),select'),nav.querySelector('.ws-workspace-nav-toggle')].filter(e=>e&&e.getClientRects().length&&getComputedStyle(e).display!=='none');
  const ss=getComputedStyle(shell),cs=getComputedStyle(content),ps=panel&&getComputedStyle(panel),as=getComputedStyle(active);
  const navStyle=getComputedStyle(nav),navPaint={...paintToken(shell,'--ds-rail-bg'),image:paintToken(shell,'--ds-rail-paint').image},commandPaint=paintToken(shell,'--ds-topbar-bg'),material1=paintToken(shell,'--ds-material-1');
  const navText=[...nav.querySelectorAll('.ws-workspace-nav-heading strong,.ws-workspace-nav-heading small,.ws-workspace-nav-item:not(.active) strong,.ws-workspace-nav-status span,.ws-workspace-return span')].filter(node=>node.getClientRects().length).map(node=>({selector:node.className||node.tagName,...textSample(node)}));
  const kpiText=[...content.querySelectorAll(':is(.ws-workspace-metrics,.stage4-ai-summary,.ws-collection-stats,.ws-group-monitor-stats,.ws-data-archive-stats) :is(span,small,strong,b)')].filter(node=>node.getClientRects().length).map(node=>({selector:node.className||node.tagName,...textSample(node)}));
  results.push({view,display:cs.display,font:cs.fontSize,color:cs.color,background:ss.backgroundColor,panel:ps?.backgroundColor,panelImage:ps?.backgroundImage,nav:rect(nav),navBackground:navStyle.backgroundColor,navImage:navStyle.backgroundImage,navText,kpiText,navPill:getComputedStyle(active).borderRadius,navDecoration:getComputedStyle(nav,'::before').pointerEvents,navFoot:!!nav.querySelector('.ws-workspace-nav-status')&&getComputedStyle(nav.querySelector('.ws-workspace-nav-status')).borderStyle,tokens:{background:normalizedColor(ss.getPropertyValue('--ds-bg')),surface:normalizedColor(ss.getPropertyValue('--ds-surface')),navPaint,commandPaint,material1},activeColor:as.color,activeContrast:textSample(active.querySelector('strong')).contrast,bodyContrast:contrast(cs.color,ss.backgroundColor),mutedContrast:contrast(ss.getPropertyValue('--ws-muted'),ss.getPropertyValue('--ws-panel-raised')),scheme:ss.colorScheme,controls:controls.map(e=>({height:rect(e).height,font:getComputedStyle(e).fontSize})),overflow:document.documentElement.scrollWidth>innerWidth,nativeIdentity:target.querySelector('#wsBrowserHost')===initialHost});
 }
 mountWsWorkbenchShell(target,fixtures.chat);
 const shell=target.querySelector('.ws-workbench-shell'),chat=target.querySelector('.workspace-chat'),host=target.querySelector('#wsBrowserHost'),crm=target.querySelector('.ws-assist-panel'),open=rect(host),crmRect=rect(crm),primary=chat.querySelector('.ws-toolbar-actions .btn.primary'),ss=getComputedStyle(shell);
 // The previous S1 chrome was measured with these exact rules before its
 // approved compression. Compare it in this isolated document, then restore
 // every inline style; no product rule or native host is replaced/moved.
 const chrome=[chat,chat.querySelector('.ws-page-heading'),chat.querySelector('.ws-login-toolbar'),chat.querySelector('.ws-center-panel')],savedChrome=chrome.map(node=>node.style.cssText);
 chat.style.paddingBlock='24px';chat.style.gap='16px';chrome[1].style.minHeight='56px';chrome[1].style.setProperty('padding-bottom','12px','important');chrome[2].style.minHeight='58px';chrome[2].style.padding='6px 12px';chrome[3].style.gap='12px';const beforeCompression=rect(host);chrome.forEach((node,index)=>node.style.cssText=savedChrome[index]);
 const fillSample=document.createElement('span');fillSample.style.background='var(--ds-primary-fill)';fillSample.style.color='var(--ds-on-primary-fill)';shell.appendChild(fillSample);
 const expectedGradient=getComputedStyle(fillSample).backgroundImage,expectedForeground=getComputedStyle(fillSample).color;fillSample.remove();
 const primaryStyle=getComputedStyle(primary),gradient=primaryStyle.backgroundImage,gradientStops=gradient.match(/(?:rgba?\([^)]+\)|color\([^)]+\))/g)||[];
 const primaryResult={gradient,animation:primaryStyle.animationName,pseudoAnimation:getComputedStyle(primary,'::after').animationName,foreground:primaryStyle.color,expectedGradient,expectedForeground,start:gradientStops[0],end:gradientStops.at(-1),stopCount:gradientStops.length,contrastStart:contrast(primaryStyle.color,gradientStops[0]),contrastEnd:contrast(primaryStyle.color,gradientStops.at(-1))};
 // CSS state specimens use the same reused component selectors. They do not
 // represent platform/collection activity and never enter the native host.
 const specimen=document.createElement('section');specimen.className='ws-card';specimen.style.cssText='position:fixed;left:-10000px;top:0;width:500px';specimen.innerHTML='<input class="ws-hot-profile-input" aria-readonly="true" value="只读档案"><div class="ws-broadcast-preview"><small>发送预览</small></div><div class="ws-broadcast-attachment"><span class="ws-broadcast-attachment-kind">文件</span><span class="ws-broadcast-attachment-copy"><strong>附件名称</strong><small>附件说明</small></span></div><div class="ws-card-heading"><label class="ws-switch">翻译设置</label></div><span class="ws-broadcast-count">已选择 0</span><span class="ws-export-option">导出选项</span><span class="ws-hot-profile-state state-pending">待审核</span><span class="ws-hot-profile-topic">话题</span><span class="ws-hot-profile-missing">尚未记录</span>';shell.appendChild(specimen);
 const badgeRadius=getComputedStyle(specimen.querySelector('.ws-hot-profile-state')).borderRadius;
 const stateText=[...specimen.querySelectorAll('input,small,strong,label,.ws-broadcast-attachment-kind,.ws-broadcast-count,.ws-export-option,.ws-hot-profile-state,.ws-hot-profile-topic,.ws-hot-profile-missing')].map(node=>({className:node.className,font:getComputedStyle(node).fontSize,...textSample(node)}));specimen.remove();
 const placeholder=chat.querySelector('.ws-browser-placeholder'),placeholderStyle=getComputedStyle(placeholder),placeholderTitle=getComputedStyle(placeholder.querySelector('strong'));
 const placeholderResult={background:placeholderStyle.backgroundColor,expectedBackground:normalizedColor(ss.getPropertyValue('--ds-surface')),contrast:contrast(placeholderStyle.color,placeholderStyle.backgroundColor),titleContrast:contrast(placeholderTitle.color,placeholderStyle.backgroundColor)};
 const normalButtons=[...chat.querySelectorAll('.ws-toolbar-actions>.btn:not(.primary):not(.danger)')].filter(node=>node.getClientRects().length).map(node=>{const style=getComputedStyle(node);return{background:style.backgroundColor,image:style.backgroundImage,expectedBackground:normalizedColor(ss.getPropertyValue('--ws-command-control')),contrast:contrast(style.color,style.backgroundColor)}});
 const crmText=[...chat.querySelectorAll('.ws-assist-drawer-body :is(.ws-card-heading strong,.ws-card-heading span,.ws-empty)')].filter(node=>node.getClientRects().length).map(node=>({selector:node.className||node.tagName,...textSample(node)}));
 const motionRoot=document.documentElement,priorMotion=motionRoot.getAttribute('data-motion');motionRoot.dataset.motion='off';const motionOff=[...shell.querySelectorAll('button')].filter(node=>node.getClientRects().length).every(node=>getComputedStyle(node).transitionDuration.split(',').every(value=>parseFloat(value)===0)&&getComputedStyle(node).animationName==='none');const motionBoundsStable=JSON.stringify(rect(host))===JSON.stringify(open);if(priorMotion===null)motionRoot.removeAttribute('data-motion');else motionRoot.dataset.motion=priorMotion;

 primary.focus();const focus={outline:getComputedStyle(primary).outlineStyle,width:getComputedStyle(primary).outlineWidth,color:getComputedStyle(primary).outlineColor};
 const updates=[];
 for(let n=0;n<20;n++){
  const template=document.createElement('template');template.innerHTML=fixtures.chat;
  const status=template.content.querySelector('.ws-chat-background-status');
  if(!status)throw new Error('Real production background status must exist');
  status.textContent='后台状态更新 '+n+' · '+'9'.repeat(n*4);
  mountWsWorkbenchShell(target,template.innerHTML);updates.push(rect(host));
 }
 const stable=updates.every(value=>JSON.stringify(value)===JSON.stringify(open));
 mountWsWorkbenchShell(target,fixtures.closedChat);const closed=rect(host);
 mountWsWorkbenchShell(target,fixtures.compactChat);const compact={host:rect(host),nav:rect(target.querySelector('.ws-workspace-nav'))};
 mountWsWorkbenchShell(target,fixtures.chat);const returned=rect(host);
 const payload={viewport:{width:innerWidth,height:innerHeight},topbar:rect(document.querySelector('.topbar')),searchFont:getComputedStyle(document.querySelector('.global-search span')).fontSize,sidebar:getComputedStyle(document.getElementById('sidebar')).display,results,stateText,badgeRadius,chat:{open,beforeCompression,crm:crmRect,closed,compact,baseline,returned,stable,identity:host===initialHost&&host.isConnected,local:getComputedStyle(target.querySelector('.ws-local-workspace')).display,primary:primaryResult,placeholder:placeholderResult,normalButtons,crmText,motionOff,motionBoundsStable,focus}};
 document.getElementById('result').textContent=JSON.stringify(payload);parent.postMessage({kind:'s1-ws-visual',index:Number(new URLSearchParams(location.search).get('case')),payload},'*');
 const screenshotView=new URLSearchParams(location.search).get('screenshotView');
 if(screenshotView&&fixtures[screenshotView])mountWsWorkbenchShell(target,fixtures[screenshotView]);
}
function browserMatrix(cases) {
 const results=[],frames=[];
 addEventListener('message',event=>{if(event.data?.kind!=='s1-ws-visual')return;results[event.data.index]=event.data.payload;frames[event.data.index]?.remove();if(results.filter(Boolean).length===cases.length)document.getElementById('result').textContent=JSON.stringify(results)});
 cases.forEach((value,index)=>{const frame=document.createElement('iframe');frames[index]=frame;frame.width=Math.round(value[0]/value[2]);frame.height=Math.round(value[1]/value[2]);frame.src='case.html?case='+index+'&palette='+encodeURIComponent(value[3]||'atelier-dawn');document.body.appendChild(frame)});
}
async function gptBrowserCase(){
 const query=new URLSearchParams(location.search),palette=query.get('palette')||'atelier-dawn',configured=query.get('configured')!=='false';document.documentElement.dataset.palette=palette;document.documentElement.dataset.view='gpt';
 const errors=window.__gptVisualErrors=[],calls=window.__gptVisualCalls=[];
 addEventListener('error',event=>errors.push(event.message));addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
 window.__zhikeRegistryHost={state:{view:'gpt'},toast:message=>errors.push('toast:'+message)};
 window.fetch=async url=>{calls.push(String(url));if(String(url)!=='/api/state')throw Error('Unexpected isolated request');return{ok:true,json:async()=>({customers:[],registrations:[],tickets:[],deposits:[],followups:[],activities:[]})}};
 window.zhikeAI={status:async()=>({configured,provider:'openai',providerName:'隔离视觉 AI',model:'synthetic-layout-only',defaultIncludePhone:false})};
 localStorage.setItem('zhike-gpt-last-session',JSON.stringify({mode:'general',messages:[{role:'user',text:'仅用于布局的隔离提问'},{role:'assistant',text:'隔离布局回答；未调用 AI、网络或客户数据库。'}]}));
 const renderer=document.createElement('script');renderer.textContent=window.__gptSource;document.body.appendChild(renderer);await window.ZhikeGPT.render();await new Promise(resolve=>setTimeout(resolve,200));
 const page=document.querySelector('.gpt-page'),style=getComputedStyle(page),rect=node=>{if(!node)return null;const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
 const visible=node=>node.getClientRects().length&&getComputedStyle(node).display!=='none';
 const {normalizedColor,textSample}=createContrastInspector(node=>getComputedStyle(node));
 const text=[...page.querySelectorAll('p,span,small,strong,b,label,em,.gpt-message-body>div,button,select,textarea')].filter(node=>visible(node)&&[...node.childNodes].some(child=>child.nodeType===3&&child.textContent.trim())).map(node=>({selector:node.tagName+'.'+node.className,font:getComputedStyle(node).fontSize,...textSample(node)}));
 const context=page.querySelector('.gpt-context'),messages=page.querySelector('.gpt-messages'),composer=page.querySelector('.gpt-composer'),send=page.querySelector('.gpt-send-round');
 const motionRoot=document.documentElement;motionRoot.dataset.motion='off';const motionOff=[...page.querySelectorAll('button,input,select,textarea')].filter(visible).every(node=>getComputedStyle(node).transitionDuration.split(',').every(value=>parseFloat(value)===0)&&getComputedStyle(node).animationName==='none');motionRoot.removeAttribute('data-motion');
 const contextBefore=context?.scrollTop;if(context)context.scrollTop=context.scrollHeight;const contextScrolls=context?context.scrollTop>0||context.scrollHeight<=context.clientHeight:null;if(context)context.scrollTop=contextBefore;
 const result={viewport:{width:innerWidth,height:innerHeight},palette,configured,errors,calls,text,motionOff,page:rect(page),overflow:document.documentElement.scrollWidth>innerWidth,surface:page.querySelector('.gpt-chat')?getComputedStyle(page.querySelector('.gpt-chat')).backgroundColor:null,expectedSurface:normalizedColor(style.getPropertyValue('--ds-surface')),scheme:style.colorScheme,context:rect(context),contextOverflow:context?getComputedStyle(context).overflowY:null,contextScrolls,messages:rect(messages),composer:rect(composer),composerShell:rect(page.querySelector('.gpt-composer-shell')),send:rect(send),controls:[...page.querySelectorAll('button,select,.gpt-attach-btn')].filter(visible).map(node=>({selector:node.className,font:getComputedStyle(node).fontSize,height:rect(node).height})),tools:context?['.gpt-new-chat','.gpt-history','.gpt-provider-card','.gpt-local-import','.gpt-workspace-btn'].map(selector=>({selector,display:getComputedStyle(context.querySelector(selector)).display})):[]};
 document.getElementById('result').textContent=JSON.stringify(result);parent.postMessage({kind:'gpt-visual',index:Number(query.get('case')),payload:result},'*');
}
function recordGptDumpDomFailure(run, cases, timeoutMs, started) {
 try {
  const stdout = run.stdout || '';
  const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
  // Keep metadata only. The captured page markup stays out of the evidence.
  const resultMarkers = [...stdout.matchAll(/<pre id="result" hidden="">([^<]+)<\/pre>/g)].map(([,value]) => {
   let results;
   try { results = JSON.parse(value); } catch {}
   const scenes = Array.isArray(results) ? results.length : null;
   const complete = scenes === cases.length && cases.every((expected, index) => {
    const row = results[index];
    return row?.viewport?.width === expected.width && row.viewport.height === expected.height
      && row.palette === expected.palette && row.configured === expected.configured;
   });
   return { scenes, complete, sha256: sha256(value) };
  });
  const evidence = {
   schemaVersion: 1, scope: 'isolated GPT matrix dump-dom failure',
   testRoot: root, testRootId: path.basename(root),
   startedAtUtc: new Date(started).toISOString(), timeoutMs,
   pid: run.pid || null, status: run.status ?? null, signal: run.signal ?? null, errorCode: run.error?.code ?? null,
   stdoutUtf8Bytes: Buffer.byteLength(stdout, 'utf8'), stdoutSha256: sha256(stdout),
   expectedSceneCount: cases.length, resultMarkerCount: resultMarkers.length,
   completeResultMarkerCount: resultMarkers.filter(marker => marker.complete).length, resultMarkers,
  };
  const directory = path.join(repo, '.tools', 'delivery-s1-ws-visual', 'gpt-failures');
  fs.mkdirSync(directory, { recursive: true });
  const destination = path.join(directory, 'gpt-failure-' + evidence.testRootId + '.json');
  fs.writeFileSync(destination, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  console.error('Isolated GPT matrix failure metadata: ' + destination);
 } catch (error) {
  // A diagnostic write failure must not replace the original run assertion.
  console.error('Could not save isolated GPT matrix failure metadata: ' + (error.code || error.name));
 }
}

function runGptVisual(){
 const actualSource=fs.readFileSync(path.join(repo,'resources/app/modules/gpt-assistant.js'),'utf8'),script=value=>'<script>'+value.replace(/<\/script/gi,'<\\/script')+'</script>';
 const clean=index.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\s+rel="stylesheet"[^>]*>/g,'').replace(/src="\.\//g,'src="'+pathToFileURL(path.join(repo,'resources/app')+path.sep).href);
 const html=clean.replace('</head>','<style>'+css+'</style></head>').replace('</body>','<pre id="result" hidden></pre>'+script('window.__gptSource='+JSON.stringify(actualSource)+';'+createContrastInspector.toString()+';('+gptBrowserCase.toString()+')();')+'</body>');fs.writeFileSync(path.join(root,'gpt.html'),html);
 const cases=[];for(const palette of ['atelier-dawn','horizon-night'])for(const [width,height]of [[1920,1080],[820,540]])for(const configured of [true,false])cases.push({palette,width,height,configured});
 const matrix='<!doctype html><pre id="result" hidden></pre>'+script('const cases='+JSON.stringify(cases)+',results=[];addEventListener("message",event=>{if(event.data?.kind!=="gpt-visual")return;results[event.data.index]=event.data.payload;if(results.filter(Boolean).length===cases.length)document.getElementById("result").textContent=JSON.stringify(results)});cases.forEach((value,index)=>{const frame=document.createElement("iframe");frame.style.cssText="position:absolute;inset:0;border:0;opacity:0;pointer-events:none;width:"+value.width+"px;height:"+value.height+"px";frame.src="gpt.html?case="+index+"&palette="+value.palette+"&configured="+value.configured;document.body.appendChild(frame)});');fs.writeFileSync(path.join(root,'gpt-matrix.html'),matrix);
 const timeoutMs=45000, started=Date.now();
 const run=spawnSync(edge,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--force-device-scale-factor=1','--user-data-dir='+path.join(root,'profile'),'--window-size=1280,720','--virtual-time-budget=5000','--dump-dom',pathToFileURL(path.join(root,'gpt-matrix.html')).href],{encoding:'utf8',windowsHide:true,timeout:timeoutMs,maxBuffer:8*1024*1024});
 if(run.status!==0)recordGptDumpDomFailure(run,cases,timeoutMs,started);
 assert.equal(run.status,0,[run.error?.message,run.stderr].filter(Boolean).join('\n'));
 const match=run.stdout.match(/<pre id="result" hidden="">([^<]+)<\/pre>/);assert.ok(match,'Actual async GPT renderer completed: '+String(run.stdout).slice(-4000));const results=JSON.parse(match[1]);
 for(const [index,row]of results.entries()){
  const expected=cases[index];assert.deepEqual(row.viewport,{width:expected.width,height:expected.height});assert.deepEqual(row.errors,[]);assert.ok(row.calls.every(value=>value==='/api/state'),'Only the isolated empty privacy-preview state can be read');assert.equal(row.overflow,false,'GPT route has no document overflow');assert.equal(row.motionOff,true,'GPT motion-off disables actual controls without hiding them');assert.equal(row.scheme,expected.palette==='horizon-night'?'dark':'light');assert.ok(row.page.height>0&&row.page.bottom<=row.viewport.height);
  for(const sample of row.text){assert.ok(parseFloat(sample.font)>=14,'GPT ordinary text scale '+JSON.stringify(sample));if(sample.contrast!==null)assert.ok(sample.contrast>=4.5,'GPT actual text contrast '+JSON.stringify(sample))}
  for(const control of row.controls)assert.ok(control.height>=44&&parseFloat(control.font)>=14,'GPT accessible control '+JSON.stringify(control));
  if(row.configured){assert.equal(row.surface,row.expectedSurface);assert.equal(row.contextOverflow,'auto');assert.ok(row.contextScrolls,'GPT context retains its independent scroll');assert.ok(row.messages.height>=48,'GPT transcript keeps room for readable content '+JSON.stringify({messages:row.messages,page:row.page,composerShell:row.composerShell}));assert.ok(row.composerShell.bottom<=row.page.bottom+1,'GPT composer remains reachable '+JSON.stringify({page:row.page,context:row.context,messages:row.messages,composer:row.composer,viewport:row.viewport}));assert.ok(row.send.width>=44&&row.send.height>=44);assert.ok(row.tools.every(tool=>tool.display!=='none'),'Existing GPT tools remain reachable through the context scroller')}
  console.log(JSON.stringify({kind:'actual-gpt-render-css',palette:row.palette,configured:row.configured,viewport:row.viewport,context:row.context,messages:row.messages,composer:row.composer,textSamples:row.text.length,minimumContrast:Math.min(...row.text.filter(sample=>sample.contrast!==null).map(sample=>sample.contrast))}));
 }
 if(process.env.ZHIKE_WS_VISUAL_SCREENSHOTS==='1')for(const palette of ['atelier-dawn','horizon-night'])for(const [width,height]of [[1920,1080],[820,540]]){
  const output=path.join(repo,'.tools','delivery-s1-ws-visual');fs.mkdirSync(output,{recursive:true});const image=path.join(output,'gpt-'+palette+'-'+width+'.png'),url=pathToFileURL(path.join(root,'gpt.html'));url.searchParams.set('palette',palette);
  const capture=spawnSync(edge,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--force-device-scale-factor=1','--user-data-dir='+path.join(root,'profile'),'--window-size='+width+','+height,'--virtual-time-budget=5000','--screenshot='+image,url.href],{encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:1024*1024});assert.equal(capture.status,0,[capture.error?.message,capture.stderr].filter(Boolean).join('\n'));assert.ok(fs.statSync(image).size>1000);console.log(JSON.stringify({kind:'isolated-actual-gpt-screenshot',palette,width,path:image}));
 }
 console.log('GPT actual production renderer: two palettes x wide/820x540 x configured/setup, isolated status/state only PASS');
}
async function main() {
 let cleanupSafe = true;
 try {
 if(process.env.ZHIKE_GPT_VISUAL_ONLY==='1'){runGptVisual();}else{
 const html='<!doctype html><html lang="zh-CN" data-theme="dark" data-palette="atelier-dawn" data-view="ws-workbench" data-desktop-host="webview2"><meta charset="utf-8"><style>'+css+'</style><style>html,body{margin:0}</style><body class="ws-mode ws-workspace-active">'+icons+'<div class="app-shell"><aside id="sidebar"></aside><main class="main-area">'+topbar+'<section id="viewContainer" class="view-container">'+fixtures.chat+'</section></main></div><pre id="result" hidden></pre><script>'+mounts+'\n'+createContrastInspector.toString()+'\n('+browserCase.toString()+')('+JSON.stringify(fixtures)+','+JSON.stringify(views)+');</script></body></html>';
 fs.writeFileSync(path.join(root,'case.html'),html);
 const matrix='<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}iframe{position:absolute;inset:0;border:0;opacity:0;pointer-events:none}</style><pre id="result" hidden></pre><script>('+browserMatrix.toString()+')('+JSON.stringify(dimensions)+');</script>';
 fs.writeFileSync(path.join(root,'matrix.html'),matrix);
 const expectedViewports = dimensions.map(([width, height, scale]) => ({ width: Math.round(width / scale), height: Math.round(height / scale) }));
 cleanupSafe = false;
 const { results: actual, metadata } = await runIsolatedRenderer({
  edge, root, url: pathToFileURL(path.join(root, 'matrix.html')).href, expectedViewports,
  evidenceDirectory: path.join(repo, '.tools', 'delivery-s1-ws-visual'),
 });
 cleanupSafe = metadata.cleanupSafe;
 assert.equal(cleanupSafe, true, 'Every observed isolated WS browser process must exit before assertions');
 console.log(JSON.stringify({browserLifecycle:metadata.status,pid:metadata.pid,exit:metadata.exit,streamsClosed:metadata.streamsClosed,cleanupSafe:metadata.cleanupSafe,evidence:metadata.evidenceFile}));
 for(const [index,[physicalWidth,physicalHeight,scale,palette='atelier-dawn']]of dimensions.entries()){
  const row=actual[index],width=Math.round(physicalWidth/scale),height=Math.round(physicalHeight/scale);
  const night=palette==='horizon-night';
  assert.deepEqual(row.viewport,{width,height});assert.equal(row.topbar.height,56);assert.equal(row.searchFont,'14px','Shared WS search text retains the readable body scale');assert.equal(row.sidebar,'none');assert.equal(row.results.length,12);
  for(const page of row.results){
   assert.equal(page.display,'flex',page.view+' is a real visible page');assert.equal(page.font,'14px',page.view+' readable body');assert.equal(page.scheme,night?'dark':'light');assert.equal(page.background,page.tokens.background,page.view+' follows the selected DS background');assert.equal(page.navBackground,page.tokens.navPaint.color,page.view+' follows the selected semantic rail color');assert.equal(page.navImage,page.tokens.navPaint.image,page.view+' follows the selected semantic rail paint');assert.equal(page.nav.width,250);assert.equal(page.nav.height,height-56);assert.equal(page.navPill,'999px','WS selected navigation is a full pill without changing its geometry');assert.equal(page.navDecoration,'none','WS contour decoration cannot intercept navigation');assert.equal(page.navFoot,'solid','Real worker status keeps its own bounded information card');
   assert.ok(page.bodyContrast>=4.5,page.view+' body contrast '+page.bodyContrast);assert.ok(page.mutedContrast>=4.5,page.view+' secondary text contrast '+page.mutedContrast);assert.ok(page.activeContrast>=4.5,page.view+' navigation selected contrast '+page.activeContrast);
   if(page.panel){if(page.view==='chat'){assert.equal(page.panel,page.tokens.commandPaint.color,'Chat command band follows its semantic toolbar color');assert.equal(page.panelImage,page.tokens.commandPaint.image,'Chat command band follows its semantic toolbar paint')}else if(page.view==='overview'){
    assert.equal(page.panel,page.tokens.surface,'The overview welcome card keeps its opaque surface beneath the artwork');
   }else{
    const material=page.tokens.material1;
    assert.match(material.image,/^linear-gradient\(/,'Material 1 must expose its actual shared gradient');
    assert.equal(page.panel,material.color,page.view+' matches the material 1 background color');
    assert.equal(page.panelImage,material.image,page.view+' matches the material 1 image layers');
   }}
   for(const sample of [...page.navText,...page.kpiText])assert.ok(sample.contrast>=4.5,page.view+' semantic rail/KPI text '+JSON.stringify(sample));
   assert.ok(page.controls.every(control=>control.height>=44&&parseFloat(control.font)>=14),page.view+' control scale '+JSON.stringify(page.controls));assert.equal(page.overflow,false,page.view+' no document overflow');assert.equal(page.nativeIdentity,true);
  }
  assert.equal(row.chat.local,'none');assert.equal(row.chat.identity,true);assert.equal(row.chat.motionOff,true,'Motion-off stops actual WS control transitions and animations');assert.equal(row.chat.motionBoundsStable,true,'Motion preference cannot resize the native host');for(const sample of row.chat.crmText)assert.ok(sample.contrast>=4.5,'Grouped CRM text '+JSON.stringify(sample));assert.equal(row.chat.stable,true,'Repeated real mount updates cannot move or resize native host');
  assert.equal(row.badgeRadius,'999px','Real shared WS status styling remains pill-shaped');for(const state of row.stateText){assert.ok(parseFloat(state.font)>=14,'Reused component text retains the approved 14px scale: '+state.className);assert.ok(state.contrast>=4.5,'Reused component contrast '+state.className+': '+state.contrast)}
  assert.equal(row.chat.placeholder.background,row.chat.placeholder.expectedBackground,'Only the outer native placeholder follows the selected palette');assert.ok(row.chat.placeholder.contrast>=4.5&&row.chat.placeholder.titleContrast>=4.5,'Native placeholder text retains readable contrast');
  assert.ok(row.chat.normalButtons.length>=3,'Actual foreground toolbar retains secondary actions');for(const button of row.chat.normalButtons){assert.equal(button.image,'none','Secondary action cannot inherit an old theme gradient');assert.equal(button.background,button.expectedBackground,'Secondary action follows the selected WS surface');assert.ok(button.contrast>=4.5,'Secondary action text retains readable contrast')}
  console.log(JSON.stringify({kind:'ws-chrome-geometry',palette,viewport:row.viewport,before:row.chat.beforeCompression,after:row.chat.open}));
  assert.equal(row.chat.open.y,187,'Approved 14px chrome keeps a deterministic 187 CSS px native host origin');assert.equal(row.chat.beforeCompression.height+44,row.chat.open.height,'Compression restores exactly 44px height without removing any controls');assert.equal(row.chat.beforeCompression.y-row.chat.open.y,36,'36px move above the host plus 8px lower margin yields 44px usable height');
  assert.deepEqual(row.chat.returned,row.chat.baseline,'Twelve page switches restore the same native anchor bounds');
  assert.ok(row.chat.open.width>=560&&row.chat.open.height>=380);assert.ok(row.chat.open.height>=height-276,'The only extra vertical reservation is the shared 56px row');assert.ok(row.chat.open.bottom<=height&&row.chat.crm.bottom<=height);assert.equal(row.chat.closed.width-row.chat.open.width,row.chat.crm.width-52);assert.equal(row.chat.compact.nav.width,76);assert.equal(row.chat.compact.host.width-row.chat.open.width,174);
  assert.equal(row.chat.primary.animation,'none','WS primary control cannot inherit a continuous legacy gradient animation');assert.equal(row.chat.primary.pseudoAnimation,'none','WS primary control cannot inherit a continuous shimmer');assert.ok(row.chat.primary.stopCount>=2,'Shared primary action has actual computed gradient endpoints');assert.equal(row.chat.primary.gradient,row.chat.primary.expectedGradient,'WS primary action reuses the shared primary fill');assert.equal(row.chat.primary.foreground,row.chat.primary.expectedForeground,'WS primary action reuses the shared fill foreground');assert.ok(row.chat.primary.contrastStart>=4.5&&row.chat.primary.contrastEnd>=4.5,'Button text stays readable at both gradient endpoints in either palette');assert.equal(row.chat.focus.outline,'solid');assert.equal(row.chat.focus.width,'2px');
  console.log(JSON.stringify({kind:'real-computed-css',palette,physical:[physicalWidth,physicalHeight],scale,viewport:row.viewport,pages:12,topbar:row.topbar.height,navigation:[250,76],beforeCompression:row.chat.beforeCompression,chat:row.chat.open,gradientContrast:[row.chat.primary.contrastStart,row.chat.primary.contrastEnd],mountUpdates:20,hostStable:row.chat.stable}));
 }
 recordVisualAssertions(metadata);
 console.log('S1 WS computed design system: 12 routes x 6 daylight viewports + night, 44px controls, readable palettes, 20-update native DOM anchor stability PASS');
 if(process.env.ZHIKE_WS_VISUAL_SCREENSHOTS==='1'){
  const output=path.join(repo,'.tools','delivery-s1-ws-visual');fs.mkdirSync(output,{recursive:true});
  for(const palette of ['atelier-dawn','horizon-night']){
   const image=path.join(output,'chat-'+palette+'.png'),url=pathToFileURL(path.join(root,'case.html'));url.searchParams.set('palette',palette);url.searchParams.set('screenshotView','chat');
   const capture=spawnSync(edge,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--force-device-scale-factor=1','--user-data-dir='+path.join(root,'profile'),'--window-size=1920,1080','--virtual-time-budget=5000','--screenshot='+image,url.href],{encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:1024*1024});
   assert.equal(capture.status,0,[capture.error?.message,capture.stderr].filter(Boolean).join('\n'));assert.ok(fs.statSync(image).size>1000,'Real fixture screenshot must contain image data');console.log(JSON.stringify({kind:'isolated-production-render-screenshot',palette,path:image}));
  }
 }
 }
} catch (error) {
 cleanupSafe = false;
 throw error;
} finally {
 const resolved=path.resolve(root);assert.ok(resolved.startsWith(tempParent+path.sep)&&path.basename(resolved).startsWith('zhike-delivery-s1-ws-'),'Only this test-owned isolated root can be removed');
 if (cleanupSafe) fs.rmSync(resolved,{recursive:true,force:false,maxRetries:20,retryDelay:100});
 else console.error('Isolated WS failure root retained: ' + resolved);
}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
